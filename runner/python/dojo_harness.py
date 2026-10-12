#!/usr/bin/env python3
"""Dojo test harness (docs/ARCHITECTURE.md, "Code runners").

One file, stdlib only, CPython >= 3.12. The content validator runs it
(`scripts/validate-content.ts`), and it is the reference implementation for a
code runner: a runner (Pyodide, a sandbox service, a desktop shell) executes
this file with a RunJob on stdin and returns the RunResult it prints.

CLI:  python3 -s -B -X utf8 dojo_harness.py [--workdir DIR] [--hard-timeout SECONDS] < job.json > result.json

stdin is one RunJob (see run-protocol.ts) or {"jobs": [RunJob, ...]}; stdout is
the matching RunResult or {"results": [RunResult, ...]}. Exit code is 0 whenever
a result was written, including a learner's failing tests.

What a job gets:
  * every file written into a fresh scratch directory, which is cwd and the
    head of sys.path; user modules from earlier runs are purged from
    sys.modules first;
  * `random.seed(seed)` before every test; a FakeClock in place of
    time.time/monotonic/perf_counter/sleep for user code when `fakeClock`
    (stdlib internals such as asyncio, threading and queue keep real time).
    Wall time (`time.time`) and monotonic time (`time.monotonic`,
    `perf_counter`) move together under `clock.advance(s)` / `time.sleep(s)`;
    `clock.jump_wall(s)` / `clock.set_wall(t)` move wall time alone (NTP step,
    possibly backwards) and `clock.advance_monotonic(s)` moves monotonic alone;
  * a per-test budget of traced user-code line events (`stepBudget`), a
    per-test wall slice (`testWallMs`, default max(1 s, wallMs / 2), never past
    the job's `wallMs`) checked softly every 256 traced events and enforced by
    a per-test SIGALRM, and the job-level SIGALRM backstop at `wallMs`;
  * an address-space cap (`memoryMb`, alias `memoryHintMb`, default 1024 MB of
    headroom over the harness's own footprint; 0 disables it) via
    `setrlimit(RLIMIT_AS)`. Linux enforces it as usual. macOS enforces it too,
    but only relative to the process's current virtual size (~400 GB of
    reserved shared-cache address space on arm64), and refuses any absolute
    limit below that with EINVAL; so the cap is always set as current VSZ +
    memoryMb (VSZ from /proc/self/statm on Linux, one `ps` call on macOS).
    Either way `list(range(10**10))` fails at once with MemoryError instead of
    swapping; such a MemoryError is reported with `fault: "memory_limit"`;
  * sockets stubbed out (PermissionError);
  * plain `def test_*()` / `async def test_*()` functions, collected in
    definition order, with `assert a == b` rewritten so a failure says what
    the two sides were. Tests may take the parameters `clock`, `tmp_path`,
    `rng`, `monkeypatch`, `capsys`, any `@pytest.fixture` defined in (or
    imported into) the tests module, and `@pytest.mark.parametrize` names.

The synthetic module `dojo` exposes: kc, clock, raises, torn_write, stress, FakeClock.

The synthetic module `pytest` is a small, deterministic, pytest-compatible
subset, installed in sys.modules so that it shadows any real pytest in
site-packages (a job that ships its own `pytest.py` or `pytest/` package gets
that instead): raises (context manager and callable form, `match=`),
approx (scalars, sequences, mappings; rel=1e-6 / abs=1e-12 like pytest),
fixture (function scope only, `yield` teardown, `autouse=`, `name=`),
mark.parametrize (stacked, `ids=`, `pytest.param`), mark.skip / mark.skipif,
every other `mark.*` as a no-op, fail, skip, MonkeyPatch.

Parametrized tests keep ONE test id (the function name), because test ids and
`@kc` tags are also read statically by the content build
(scripts/practical-dojo/content-loader.ts `extractTestMeta`) and must match
the harness's collection. All cases run inside that id, in pytest's order,
each with fresh fixtures, a reset clock, a reseeded `random` and a fresh step
budget; the first failing case fails the test, its message is prefixed with
`[case-id]` and the outcome carries `case`. `collect` lists the case ids in
`cases`. `pytest.skip()` / skip marks make a test (or a case) count as passed
with `skipped: <reason>` when every case was skipped.
"""
from __future__ import annotations

import ast
import asyncio
import builtins
import contextlib
import importlib
import inspect
import io
import itertools
import json
import operator
import os
import pathlib
import queue  # noqa: F401  (imported early so it binds the real time.monotonic)
import random
import re
import shutil
import signal
import socket
import sys
import subprocess
import tempfile
import threading
import time
import traceback
import types

RUNTIME_ID = "cpython-sandbox"
STDOUT_CAP = 16 * 1024
TEST_STDOUT_CAP = 2 * 1024
MSG_CAP = 2_000
REPR_CAP = 300
MAX_FRAMES = 5
FAKE_EPOCH = 1_700_000_000.0
DEFAULT_MEMORY_MB = 1024
TEST_ALARM_GRACE = 0.1

_real_time = time.time
_real_monotonic = time.monotonic
_real_perf_counter = time.perf_counter
_real_sleep = time.sleep
_real_time_ns = time.time_ns
_real_monotonic_ns = time.monotonic_ns
_real_open = builtins.open

# Callers from these modules always see real time even under a fake clock, so
# event loops, condition waits and pool timeouts keep working.
_REAL_TIME_CALLERS = (
    "asyncio", "concurrent", "threading", "queue", "selectors", "subprocess",
    "socket", "multiprocessing", "dojo_harness", "__dojo_harness__",
)


class StepBudgetExceeded(BaseException):
    """Raised in user frames once a test's line budget or the wall budget is spent.

    A BaseException so that a learner's `except Exception:` cannot swallow it.
    """


class WallTimeout(BaseException):
    """Raised by the SIGALRM backstop."""


class HarnessError(Exception):
    pass


# ───────────────────────────── fake clock ─────────────────────────────


def _stdlib_caller(depth: int = 2) -> bool:
    try:
        name = sys._getframe(depth).f_globals.get("__name__", "")
    except ValueError:
        return False
    return isinstance(name, str) and name.split(".", 1)[0] in _REAL_TIME_CALLERS


class FakeClock:
    """Deterministic time. Tests drive it with `clock.advance(seconds)`.

    Wall time (`time.time`, `clock.wall()`, `clock.now()`) and monotonic time
    (`time.monotonic`, `time.perf_counter`, `clock.monotonic()`) are separate
    readings. `advance`, `tick` and `time.sleep` move both; `jump_wall` /
    `set_wall` move wall time only (it may go backwards, like an NTP step);
    `advance_monotonic` moves monotonic time only. `set(t)` keeps its original
    meaning: it moves wall time to `t` and monotonic time by the same delta.

    Monotonic time is computed as `wall - start + 1000 + skew`, so with no
    wall-only jumps (skew == 0) every reading is bit-for-bit what it was before
    the two clocks were separated.
    """

    MONOTONIC_START = 1000.0

    def __init__(self, start: float = FAKE_EPOCH):
        self.start = start
        self.t = start
        self._skew = 0.0

    def reset(self) -> None:
        self.t = self.start
        self._skew = 0.0

    def now(self) -> float:
        return self.t

    def wall(self) -> float:
        return self.t

    def monotonic(self) -> float:
        return self.t - self.start + self.MONOTONIC_START + self._skew

    def advance(self, seconds: float) -> float:
        if seconds < 0:
            raise ValueError("clock.advance() needs a non-negative number of seconds")
        self.t += seconds
        return self.t

    def set(self, value: float) -> None:
        self.t = float(value)

    def jump_wall(self, seconds: float) -> float:
        """Moves wall time only, by `seconds` (negative = backwards)."""
        self.t += seconds
        self._skew -= seconds
        return self.t

    def set_wall(self, value: float) -> float:
        """Sets wall time only; monotonic time does not move."""
        return self.jump_wall(float(value) - self.t)

    def advance_monotonic(self, seconds: float) -> float:
        """Moves monotonic time only (wall time stays put)."""
        if seconds < 0:
            raise ValueError("clock.advance_monotonic() needs a non-negative number of seconds")
        self._skew += seconds
        return self.monotonic()

    async def tick(self, seconds: float = 0.0) -> float:
        """Advance, then yield once to the running event loop."""
        self.advance(seconds)
        await asyncio.sleep(0)
        return self.t

    # The replacements installed into the `time` module.
    def _time(self) -> float:
        return _real_time() if _stdlib_caller() else self.t

    def _monotonic(self) -> float:
        return _real_monotonic() if _stdlib_caller() else self.monotonic()

    def _perf_counter(self) -> float:
        return _real_perf_counter() if _stdlib_caller() else self.monotonic()

    def _time_ns(self) -> int:
        return _real_time_ns() if _stdlib_caller() else int(self.t * 1e9)

    def _monotonic_ns(self) -> int:
        return _real_monotonic_ns() if _stdlib_caller() else int(self.monotonic() * 1e9)

    def _sleep(self, seconds: float) -> None:
        if _stdlib_caller():
            _real_sleep(seconds)
        else:
            if seconds < 0:
                raise ValueError("sleep length must be non-negative")
            self.t += seconds


@contextlib.contextmanager
def _patched_time(clock: FakeClock | None):
    if clock is None:
        yield
        return
    names = ("time", "monotonic", "perf_counter", "time_ns", "monotonic_ns", "sleep")
    saved = {n: getattr(time, n) for n in names}
    time.time = clock._time
    time.monotonic = clock._monotonic
    time.perf_counter = clock._perf_counter
    time.time_ns = clock._time_ns
    time.monotonic_ns = clock._monotonic_ns
    time.sleep = clock._sleep
    try:
        yield
    finally:
        for n, fn in saved.items():
            setattr(time, n, fn)


# ───────────────────────────── network stub ─────────────────────────────


_RealSocket = socket.socket


class _GuardedSocket(_RealSocket):
    """Internet sockets are refused; AF_UNIX and adopted file descriptors are
    allowed, because asyncio's self-pipe and multiprocessing need them."""

    def __init__(self, family=-1, type=-1, proto=-1, fileno=None):
        if fileno is None and family in (-1, socket.AF_INET, socket.AF_INET6):
            raise PermissionError("network access is disabled in dojo exercises")
        super().__init__(family, type, proto, fileno)


def _blocked(*args, **kwargs):
    raise PermissionError("network access is disabled in dojo exercises")


@contextlib.contextmanager
def _no_network():
    saved = (socket.socket, socket.create_connection, socket.getaddrinfo)
    socket.socket = _GuardedSocket  # type: ignore[misc]
    socket.create_connection = _blocked  # type: ignore[assignment]
    socket.getaddrinfo = _blocked  # type: ignore[assignment]
    try:
        yield
    finally:
        socket.socket, socket.create_connection, socket.getaddrinfo = saved


# ───────────────────────────── the `dojo` module ─────────────────────────────


def kc(*ids: str):
    """Tags a test with the KCs it exercises. No effect on execution."""

    def wrap(fn):
        fn.__dojo_kcs__ = tuple(ids)
        return fn

    return wrap


class raises:  # noqa: N801  (mirrors pytest.raises)
    """`with raises(KeyError): ...` — fails unless the block raises that type."""

    def __init__(self, *types_: type[BaseException], match: str | None = None):
        self.types = types_
        self.match = match
        self.value: BaseException | None = None

    def __enter__(self):
        return self

    def __exit__(self, exc_type, exc, tb):
        names = " or ".join(t.__name__ for t in self.types)
        if exc_type is None:
            raise AssertionError(f"expected {names} to be raised")
        if not issubclass(exc_type, self.types):
            return False
        if self.match is not None:
            import re

            if not re.search(self.match, str(exc)):
                raise AssertionError(f"{exc_type.__name__}({str(exc)[:REPR_CAP]!r}) does not match {self.match!r}")
        self.value = exc
        return True


class _TornFile:
    def __init__(self, inner, budget: list[int]):
        self._inner = inner
        self._budget = budget

    def write(self, data):
        left = self._budget[0]
        if left <= 0:
            raise OSError(5, "torn write (injected)")
        if len(data) > left:
            self._inner.write(data[:left])
            self._inner.flush()
            self._budget[0] = 0
            raise OSError(5, "torn write (injected)")
        self._budget[0] -= len(data)
        return self._inner.write(data)

    def __getattr__(self, name):
        return getattr(self._inner, name)

    def __enter__(self):
        return self

    def __exit__(self, *exc):
        self._inner.close()
        return False

    def __iter__(self):
        return iter(self._inner)


@contextlib.contextmanager
def torn_write(path, at_byte: int):
    """Writes to `path` fail with OSError(EIO) once `at_byte` bytes (chars in
    text mode) have reached it; the partial prefix is flushed, like a crash
    mid-write."""
    target = os.path.abspath(os.fspath(path))
    budget = [int(at_byte)]

    def fake_open(file, mode="r", *args, **kwargs):
        handle = _real_open(file, mode, *args, **kwargs)
        if isinstance(file, (str, bytes, os.PathLike)) and any(m in mode for m in "wax+"):
            if os.path.abspath(os.fsdecode(os.fspath(file))) == target:
                return _TornFile(handle, budget)
        return handle

    builtins.open = fake_open
    io.open = fake_open  # type: ignore[assignment]
    try:
        yield
    finally:
        builtins.open = _real_open
        io.open = _real_open  # type: ignore[assignment]


def stress(fn, n: int = 200, switch_interval: float = 1e-6):
    """Runs `fn` n times with a tiny GIL switch interval to surface races.

    Any AssertionError counts as a violation; the call fails if there was one.
    """
    saved = sys.getswitchinterval()
    sys.setswitchinterval(switch_interval)
    failures = 0
    first = ""
    try:
        for _ in range(n):
            try:
                fn()
            except AssertionError as error:
                failures += 1
                first = first or (str(error) or "assertion failed")
    finally:
        sys.setswitchinterval(saved)
    if failures:
        raise AssertionError(f"invariant violated in {failures}/{n} runs: {first}"[:MSG_CAP])


_CLOCK = FakeClock()


def _install_dojo_module() -> types.ModuleType:
    mod = types.ModuleType("dojo")
    mod.__doc__ = "Helpers available to dojo exercises and tests."
    mod.kc = kc
    mod.clock = _CLOCK
    mod.raises = raises
    mod.torn_write = torn_write
    mod.stress = stress
    mod.FakeClock = FakeClock
    sys.modules["dojo"] = mod
    return mod


_install_dojo_module()


# ───────────────────────────── the `pytest` module ─────────────────────────────
#
# A deterministic subset of pytest's public API. It lives here, not in the
# job's files, so every exercise gets the same behaviour whatever pytest (if
# any) the host has installed. The attributes `_parametrize` (names, rows) and
# `_is_fixture` mirror the ~60-line stand-in some items used to ship, because
# hidden tests that run a learner's pytest-style suite by hand read them.


class Skipped(BaseException):
    """Raised by `pytest.skip()`. A BaseException, as in pytest, so that
    `except Exception:` in the code under test cannot swallow it."""

    def __init__(self, reason: str = ""):
        super().__init__(reason)
        self.reason = reason


class Failed(AssertionError):
    """Raised by `pytest.fail()` and by `pytest.raises` when nothing was raised."""


def pytest_fail(reason: str = "", pytrace: bool = True):
    raise Failed(reason or "failed")


def pytest_skip(reason: str = "", *, allow_module_level: bool = False):
    raise Skipped(reason)


class ExceptionInfo:
    """What `with pytest.raises(...) as excinfo` binds; filled in on exit."""

    def __init__(self):
        self.type: type[BaseException] | None = None
        self.value: BaseException | None = None
        self.tb = None

    @property
    def typename(self) -> str:
        return self.type.__name__ if self.type else ""

    def match(self, regexp) -> bool:
        if not re.search(regexp, str(self.value)):
            raise AssertionError(f"Regex pattern did not match.\n Regex: {regexp!r}\n Input: {str(self.value)[:REPR_CAP]!r}")
        return True

    def errisinstance(self, exc) -> bool:
        return isinstance(self.value, exc)

    def __repr__(self) -> str:
        return f"<ExceptionInfo {self.value!r}>" if self.value is not None else "<ExceptionInfo for raises contextmanager>"


def _exc_names(expected) -> str:
    if isinstance(expected, tuple):
        return " or ".join(getattr(t, "__name__", repr(t)) for t in expected)
    return getattr(expected, "__name__", repr(expected))


class RaisesContext:
    def __init__(self, expected, match=None):
        types_ = expected if isinstance(expected, tuple) else (expected,)
        if not types_ or not all(isinstance(t, type) and issubclass(t, BaseException) for t in types_):
            raise TypeError(f"expected exception must be a BaseException type, not {expected!r}")
        self.expected = expected if isinstance(expected, tuple) else expected
        self.match_expr = match
        self.excinfo = ExceptionInfo()

    def __enter__(self) -> ExceptionInfo:
        return self.excinfo

    def __exit__(self, exc_type, exc, tb):
        if exc_type is None:
            raise Failed(f"DID NOT RAISE {_exc_names(self.expected)}")
        if not issubclass(exc_type, self.expected):
            return False
        self.excinfo.type, self.excinfo.value, self.excinfo.tb = exc_type, exc, tb
        if self.match_expr is not None and not re.search(self.match_expr, str(exc)):
            raise AssertionError(
                f"Regex pattern did not match.\n Regex: {self.match_expr!r}\n Input: {str(exc)[:REPR_CAP]!r}"
            )
        return True


def pytest_raises(expected_exception, *args, match=None, **kwargs):
    """`with pytest.raises(E, match=...) as info:` or `pytest.raises(E, fn, *args, **kwargs)`."""
    context = RaisesContext(expected_exception, match)
    if not args:
        if kwargs:
            raise TypeError(f"unexpected keyword arguments for pytest.raises: {', '.join(sorted(kwargs))}")
        return context
    func, *rest = args
    if not callable(func):
        raise TypeError(f"{func!r} object (type: {type(func).__name__}) must be callable")
    with context:
        func(*rest, **kwargs)
    return context.excinfo


def _is_number(value) -> bool:
    import numbers

    return isinstance(value, numbers.Number) and not isinstance(value, bool)


class ApproxValue:
    """`pytest.approx`: equality within max(rel * |expected|, abs) — or within
    `abs` alone when only `abs` is given — like pytest. Works on numbers,
    sequences (element-wise, same length) and mappings (same keys)."""

    __hash__ = None  # type: ignore[assignment]

    def __init__(self, expected, rel=None, abs=None, nan_ok: bool = False):  # noqa: A002 (pytest's names)
        if rel is not None and rel < 0 or abs is not None and abs < 0:
            raise ValueError("approx tolerances must be non-negative")
        self.expected, self.rel, self.abs, self.nan_ok = expected, rel, abs, nan_ok

    def _tolerance(self, expected) -> float:
        abs_tol = 1e-12 if self.abs is None else self.abs
        if self.rel is None and self.abs is not None:
            return abs_tol
        rel_tol = 1e-6 if self.rel is None else self.rel
        return max(rel_tol * builtins.abs(expected), abs_tol)

    def _scalar_eq(self, expected, actual) -> bool:
        if not _is_number(expected):
            return expected == actual
        if not _is_number(actual):
            return False
        import cmath
        import math

        if expected == actual:
            return True
        if isinstance(expected, complex) or isinstance(actual, complex):
            if cmath.isnan(expected) or cmath.isnan(actual):
                return self.nan_ok and cmath.isnan(expected) and cmath.isnan(actual)
            if cmath.isinf(expected) or cmath.isinf(actual):
                return False
        else:
            if math.isnan(expected) or math.isnan(actual):
                return self.nan_ok and math.isnan(expected) and math.isnan(actual)
            if math.isinf(expected) or math.isinf(actual):
                return False
        return builtins.abs(expected - actual) <= self._tolerance(expected)

    def _eq(self, expected, actual) -> bool:
        from collections.abc import Mapping

        if isinstance(expected, ApproxValue):
            return expected == actual
        if isinstance(expected, Mapping):
            if not isinstance(actual, Mapping) or set(actual) != set(expected):
                return False
            return all(self._eq(expected[k], actual[k]) for k in expected)
        if isinstance(expected, (list, tuple)):
            if isinstance(actual, (str, bytes)) or not hasattr(actual, "__len__") or not hasattr(actual, "__iter__"):
                return False
            items = list(actual)
            return len(items) == len(expected) and all(self._eq(e, a) for e, a in zip(expected, items))
        return self._scalar_eq(expected, actual)

    def __eq__(self, actual) -> bool:
        return self._eq(self.expected, actual)

    def __ne__(self, actual) -> bool:
        return not self == actual

    def __bool__(self):
        raise AssertionError("approx() is not supported in a boolean context. Did you mean: `assert a == approx(b)`?")

    def _repr(self, expected) -> str:
        from collections.abc import Mapping

        if isinstance(expected, Mapping):
            return "{" + ", ".join(f"{k!r}: {self._repr(v)}" for k, v in expected.items()) + "}"
        if isinstance(expected, list):
            return "[" + ", ".join(self._repr(v) for v in expected) + "]"
        if isinstance(expected, tuple):
            return "(" + ", ".join(self._repr(v) for v in expected) + ("," if len(expected) == 1 else "") + ")"
        if _is_number(expected) and not isinstance(expected, complex):
            return f"{expected} ± {self._tolerance(expected):.1e}"
        return repr(expected)

    def __repr__(self) -> str:
        return f"approx({self._repr(self.expected)})"


def pytest_approx(expected, rel=None, abs=None, nan_ok: bool = False):  # noqa: A002
    return ApproxValue(expected, rel=rel, abs=abs, nan_ok=nan_ok)


class ParameterSet:
    """`pytest.param(*values, id=None, marks=())`."""

    def __init__(self, values: tuple, id: str | None, marks):  # noqa: A002
        self.values = values
        self.id = id
        self.marks = list(marks) if isinstance(marks, (list, tuple)) else [marks]

    def __repr__(self) -> str:
        return f"param{self.values!r}"


def pytest_param(*values, id=None, marks=()):  # noqa: A002
    return ParameterSet(values, id, marks)


class MarkDecorator:
    """`@pytest.mark.<name>` / `@pytest.mark.<name>(...)`. Recorded on the
    function in `__dojo_marks__`; only skip and skipif change anything."""

    def __init__(self, name: str, args: tuple = (), kwargs: dict | None = None):
        self.name, self.args, self.kwargs = name, args, kwargs or {}

    def __call__(self, *args, **kwargs):
        if len(args) == 1 and not kwargs and (inspect.isfunction(args[0]) or inspect.isclass(args[0])):
            fn = args[0]
            fn.__dict__.setdefault("__dojo_marks__", []).append(self)
            return fn
        return MarkDecorator(self.name, self.args + args, {**self.kwargs, **kwargs})

    def __repr__(self) -> str:
        return f"<MarkDecorator {self.name}>"


def _parametrize(argnames, argvalues, indirect=False, ids=None, scope=None):
    if indirect:
        raise TypeError("pytest.mark.parametrize(indirect=...) is not supported in dojo exercises")
    if isinstance(argnames, str):
        names = [n.strip() for n in argnames.split(",") if n.strip()]
    else:
        names = [str(n) for n in argnames]
    if not names:
        raise TypeError("pytest.mark.parametrize needs at least one argument name")
    rows = list(argvalues)
    if ids is not None and not callable(ids):
        ids = list(ids)

    def decorate(fn):
        layers = list(fn.__dict__.get("__dojo_parametrize__", ())) + [(names, rows, ids)]
        fn.__dojo_parametrize__ = layers
        if len(layers) == 1:
            fn._parametrize = (names, [(_plain(r) if len(names) > 1 else _plain(r)[0]) if isinstance(r, ParameterSet) else r for r in rows])
        else:
            all_names = [n for layer in layers for n in layer[0]]
            combined = []
            for combo in itertools.product(*(layer[1] for layer in layers)):
                values: list = []
                for (layer_names, _, _), row in zip(layers, combo):
                    values.extend(_row_values(row, layer_names))
                combined.append(tuple(values))
            fn._parametrize = (all_names, combined)
        return fn

    return decorate


def _plain(row) -> tuple:
    return row.values if isinstance(row, ParameterSet) else row


def _row_values(row, names: list[str]) -> tuple:
    if isinstance(row, ParameterSet):
        return tuple(row.values)
    if len(names) == 1:
        return (row,)
    return tuple(row)


class _MarkGenerator:
    def __getattr__(self, name: str):
        if name.startswith("_"):
            raise AttributeError(name)
        if name == "parametrize":
            return _parametrize
        return MarkDecorator(name)


def pytest_fixture(fixture_function=None, *, scope: str = "function", params=None, autouse: bool = False, ids=None, name: str | None = None):
    """`@pytest.fixture` / `@pytest.fixture(autouse=True, name=...)`. Every scope
    behaves as function scope; `params` is not supported."""
    if params is not None:
        raise TypeError("pytest.fixture(params=...) is not supported in dojo exercises; use mark.parametrize")

    def decorate(fn):
        fn._is_fixture = True
        fn.__dojo_fixture__ = {"name": name or fn.__name__, "autouse": bool(autouse), "scope": scope}
        return fn

    if fixture_function is not None and callable(fixture_function):
        return decorate(fixture_function)
    return decorate


_NOTSET = object()


class MonkeyPatch:
    """`monkeypatch`: every change is undone by `undo()` (after each test)."""

    def __init__(self):
        self._setattr: list[tuple[object, str, object]] = []
        self._setitem: list[tuple[object, object, object]] = []
        self._env: list[tuple[str, str | None]] = []
        self._cwd: str | None = None
        self._syspath: list[str] | None = None

    @classmethod
    @contextlib.contextmanager
    def context(cls):
        mp = cls()
        try:
            yield mp
        finally:
            mp.undo()

    @staticmethod
    def _resolve(dotted: str):
        parts = dotted.split(".")
        for i in range(len(parts) - 1, 0, -1):
            modname = ".".join(parts[:i])
            try:
                target = importlib.import_module(modname)
            except ImportError:
                continue
            for attr in parts[i:-1]:
                target = getattr(target, attr)
            return target, parts[-1]
        raise AttributeError(f"cannot resolve {dotted!r}: no importable module prefix")

    def setattr(self, target, name, value=_NOTSET, raising: bool = True):
        if value is _NOTSET:
            if not isinstance(target, str):
                raise TypeError("use setattr(target, name, value) or setattr('module.attr', value)")
            value = name
            target, name = self._resolve(target)
        old = getattr(target, name, _NOTSET)
        if raising and old is _NOTSET:
            raise AttributeError(f"{target!r} has no attribute {name!r}")
        if inspect.isclass(target):  # keep staticmethod/classmethod wrappers
            old = target.__dict__.get(name, old)
        self._setattr.append((target, name, old))
        builtins.setattr(target, name, value)

    def delattr(self, target, name=_NOTSET, raising: bool = True):
        if name is _NOTSET:
            if not isinstance(target, str):
                raise TypeError("use delattr(target, name) or delattr('module.attr')")
            target, name = self._resolve(target)
        if not hasattr(target, name):
            if raising:
                raise AttributeError(name)
            return
        old = getattr(target, name)
        if inspect.isclass(target):
            old = target.__dict__.get(name, old)
        self._setattr.append((target, name, old))
        builtins.delattr(target, name)

    def setitem(self, dic, name, value):
        self._setitem.append((dic, name, dic.get(name, _NOTSET) if hasattr(dic, "get") else (dic[name] if name in dic else _NOTSET)))
        dic[name] = value

    def delitem(self, dic, name, raising: bool = True):
        if name not in dic:
            if raising:
                raise KeyError(name)
            return
        self._setitem.append((dic, name, dic[name]))
        del dic[name]

    def setenv(self, name: str, value, prepend: str | None = None):
        value = str(value)
        if prepend and name in os.environ:
            value = value + prepend + os.environ[name]
        self._env.append((name, os.environ.get(name)))
        os.environ[name] = value

    def delenv(self, name: str, raising: bool = True):
        if name not in os.environ:
            if raising:
                raise KeyError(name)
            return
        self._env.append((name, os.environ.get(name)))
        del os.environ[name]

    def syspath_prepend(self, path):
        if self._syspath is None:
            self._syspath = list(sys.path)
        sys.path.insert(0, os.fspath(path))
        importlib.invalidate_caches()

    def chdir(self, path):
        if self._cwd is None:
            self._cwd = os.getcwd()
        os.chdir(os.fspath(path))

    def undo(self):
        for target, name, old in reversed(self._setattr):
            if old is _NOTSET:
                try:
                    builtins.delattr(target, name)
                except AttributeError:
                    pass
            else:
                builtins.setattr(target, name, old)
        self._setattr.clear()
        for dic, name, old in reversed(self._setitem):
            if old is _NOTSET:
                dic.pop(name, None) if hasattr(dic, "pop") else None
            else:
                dic[name] = old
        self._setitem.clear()
        for name, old in reversed(self._env):
            if old is None:
                os.environ.pop(name, None)
            else:
                os.environ[name] = old
        self._env.clear()
        if self._cwd is not None:
            os.chdir(self._cwd)
            self._cwd = None
        if self._syspath is not None:
            sys.path[:] = self._syspath
            self._syspath = None


class CaptureResult(tuple):
    """`capsys.readouterr()` result: `.out` and `.err`."""

    def __new__(cls, out: str, err: str):
        return super().__new__(cls, (out, err))

    @property
    def out(self) -> str:
        return self[0]

    @property
    def err(self) -> str:
        return self[1]


class CaptureFixture:
    """`capsys`: sys.stdout / sys.stderr go to buffers for the test's duration."""

    def __init__(self):
        self._out = io.StringIO()
        self._err = io.StringIO()
        self._saved = None

    def _start(self):
        self._saved = (sys.stdout, sys.stderr)
        sys.stdout, sys.stderr = self._out, self._err

    def _stop(self):
        if self._saved is None:
            return
        out, err = self.readouterr()
        sys.stdout, sys.stderr = self._saved
        self._saved = None
        # Whatever the test did not read still shows up in the test's output.
        if out:
            sys.stdout.write(out)
        if err:
            sys.stderr.write(err)

    def readouterr(self) -> CaptureResult:
        result = CaptureResult(self._out.getvalue(), self._err.getvalue())
        for buf in (self._out, self._err):
            buf.seek(0)
            buf.truncate()
        return result

    @contextlib.contextmanager
    def disabled(self):
        current = (sys.stdout, sys.stderr)
        sys.stdout, sys.stderr = self._saved or current
        try:
            yield
        finally:
            sys.stdout, sys.stderr = current


def _install_pytest_module() -> types.ModuleType:
    mod = types.ModuleType("pytest")
    mod.__doc__ = "Dojo's built-in pytest subset (see dojo_harness.py)."
    mod.__version__ = "0.0.0+dojo"
    mod.raises = pytest_raises
    mod.approx = pytest_approx
    mod.fixture = pytest_fixture
    mod.mark = _MarkGenerator()
    mod.param = pytest_param
    mod.fail = pytest_fail
    mod.skip = pytest_skip
    mod.fail.Exception = Failed  # type: ignore[attr-defined]
    mod.skip.Exception = Skipped  # type: ignore[attr-defined]
    mod.MonkeyPatch = MonkeyPatch
    mod.CaptureFixture = CaptureFixture
    mod.ExceptionInfo = ExceptionInfo
    mod.MarkDecorator = MarkDecorator
    mod.ParameterSet = ParameterSet
    sys.modules["pytest"] = mod
    return mod


_PYTEST = _install_pytest_module()


# ───────────────────────────── assert rewriting ─────────────────────────────

_CMP_OPS = {
    ast.Eq: ("==", operator.eq),
    ast.NotEq: ("!=", operator.ne),
    ast.Lt: ("<", operator.lt),
    ast.LtE: ("<=", operator.le),
    ast.Gt: (">", operator.gt),
    ast.GtE: (">=", operator.ge),
    ast.Is: ("is", operator.is_),
    ast.IsNot: ("is not", operator.is_not),
    ast.In: ("in", lambda a, b: a in b),
    ast.NotIn: ("not in", lambda a, b: a not in b),
}
_OP_BY_SYMBOL = {sym: fn for sym, fn in _CMP_OPS.values()}


def _short_repr(value) -> str:
    try:
        text = repr(value)
    except Exception as error:  # a broken __repr__ must not hide the failure
        text = f"<repr failed: {type(error).__name__}>"
    return text if len(text) <= REPR_CAP else text[: REPR_CAP - 3] + "..."


def __dojo_cmp__(left, right, symbol: str, source: str, message=None):
    if _OP_BY_SYMBOL[symbol](left, right):
        return
    text = f"assert {source}\n  left:  {_short_repr(left)}\n  right: {_short_repr(right)}"
    if message is not None:
        text = f"{message}\n{text}"
    raise AssertionError(text[:MSG_CAP])


class _AssertRewriter(ast.NodeTransformer):
    def __init__(self, source: str):
        self.source = source

    def visit_Assert(self, node: ast.Assert):
        src = ast.get_source_segment(self.source, node.test) or ast.unparse(node.test)
        test = node.test
        if isinstance(test, ast.Compare) and len(test.ops) == 1 and type(test.ops[0]) in _CMP_OPS:
            symbol = _CMP_OPS[type(test.ops[0])][0]
            args = [test.left, test.comparators[0], ast.Constant(symbol), ast.Constant(src)]
            if node.msg is not None:
                args.append(node.msg)
            call = ast.Call(func=ast.Name("__dojo_cmp__", ast.Load()), args=args, keywords=[])
            return ast.copy_location(ast.Expr(call), node)
        if node.msg is None:
            node.msg = ast.Constant(f"assert {src}")
        return node


def _compile_tests(source: str, filename: str):
    tree = ast.parse(source, filename)
    tree = _AssertRewriter(source).visit(tree)
    ast.fix_missing_locations(tree)
    return compile(tree, filename, "exec")


# ───────────────────────────── budgets ─────────────────────────────


class _Budget:
    """Per-test line budget over user frames, with a soft wall-clock check.

    `deadline` is the current test's wall slice (or the job's deadline while
    importing); `job_deadline` is the whole run's. The wall check runs every
    WALL_CHECK_EVERY traced line events and every WALL_CHECK_EVERY frame calls
    (user or stdlib), so code that spends its time in stdlib Python (os.walk,
    json, re) between a few user lines still notices the deadline promptly.
    """

    WALL_CHECK_EVERY = 256  # power of two: the check is a bit mask

    def __init__(self, step_budget: int, deadline: float, user_files: set[str]):
        self.limit = step_budget
        self.deadline = deadline
        self.job_deadline = deadline
        self.user_files = user_files
        self.steps = 0
        self.calls = 0
        self.reason = ""

    def reset(self) -> None:
        self.steps = 0
        self.calls = 0

    def _check_wall(self) -> None:
        if _real_monotonic() > self.deadline:
            self.reason = "wall" if _real_monotonic() > self.job_deadline else "test_wall"
            raise StepBudgetExceeded("wall budget exhausted")

    def global_trace(self, frame, event, arg):
        self.calls += 1
        if not self.calls & (self.WALL_CHECK_EVERY - 1):
            self._check_wall()
        if frame.f_code.co_filename in self.user_files:
            return self.local_trace
        return None

    def local_trace(self, frame, event, arg):
        if event == "line":
            self.steps += 1
            if self.steps > self.limit:
                self.reason = "steps"
                raise StepBudgetExceeded("step budget exhausted")
            if not self.steps & (self.WALL_CHECK_EVERY - 1):
                self._check_wall()
        return self.local_trace

    @contextlib.contextmanager
    def active(self):
        self.reset()
        threading.settrace(self.global_trace)
        sys.settrace(self.global_trace)
        try:
            yield
        finally:
            sys.settrace(None)
            threading.settrace(None)  # type: ignore[arg-type]


def _on_alarm(signum, frame):
    raise WallTimeout("wall-clock budget exhausted")


def _alarm_usable() -> bool:
    return hasattr(signal, "setitimer") and threading.current_thread() is threading.main_thread()


@contextlib.contextmanager
def _wall_alarm(seconds: float):
    """SIGALRM backstop (main thread, POSIX only). Interrupts sleeps and blocking waits."""
    if not _alarm_usable():
        yield
        return
    previous = signal.signal(signal.SIGALRM, _on_alarm)
    signal.setitimer(signal.ITIMER_REAL, max(0.05, seconds))
    try:
        yield
    finally:
        signal.setitimer(signal.ITIMER_REAL, 0)
        signal.signal(signal.SIGALRM, previous)


def _rearm_alarm(at: float) -> None:
    """Moves the pending SIGALRM (armed by `_wall_alarm`) to monotonic time `at`."""
    if _alarm_usable() and signal.getsignal(signal.SIGALRM) is _on_alarm:
        signal.setitimer(signal.ITIMER_REAL, max(0.01, at - _real_monotonic()))


# ───────────────────────────── memory cap ─────────────────────────────

_MAC_BASE_VSZ: list[int] = []


def _vsz_bytes() -> int | None:
    """This process's virtual size: /proc on Linux, one `ps` call on macOS."""
    try:
        with _real_open("/proc/self/statm", encoding="ascii") as handle:
            return int(handle.read().split()[0]) * os.sysconf("SC_PAGE_SIZE")
    except (OSError, ValueError, IndexError):
        pass
    if sys.platform == "darwin":
        if not _MAC_BASE_VSZ:
            try:
                out = subprocess.run(["/bin/ps", "-o", "vsz=", "-p", str(os.getpid())], capture_output=True, text=True, timeout=5)
                _MAC_BASE_VSZ.append(int(out.stdout.strip()) * 1024)
            except (OSError, ValueError, subprocess.SubprocessError):
                _MAC_BASE_VSZ.append(0)
        return _MAC_BASE_VSZ[0] or None
    return None


@contextlib.contextmanager
def _memory_cap(megabytes: int):
    """RLIMIT_AS = current virtual size + `megabytes`, restored afterwards.

    See the module docstring for why the limit is relative on both systems.
    Any failure to apply it (no `resource` module, EINVAL, no VSZ reading)
    leaves the run uncapped rather than failing it; the hard timeout remains.
    """
    if megabytes <= 0:
        yield
        return
    try:
        import resource
    except ImportError:
        yield
        return
    saved = None
    base = _vsz_bytes()
    if base:
        try:
            saved = resource.getrlimit(resource.RLIMIT_AS)
            limit = base + megabytes * 1024 * 1024
            hard = saved[1]
            if hard != resource.RLIM_INFINITY and limit > hard:
                limit = hard
            try:
                resource.setrlimit(resource.RLIMIT_AS, (limit, hard))
            except ValueError:
                if not _MAC_BASE_VSZ:
                    raise
                _MAC_BASE_VSZ.clear()  # the process grew since it was measured
                base = _vsz_bytes()
                if not base:
                    raise
                resource.setrlimit(resource.RLIMIT_AS, (base + megabytes * 1024 * 1024, hard))
        except (ValueError, OSError):
            saved = None
    try:
        yield
    finally:
        if saved is not None:
            try:
                resource.setrlimit(resource.RLIMIT_AS, saved)
            except (ValueError, OSError):
                pass


# ───────────────────────────── files & modules ─────────────────────────────


def _module_name(path: str) -> str | None:
    if not path.endswith(".py"):
        return None
    parts = path[:-3].split("/")
    if parts[-1] == "__init__":
        parts = parts[:-1]
    if not parts or not all(p.isidentifier() for p in parts):
        return None
    return ".".join(parts)


def _check_files(files) -> list[dict]:
    if not isinstance(files, list):
        raise HarnessError("files must be a list")
    seen = set()
    out = []
    for f in files:
        if not isinstance(f, dict) or not isinstance(f.get("path"), str) or not isinstance(f.get("content"), str):
            raise HarnessError("every file needs a string path and content")
        p = f["path"]
        if p.startswith("/") or ".." in p.split("/") or not p or "\\" in p:
            raise HarnessError(f"unsafe path {p!r}")
        if p in seen:
            raise HarnessError(f"duplicate path {p!r}")
        seen.add(p)
        out.append({"path": p, "content": f["content"]})
    return out


class _Workspace:
    """A scratch directory holding one run's files, importable and cwd."""

    def __init__(self, parent: str | None, files: list[dict]):
        self.root = os.path.realpath(tempfile.mkdtemp(prefix="dojo-run-", dir=parent))
        self.files = files
        for f in files:
            target = os.path.join(self.root, f["path"])
            os.makedirs(os.path.dirname(target), exist_ok=True)
            with _real_open(target, "w", encoding="utf-8", newline="") as handle:
                handle.write(f["content"])
        self.user_files = {os.path.join(self.root, f["path"]) for f in files}
        self._saved_path = list(sys.path)
        self._saved_cwd = os.getcwd()

    def __enter__(self):
        _purge_user_modules()
        # A job that ships its own pytest.py / pytest/ package gets it instead of the built-in.
        self.own_pytest = any(f["path"] == "pytest.py" or f["path"].startswith("pytest/") for f in self.files)
        if self.own_pytest:
            sys.modules.pop("pytest", None)
        sys.path.insert(0, self.root)
        os.chdir(self.root)
        importlib.invalidate_caches()
        return self

    def __exit__(self, *exc):
        os.chdir(self._saved_cwd)
        sys.path[:] = self._saved_path
        _purge_user_modules(self.root)
        sys.modules["pytest"] = _PYTEST
        shutil.rmtree(self.root, ignore_errors=True)
        return False

    def rel(self, filename: str) -> str:
        if filename.startswith(self.root + os.sep):
            return filename[len(self.root) + 1 :].replace(os.sep, "/")
        return filename


_USER_ROOTS: set[str] = set()


def _purge_user_modules(root: str | None = None) -> None:
    """Drops modules loaded from any dojo scratch dir, so the next run re-imports them."""
    if root:
        _USER_ROOTS.add(root)
    prefixes = tuple(r + os.sep for r in _USER_ROOTS)
    if not prefixes:
        return
    for name, mod in list(sys.modules.items()):
        file = getattr(mod, "__file__", None) or ""
        if file.startswith(prefixes):
            del sys.modules[name]


def _user_frames(tb, ws: _Workspace) -> list[traceback.FrameSummary]:
    frames = [fr for fr in traceback.extract_tb(tb) if fr.filename in ws.user_files]
    out = []
    for fr in frames[-MAX_FRAMES:]:
        out.append(traceback.FrameSummary(ws.rel(fr.filename), fr.lineno, fr.name, line=fr.line))
    return out


def _describe_exception(error: BaseException, ws: _Workspace) -> dict:
    frames = _user_frames(error.__traceback__, ws)
    text = "Traceback (most recent call last):\n" if frames else ""
    text += "".join(traceback.format_list(frames))
    text += "".join(traceback.format_exception_only(type(error), error))
    out = {
        "exc": type(error).__name__,
        "msg": str(error)[:MSG_CAP],
        "frames": [[fr.filename, fr.lineno or 0, fr.name] for fr in frames],
        "traceback": text[-(MSG_CAP * 2) :],
    }
    if isinstance(error, MemoryError):
        out["fault"] = "memory_limit"
    return out


def _cap(text: str, limit: int) -> str:
    if len(text) <= limit:
        return text
    return text[:limit] + f"\n… [{len(text) - limit} more characters truncated]"


def _precompile(files: list[dict]) -> dict | None:
    for f in files:
        if not f["path"].endswith(".py"):
            continue
        try:
            compile(f["content"], f["path"], "exec", dont_inherit=True)
        except SyntaxError as error:
            result = {
                "status": "compile_error",
                "file": f["path"],
                "line": error.lineno or 0,
                "msg": error.msg or "invalid syntax",
                "runtime": RUNTIME_ID,
            }
            if error.offset:
                result["col"] = error.offset
            return result
        except ValueError as error:  # e.g. null bytes
            return {"status": "compile_error", "file": f["path"], "line": 0, "msg": str(error), "runtime": RUNTIME_ID}
    return None


# ───────────────────────────── running tests ─────────────────────────────


class _Env:
    def __init__(self, options: dict, workdir: str | None):
        self.seed = int(options.get("seed", 0))
        self.fake_clock = bool(options.get("fakeClock", False))
        self.step_budget = int(options.get("stepBudget", 2_000_000))
        self.wall_s = max(0.1, float(options.get("wallMs", 8_000)) / 1000.0)
        test_wall_ms = options.get("testWallMs")
        if test_wall_ms is None:
            self.test_wall_s = max(1.0, self.wall_s / 2)
        else:
            self.test_wall_s = max(0.05, float(test_wall_ms) / 1000.0)
        self.test_wall_s = min(self.test_wall_s, self.wall_s)
        memory = options.get("memoryMb", options.get("memoryHintMb"))
        self.memory_mb = DEFAULT_MEMORY_MB if memory is None else int(memory)
        self.workdir = workdir


def _load_tests_module(ws: _Workspace, tests_path: str, budget: _Budget):
    """Imports user modules, then the tests module. Returns (module, error_result)."""
    test_names = set()
    module_names = []
    for f in ws.files:
        name = _module_name(f["path"])
        if not name:
            continue
        if f["path"] == tests_path:
            test_names.add(name)
        else:
            module_names.append(name)
    tests_name = _module_name(tests_path)
    if not tests_name:
        raise HarnessError(f"tests path {tests_path!r} is not an importable module path")

    try:
        with budget.active():
            for name in module_names:
                importlib.import_module(name)
            tests_file = os.path.join(ws.root, tests_path)
            mod = types.ModuleType(tests_name)
            mod.__file__ = tests_file
            mod.__dict__["__dojo_cmp__"] = __dojo_cmp__
            mod.__dict__["clock"] = _CLOCK
            sys.modules[tests_name] = mod
            with _real_open(tests_file, encoding="utf-8") as handle:
                code = _compile_tests(handle.read(), tests_file)
            exec(code, mod.__dict__)
            return mod, None
    except (StepBudgetExceeded, WallTimeout):
        return None, {"status": "timeout", "scope": "import", "runtime": RUNTIME_ID}
    except SyntaxError as error:  # tests rewritten by AST; precompile already caught user files
        return None, {
            "status": "compile_error",
            "file": ws.rel(error.filename or tests_path),
            "line": error.lineno or 0,
            "msg": error.msg or "invalid syntax",
            "runtime": RUNTIME_ID,
        }
    except BaseException as error:  # noqa: BLE001  — any import failure is the learner's
        if isinstance(error, KeyboardInterrupt):
            raise
        return None, {"status": "import_error", **_describe_exception(error, ws), "runtime": RUNTIME_ID}


def _collect(mod) -> list:
    out = []
    for name, value in list(mod.__dict__.items()):
        if not name.startswith("test_") or not callable(value) or not inspect.isfunction(value):
            continue
        if getattr(value, "__module__", None) != mod.__name__:
            continue
        out.append((name, value))
    return out


_BUILTIN_FIXTURES = ("clock", "tmp_path", "rng", "monkeypatch", "capsys")


def _module_fixtures(mod) -> tuple[dict, list[str]]:
    """`@pytest.fixture` functions visible in the tests module, by fixture name."""
    found: dict = {}
    autouse: list[str] = []
    for key, value in list(mod.__dict__.items()):
        if not callable(value) or not getattr(value, "_is_fixture", False):
            continue
        meta = getattr(value, "__dojo_fixture__", None) or {}
        name = meta.get("name") or key
        found[name] = value
        if meta.get("autouse") and name not in autouse:
            autouse.append(name)
    return found, autouse


class _Fixtures:
    """Function-scoped fixture values for one test case, torn down in reverse."""

    def __init__(self, module_fixtures: dict, env: _Env, ws: _Workspace, tmp_name: str, params: dict):
        self.module_fixtures = module_fixtures
        self.env = env
        self.ws = ws
        self.tmp_name = tmp_name
        self.values = dict(params)
        self.finalizers: list[tuple[str, object]] = []
        self.resolving: list[str] = []

    def available(self, name: str) -> bool:
        return name in self.values or name in self.module_fixtures or name in _BUILTIN_FIXTURES

    def _builtin(self, name: str):
        if name == "clock":
            return _CLOCK
        if name == "tmp_path":
            path = pathlib.Path(self.ws.root, ".dojo_tmp", *self.tmp_name.split("/"))
            path.mkdir(parents=True, exist_ok=True)
            return path
        if name == "rng":
            return random.Random(self.env.seed)
        if name == "monkeypatch":
            mp = MonkeyPatch()
            self.finalizers.append((name, mp.undo))
            return mp
        if name == "capsys":
            cap = CaptureFixture()
            cap._start()
            self.finalizers.append((name, cap._stop))
            return cap
        raise KeyError(name)

    def get(self, name: str, requester: str):
        if name in self.values:
            return self.values[name]
        if name in self.resolving:
            raise HarnessError(f"fixture {name!r} depends on itself ({' -> '.join(self.resolving + [name])})")
        fx = self.module_fixtures.get(name)
        if fx is not None:
            self.resolving.append(name)
            try:
                result = fx(**self.kwargs_for(fx, f"fixture {name!r}"))
            finally:
                self.resolving.pop()
            if inspect.isgenerator(result):
                try:
                    value = next(result)
                except StopIteration:
                    raise HarnessError(f"fixture {name!r} did not yield a value") from None
                self.finalizers.append((name, result))
            else:
                value = result
        elif name in _BUILTIN_FIXTURES:
            value = self._builtin(name)
        else:
            names = sorted(set(_BUILTIN_FIXTURES) | set(self.module_fixtures))
            raise HarnessError(f"{requester}: unsupported fixture {name!r} (available: {', '.join(names)})")
        self.values[name] = value
        return value

    def kwargs_for(self, fn, requester: str) -> dict:
        kwargs = {}
        for param in inspect.signature(fn).parameters.values():
            if param.kind in (inspect.Parameter.VAR_POSITIONAL, inspect.Parameter.VAR_KEYWORD):
                continue
            if param.default is not inspect.Parameter.empty and not self.available(param.name):
                continue
            kwargs[param.name] = self.get(param.name, requester)
        return kwargs

    def close(self) -> None:
        """Runs teardowns in reverse order; re-raises the first failure."""
        first: BaseException | None = None
        for name, finalizer in reversed(self.finalizers):
            try:
                if inspect.isgenerator(finalizer):
                    try:
                        next(finalizer)
                    except StopIteration:
                        pass
                    else:
                        raise HarnessError(f"fixture {name!r} yielded more than once")
                else:
                    finalizer()
            except KeyboardInterrupt:
                raise
            except BaseException as error:  # noqa: BLE001
                first = first or error
        self.finalizers.clear()
        if first is not None:
            raise first


def _marks(obj) -> list:
    return list(getattr(obj, "__dojo_marks__", ()))


def _skip_reason(marks: list) -> str | None:
    for mark in marks:
        if mark.name == "skip":
            return str(mark.kwargs.get("reason", mark.args[0] if mark.args else "skipped"))
        if mark.name == "skipif":
            conditions = mark.args or (mark.kwargs.get("condition"),)
            if any(bool(c) for c in conditions):
                return str(mark.kwargs.get("reason", "skipped (skipif)"))
    return None


def _idval(value, argname: str, index: int) -> str:
    if isinstance(value, str):
        return value if value.isascii() and value.isprintable() else value.encode("unicode_escape").decode("ascii")
    if isinstance(value, bytes):
        return value.decode("ascii", "backslashreplace")
    if value is None or isinstance(value, (bool, int, float, complex)):
        return str(value)
    import enum

    if isinstance(value, enum.Enum):
        return str(value)
    if inspect.isclass(value) or inspect.isfunction(value):
        return value.__name__
    return f"{argname}{index}"


def _expand_cases(fn) -> list[tuple[str | None, dict, list]]:
    """[(case id, parameter values, marks)], in pytest's order; [(None, {}, [])] if not parametrized."""
    layers = getattr(fn, "__dojo_parametrize__", None)
    if not layers:
        return [(None, {}, [])]
    per_layer = []
    for names, rows, ids in layers:
        entries = []
        for i, row in enumerate(rows):
            values = _row_values(row, names)
            if len(values) != len(names):
                raise HarnessError(f"{fn.__name__}: parametrize case {i} has {len(values)} value(s) for {len(names)} name(s) {names}")
            case_id = row.id if isinstance(row, ParameterSet) else None
            if case_id is None and ids is not None:
                if callable(ids):
                    parts = [ids(v) for v in values]
                    case_id = "-".join(p if p is not None else _idval(v, n, i) for p, v, n in zip(parts, values, names))
                else:
                    if i >= len(ids):
                        raise HarnessError(f"{fn.__name__}: {len(ids)} ids for {len(rows)} parametrize cases")
                    case_id = ids[i]
            if case_id is None:
                case_id = "-".join(_idval(v, n, i) for v, n in zip(values, names))
            marks = row.marks if isinstance(row, ParameterSet) else []
            entries.append([str(case_id), dict(zip(names, values)), list(marks)])
        counts: dict[str, int] = {}
        for entry in entries:
            counts[entry[0]] = counts.get(entry[0], 0) + 1
        seen: dict[str, int] = {}
        for entry in entries:  # duplicate ids get an index suffix, as in pytest
            if counts[entry[0]] > 1:
                n = seen.get(entry[0], 0)
                seen[entry[0]] = n + 1
                entry[0] = f"{entry[0]}{n}"
        per_layer.append(entries)
    cases = []
    for combo in itertools.product(*per_layer):
        params: dict = {}
        marks: list = []
        for case_id, values, case_marks in combo:
            params.update(values)
            marks.extend(case_marks)
        cases.append(("-".join(c[0] for c in combo), params, marks))
    return cases


def _classify(error: BaseException, name: str, ws: _Workspace, deadline: float) -> dict:
    """Turns what a test raised into a failing TestOutcome (without `ms`)."""
    if isinstance(error, (StepBudgetExceeded, WallTimeout, asyncio.TimeoutError, TimeoutError)):
        if isinstance(error, TimeoutError) and not isinstance(error, asyncio.TimeoutError) and _real_monotonic() < deadline:
            return {"id": name, "ok": False, "kind": "error", **_describe_exception(error, ws)}
        return {"id": name, "ok": False, "kind": "timeout"}
    if isinstance(error, HarnessError):
        return {"id": name, "ok": False, "kind": "error", "exc": "HarnessError", "msg": str(error), "frames": [], "traceback": str(error)}
    if isinstance(error, AssertionError):
        frames = [fr for fr in traceback.extract_tb(error.__traceback__) if fr.filename in ws.user_files]
        test_file = os.path.join(ws.root, ws_tests_path(ws))
        in_tests = [fr for fr in frames if fr.filename == test_file]
        where = (in_tests or frames or [None])[-1]
        return {
            "id": name,
            "ok": False,
            "kind": "assert",
            "msg": (str(error) or "assertion failed")[:MSG_CAP],
            "file": ws.rel(where.filename) if where else "",
            "line": (where.lineno or 0) if where else 0,
        }
    # SystemExit from user code is a failure too; MemoryError carries fault "memory_limit".
    return {"id": name, "ok": False, "kind": "error", **_describe_exception(error, ws)}


def _run_case(name: str, fn, params: dict, tmp_name: str, env: _Env, ws: _Workspace, budget: _Budget,
              fixtures: tuple[dict, list[str]], deadline: float, out: io.StringIO) -> dict | str | None:
    """One call of a test function. None = passed, str = skipped (reason), dict = failure."""
    _CLOCK.reset()
    random.seed(env.seed)
    module_fixtures, autouse = fixtures
    try:
        with contextlib.redirect_stdout(out), contextlib.redirect_stderr(out), budget.active():
            scope = _Fixtures(module_fixtures, env, ws, tmp_name, params)
            try:
                for fixture_name in autouse:
                    scope.get(fixture_name, name)
                kwargs = scope.kwargs_for(fn, name)
                if inspect.iscoroutinefunction(fn):
                    remaining = max(0.05, deadline - _real_monotonic())
                    asyncio.run(asyncio.wait_for(fn(**kwargs), remaining))
                else:
                    result = fn(**kwargs)
                    if inspect.iscoroutine(result):
                        result.close()
                        raise HarnessError(f"{name} returned a coroutine; declare it `async def`")
            except KeyboardInterrupt:
                raise
            except BaseException:
                try:
                    scope.close()
                except KeyboardInterrupt:
                    raise
                except BaseException:  # noqa: BLE001  — the test's own failure is the one to report
                    pass
                raise
            scope.close()
        return None
    except KeyboardInterrupt:
        raise
    except Skipped as skip:
        return skip.reason or "skipped"
    except BaseException as error:  # noqa: BLE001
        return _classify(error, name, ws, deadline)


def _run_one(name, fn, env: _Env, ws: _Workspace, budget: _Budget, job_deadline: float, fixtures=None) -> tuple[dict, str]:
    """Runs every case of one test id inside its wall slice."""
    started = _real_perf_counter()
    deadline = min(job_deadline, _real_monotonic() + env.test_wall_s)
    budget.deadline = deadline
    budget.job_deadline = job_deadline
    budget.reason = ""
    _rearm_alarm(deadline + TEST_ALARM_GRACE)
    out = io.StringIO()
    outcome: dict = {"id": name, "ok": True}
    try:
        try:
            reason = _skip_reason(_marks(fn))
            if reason is not None:
                outcome["skipped"] = reason
            else:
                cases = _expand_cases(fn)
                if not cases:
                    outcome["skipped"] = "got empty parameter set"
                skipped: list[str] = []
                for index, (case_id, params, case_marks) in enumerate(cases):
                    case_reason = _skip_reason(case_marks)
                    if case_reason is None:
                        tmp_name = name if case_id is None else f"{name}/{index}"
                        result = _run_case(name, fn, params, tmp_name, env, ws, budget, fixtures or ({}, []), deadline, out)
                    else:
                        result = case_reason
                    if isinstance(result, str):
                        skipped.append(result)
                    elif isinstance(result, dict):
                        outcome = result
                        if case_id is not None:
                            outcome["case"] = case_id
                            if "msg" in outcome:
                                outcome["msg"] = f"[{case_id}] {outcome['msg']}"[:MSG_CAP]
                        break
                if outcome["ok"] and cases and len(skipped) == len(cases):
                    outcome["skipped"] = skipped[0]
        except HarnessError as error:
            outcome = _classify(error, name, ws, deadline)
        except WallTimeout:
            outcome = {"id": name, "ok": False, "kind": "timeout"}
    finally:
        _rearm_alarm(job_deadline + 0.5)
    outcome["ms"] = round((_real_perf_counter() - started) * 1000, 1)
    printed = out.getvalue()
    if printed:
        outcome["stdout"] = _cap(printed, TEST_STDOUT_CAP)
    return outcome, printed


def ws_tests_path(ws: _Workspace) -> str:
    return getattr(ws, "tests_path", "")


def _run_tests(files: list[dict], tests: dict, env: _Env) -> dict:
    started = _real_perf_counter()
    all_files = files + [tests]
    _check_files(all_files)
    bad = _precompile(all_files)
    if bad:
        return bad
    deadline = _real_monotonic() + env.wall_s
    clock = _CLOCK if env.fake_clock else None
    with _Workspace(env.workdir, all_files) as ws, _patched_time(clock), _no_network():
        ws.tests_path = tests["path"]
        budget = _Budget(env.step_budget, deadline, ws.user_files)
        stdout = io.StringIO()
        saved_stdin = sys.stdin
        sys.stdin = io.StringIO("")
        try:
            with _wall_alarm(env.wall_s + 0.5):
                with contextlib.redirect_stdout(stdout), contextlib.redirect_stderr(stdout):
                    mod, error = _load_tests_module(ws, tests["path"], budget)
                if error:
                    return error
                results = []
                timed_out = False
                fixtures = _module_fixtures(mod)
                for name, fn in _collect(mod):
                    if timed_out or _real_monotonic() > deadline:
                        timed_out = True
                        results.append({"id": name, "ok": False, "kind": "timeout", "ms": 0.0})
                        continue
                    try:
                        outcome, printed = _run_one(name, fn, env, ws, budget, deadline, fixtures)
                    except WallTimeout:
                        outcome, printed = {"id": name, "ok": False, "kind": "timeout", "ms": 0.0}, ""
                    # A test that used up only its own slice does not stop the rest.
                    if outcome.get("kind") == "timeout" and (budget.reason == "wall" or _real_monotonic() > deadline):
                        timed_out = True
                    results.append(outcome)
                    if printed:
                        stdout.write(printed)
        except WallTimeout:
            return {"status": "timeout", "scope": "import", "runtime": RUNTIME_ID}
        finally:
            sys.stdin = saved_stdin
    passed = sum(1 for r in results if r["ok"])
    return {
        "status": "ok",
        "passed": passed,
        "total": len(results),
        "results": results,
        "stdout": _cap(stdout.getvalue(), STDOUT_CAP),
        "stderr": "",
        "runtime": RUNTIME_ID,
        "ms": round((_real_perf_counter() - started) * 1000, 1),
    }


def _collect_job(files: list[dict], tests: dict, env: _Env) -> dict:
    started = _real_perf_counter()
    all_files = files + [tests]
    _check_files(all_files)
    bad = _precompile(all_files)
    if bad:
        return bad
    deadline = _real_monotonic() + env.wall_s
    with _Workspace(env.workdir, all_files) as ws, _patched_time(_CLOCK if env.fake_clock else None), _no_network():
        budget = _Budget(env.step_budget, deadline, ws.user_files)
        sink = io.StringIO()
        with _wall_alarm(env.wall_s + 0.5), contextlib.redirect_stdout(sink), contextlib.redirect_stderr(sink):
            mod, error = _load_tests_module(ws, tests["path"], budget)
        if error:
            return error
        found = []
        for name, fn in _collect(mod):
            entry = {
                "id": name,
                "kcs": list(getattr(fn, "__dojo_kcs__", ())),
                "line": fn.__code__.co_firstlineno,
                "async": inspect.iscoroutinefunction(fn),
            }
            if getattr(fn, "__dojo_parametrize__", None):
                try:
                    entry["cases"] = [case_id for case_id, _, _ in _expand_cases(fn)]
                except HarnessError:
                    pass
            found.append(entry)
    return {"status": "collected", "tests": found, "runtime": RUNTIME_ID, "ms": round((_real_perf_counter() - started) * 1000, 1)}


def _merge_files(base: list[dict], patch: list[dict]) -> list[dict]:
    by_path = {f["path"]: f for f in base}
    for f in patch:
        by_path[f["path"]] = f
    return list(by_path.values())


def _run_mutants(job: dict, env: _Env) -> dict:
    started = _real_perf_counter()
    files = _check_files(job.get("files"))
    tests = job.get("tests")
    base = _run_tests(files, tests, env)
    if base["status"] != "ok" or base["total"] == 0 or base["passed"] != base["total"]:
        if base["status"] != "ok":
            return base
        return {"status": "tests_fail_on_reference", "base": base, "runtime": RUNTIME_ID,
                "ms": round((_real_perf_counter() - started) * 1000, 1)}
    verdicts = []
    for mutant in job.get("mutants") or []:
        if not isinstance(mutant, dict) or not isinstance(mutant.get("id"), str):
            raise HarnessError("every mutant needs an id")
        patched = _merge_files(files, _check_files(mutant.get("files")))
        result = _run_tests(patched, tests, env)
        if result["status"] != "ok":
            verdicts.append({"id": mutant["id"], "killed": True, "by": result["status"]})
            continue
        failing = next((r["id"] for r in result["results"] if not r["ok"]), None)
        verdicts.append({"id": mutant["id"], "killed": failing is not None, **({"by": failing} if failing else {})})
    return {
        "status": "mutants",
        "base": {"passed": base["passed"], "total": base["total"]},
        "mutants": verdicts,
        "runtime": RUNTIME_ID,
        "ms": round((_real_perf_counter() - started) * 1000, 1),
    }


def _run_script(job: dict, env: _Env) -> dict:
    started = _real_perf_counter()
    files = _check_files(job.get("files"))
    entry = job.get("entry")
    if not isinstance(entry, str) or entry not in {f["path"] for f in files}:
        raise HarnessError("entry must name one of the files")
    bad = _precompile(files)
    if bad:
        return bad
    deadline = _real_monotonic() + env.wall_s
    stdout = io.StringIO()
    stderr = io.StringIO()
    exception = None
    timed_out = False
    random.seed(env.seed)
    _CLOCK.reset()
    with _Workspace(env.workdir, files) as ws, _patched_time(_CLOCK if env.fake_clock else None), _no_network():
        budget = _Budget(env.step_budget, deadline, ws.user_files)
        saved = (sys.stdin, sys.argv)
        sys.stdin = io.StringIO(job.get("stdin") or "")
        sys.argv = [entry]
        try:
            with _wall_alarm(env.wall_s + 0.5), contextlib.redirect_stdout(stdout), contextlib.redirect_stderr(stderr), budget.active():
                import runpy

                runpy.run_path(os.path.join(ws.root, entry), run_name="__main__")
        except (StepBudgetExceeded, WallTimeout):
            timed_out = True
        except SystemExit as error:
            if error.code not in (None, 0):
                exception = _describe_exception(error, ws)
        except KeyboardInterrupt:
            raise
        except BaseException as error:  # noqa: BLE001
            exception = _describe_exception(error, ws)
        finally:
            sys.stdin, sys.argv = saved
    return {
        "status": "script",
        "stdout": _cap(stdout.getvalue(), STDOUT_CAP),
        "stderr": _cap(stderr.getvalue(), STDOUT_CAP),
        "exception": exception,
        "timedOut": timed_out,
        "runtime": RUNTIME_ID,
        "ms": round((_real_perf_counter() - started) * 1000, 1),
    }


def run_job(job: dict, workdir: str | None = None) -> dict:
    """Runs one RunJob dict and returns a RunResult dict. Never raises."""
    try:
        if not isinstance(job, dict):
            raise HarnessError("job must be an object")
        env = _Env(job.get("options") or {}, workdir)
        kind = job.get("kind")
        runners = {
            "tests": lambda: _run_tests(_check_files(job.get("files")), job.get("tests"), env),
            "mutants": lambda: _run_mutants(job, env),
            "script": lambda: _run_script(job, env),
            "collect": lambda: _collect_job(_check_files(job.get("files")), job.get("tests"), env),
        }
        if kind not in runners:
            raise HarnessError(f"unknown job kind {kind!r}")
        with _memory_cap(env.memory_mb):
            return runners[kind]()
    except HarnessError as error:
        return {"status": "harness_error", "msg": str(error), "runtime": RUNTIME_ID}
    except (StepBudgetExceeded, WallTimeout):
        return {"status": "timeout", "scope": "job", "runtime": RUNTIME_ID}
    except Exception as error:  # noqa: BLE001  — a harness bug must still produce JSON
        return {"status": "harness_error", "msg": f"{type(error).__name__}: {error}"[:MSG_CAP], "runtime": RUNTIME_ID}


# ───────────────────────────── CLI ─────────────────────────────


def _write_all(fd: int, data: bytes) -> None:
    view = memoryview(data)
    while view:
        written = os.write(fd, view)
        view = view[written:]


def _arm_hard_timeout(seconds: float, result_fd: int) -> int:
    """Last-resort kill for hangs the step budget and SIGALRM cannot reach.

    A C-level loop such as `sum(range(10**12))` never releases the GIL, so no
    Python thread could intervene; a forked watchdog process can. The harness
    becomes its own process-group leader first, so the kill also takes any
    subprocess or multiprocessing children the job started. Returns the write
    end of a pipe: closing it tells the watchdog the result is on its way.
    """
    try:
        os.setpgrp()
    except OSError:
        pass
    group = os.getpgrp()
    read_end, write_end = os.pipe()
    pid = os.fork()
    if pid == 0:  # the watchdog
        try:
            os.close(write_end)
            os.setpgrp()  # out of the group it is about to kill
            import select

            ready, _, _ = select.select([read_end], [], [], seconds)
            if not ready:
                try:
                    os.killpg(group, signal.SIGKILL)
                except OSError:
                    pass
                try:
                    _write_all(result_fd, (json.dumps({"status": "timeout", "scope": "job", "runtime": RUNTIME_ID}) + "\n").encode())
                except OSError:
                    pass
        finally:
            os._exit(0)
    os.close(read_end)
    return write_end


def _main(argv: list[str]) -> int:
    workdir = None
    if "--workdir" in argv:
        workdir = os.path.abspath(argv[argv.index("--workdir") + 1])
        os.makedirs(workdir, exist_ok=True)
    raw = sys.stdin.buffer.read().decode("utf-8")

    # Everything the job prints at the file-descriptor level (subprocesses,
    # os.write) goes to a scratch file, so fd 1 carries nothing but the result.
    result_fd = os.dup(1)
    sink = tempfile.TemporaryFile()
    os.dup2(sink.fileno(), 1)
    os.dup2(sink.fileno(), 2)
    watchdog = None
    if "--hard-timeout" in argv:
        watchdog = _arm_hard_timeout(float(argv[argv.index("--hard-timeout") + 1]), result_fd)
    output: dict = {"status": "harness_error", "msg": "no result", "runtime": RUNTIME_ID}
    try:
        try:
            payload = json.loads(raw)
        except json.JSONDecodeError as error:
            payload = None
            output = {"status": "harness_error", "msg": f"malformed job JSON: {error}", "runtime": RUNTIME_ID}
        if payload is not None:
            if isinstance(payload, dict) and isinstance(payload.get("jobs"), list):
                output = {"results": [run_job(job, workdir) for job in payload["jobs"]]}
            else:
                output = run_job(payload, workdir)
        sys.stdout.flush()
        sys.stderr.flush()
        sink.seek(0)
        stray = sink.read().decode("utf-8", "replace")
        if stray and isinstance(output, dict) and output.get("status") in ("ok", "script"):
            output["stderr"] = _cap((output.get("stderr") or "") + stray, STDOUT_CAP)
    finally:
        if watchdog is not None:
            os.close(watchdog)
        _write_all(result_fd, (json.dumps(output, ensure_ascii=False) + "\n").encode("utf-8"))
        os.close(result_fd)
    return 0


if __name__ == "__main__":
    sys.modules.setdefault("dojo_harness", sys.modules[__name__])
    raise SystemExit(_main(sys.argv[1:]))
