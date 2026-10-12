"""Self-test for dojo_harness.py. Run: python3 runner/python/dojo_harness_test.py

Every case goes through the real CLI (a subprocess fed JSON on stdin), which
is exactly how the sandbox runner and the content validator call it.
"""
from __future__ import annotations

import json
import os
import subprocess
import sys
import time
import unittest

HARNESS = os.path.join(os.path.dirname(os.path.abspath(__file__)), "dojo_harness.py")


def opts(**overrides):
    base = {"seed": 0, "fakeClock": False, "stepBudget": 200_000, "wallMs": 4_000, "asyncTests": False}
    base.update(overrides)
    return base


def run(job, timeout=30, env_extra=None, args=()):
    env = {**os.environ, "PYTHONHASHSEED": "0", **(env_extra or {})}
    proc = subprocess.run(
        [sys.executable, "-s", "-B", "-X", "utf8", HARNESS, *args],
        input=json.dumps(job).encode(),
        capture_output=True,
        timeout=timeout,
        env=env,
    )
    # A hard timeout SIGKILLs the harness's own group after the watchdog has
    # written the result, so -9 with a parseable result is the expected exit.
    assert proc.returncode in (0, -9), proc.stderr.decode()
    return json.loads(proc.stdout)


def tests_job(files, tests, **options):
    return {"kind": "tests", "files": files, "tests": {"path": "tests.py", "content": tests}, "options": opts(**options)}


CACHE = """import time
class TTLCache:
    def __init__(self, ttl):
        self.ttl = ttl
        self._d = {}
    def put(self, key, value):
        self._d[key] = (value, time.monotonic() + self.ttl)
    def get(self, key, default=None):
        hit = self._d.get(key)
        if hit is None or time.monotonic() >= hit[1]:
            return default
        return hit[0]
"""

CACHE_TESTS = """from dojo import kc
from cache import TTLCache

@kc("ttl-expiry")
def test_fresh(clock):
    c = TTLCache(10)
    c.put("a", 1)
    clock.advance(9.99)
    assert c.get("a") == 1

@kc("ttl-expiry", "boundary")
def test_expires_exactly_at_ttl(clock):
    c = TTLCache(10)
    c.put("a", 1)
    clock.advance(10)
    assert c.get("a") is None
"""


class HarnessTest(unittest.TestCase):
    def test_fake_clock_drives_ttl(self):
        result = run(tests_job([{"path": "cache.py", "content": CACHE}], CACHE_TESTS, fakeClock=True))
        self.assertEqual(result["status"], "ok", result)
        self.assertEqual((result["passed"], result["total"]), (2, 2))

    def test_clock_resets_between_tests_and_time_sleep_is_virtual(self):
        tests = """import time
def test_a(clock):
    start = time.time()
    time.sleep(3600)
    assert time.time() - start == 3600
def test_b(clock):
    assert clock.now() == 1_700_000_000.0
"""
        t0 = time.monotonic()
        result = run(tests_job([], tests, fakeClock=True))
        self.assertLess(time.monotonic() - t0, 10)
        self.assertEqual(result["passed"], 2, result)

    def test_assert_introspection_reports_both_sides(self):
        result = run(tests_job([], "def test_x():\n    xs = [1, 2]\n    assert xs == [1, 3]\n"))
        outcome = result["results"][0]
        self.assertEqual(outcome["kind"], "assert")
        self.assertEqual((outcome["file"], outcome["line"]), ("tests.py", 3))
        self.assertIn("left:  [1, 2]", outcome["msg"])
        self.assertIn("right: [1, 3]", outcome["msg"])

    def test_assert_is_evaluated_once(self):
        tests = "calls = []\ndef f():\n    calls.append(1)\n    return len(calls)\ndef test_x():\n    assert f() == 1\n    assert calls == [1]\n"
        self.assertEqual(run(tests_job([], tests))["passed"], 1)

    def test_infinite_loop_is_a_timeout_and_later_tests_still_run(self):
        tests = "def test_loop():\n    while True:\n        pass\ndef test_after():\n    assert True\n"
        result = run(tests_job([], tests, stepBudget=50_000))
        kinds = [r.get("kind", "ok") for r in result["results"]]
        self.assertEqual(kinds, ["timeout", "ok"], result)

    def test_except_exception_cannot_swallow_the_budget(self):
        tests = "def test_loop():\n    while True:\n        try:\n            while True: pass\n        except Exception:\n            pass\n"
        result = run(tests_job([], tests, stepBudget=20_000))
        self.assertEqual(result["results"][0]["kind"], "timeout")

    def test_blocking_sleep_hits_the_wall_alarm(self):
        tests = "import time\ndef test_sleep():\n    time.sleep(60)\n"
        t0 = time.monotonic()
        result = run(tests_job([], tests, wallMs=1_000))
        self.assertLess(time.monotonic() - t0, 10)
        self.assertEqual(result["results"][0]["kind"], "timeout", result)

    def test_compile_error(self):
        result = run(tests_job([{"path": "cache.py", "content": "def f(:\n  pass\n"}], "def test_x(): pass\n"))
        self.assertEqual(result["status"], "compile_error")
        self.assertEqual((result["file"], result["line"]), ("cache.py", 1))

    def test_import_error_carries_user_frames(self):
        files = [{"path": "cache.py", "content": "import nonexistent_module_xyz\n"}]
        result = run(tests_job(files, "import cache\ndef test_x(): pass\n"))
        self.assertEqual(result["status"], "import_error")
        self.assertEqual(result["exc"], "ModuleNotFoundError")
        self.assertEqual(result["frames"][-1][0], "cache.py")

    def test_infinite_loop_at_import_is_an_import_timeout(self):
        files = [{"path": "cache.py", "content": "while True:\n    pass\n"}]
        result = run(tests_job(files, "def test_x(): pass\n", stepBudget=20_000))
        self.assertEqual((result["status"], result.get("scope")), ("timeout", "import"))

    def test_stdout_is_captured_per_test_and_per_job(self):
        files = [{"path": "noisy.py", "content": "print('loaded')\n"}]
        tests = "import noisy, sys\ndef test_a():\n    print('from a')\n    print('err', file=sys.stderr)\n"
        result = run(tests_job(files, tests))
        self.assertEqual(result["results"][0]["stdout"], "from a\nerr\n")
        self.assertIn("loaded", result["stdout"])
        self.assertIn("from a", result["stdout"])

    def test_fd_level_output_does_not_corrupt_the_result(self):
        tests = "import os, subprocess, sys\ndef test_a():\n    os.write(1, b'raw fd write\\n')\n    subprocess.run([sys.executable, '-c', 'print(42)'])\n"
        result = run(tests_job([], tests))
        self.assertEqual(result["status"], "ok")
        self.assertIn("raw fd write", result["stderr"])
        self.assertIn("42", result["stderr"])

    def test_seeded_random_is_deterministic_per_test(self):
        tests = "import random\ndef test_a():\n    print(random.random())\ndef test_b():\n    print(random.random())\n"
        result = run(tests_job([], tests, seed=7))
        self.assertEqual(result["results"][0]["stdout"], result["results"][1]["stdout"])

    def test_network_is_stubbed(self):
        tests = "import socket\ndef test_a():\n    socket.create_connection(('example.com', 80))\ndef test_b():\n    socket.socket()\n"
        result = run(tests_job([], tests))
        self.assertEqual([r.get("exc") for r in result["results"]], ["PermissionError", "PermissionError"])

    def test_async_tests_and_asyncio_run_in_user_code(self):
        files = [{"path": "work.py", "content": "import asyncio\nasync def main():\n    r = await asyncio.gather(asyncio.sleep(0.01, 1), asyncio.sleep(0.01, 2))\n    return sum(r)\ndef sync_main():\n    return asyncio.run(main())\n"}]
        tests = "import asyncio, work\nasync def test_await():\n    assert await work.main() == 3\ndef test_asyncio_run():\n    assert work.sync_main() == 3\nasync def test_hang():\n    await asyncio.Event().wait()\n"
        result = run(tests_job(files, tests, fakeClock=True, asyncTests=True, wallMs=1_500))
        kinds = [r.get("kind", "ok") for r in result["results"]]
        self.assertEqual(kinds, ["ok", "ok", "timeout"], result)

    def test_threads_and_stress(self):
        files = [{"path": "counter.py", "content": "import threading\nclass Counter:\n    def __init__(self):\n        self.n = 0\n        self.lock = threading.Lock()\n    def inc(self):\n        with self.lock:\n            self.n += 1\n"}]
        tests = "import threading\nfrom dojo import stress\nfrom counter import Counter\ndef test_threads():\n    def once():\n        c = Counter()\n        ts = [threading.Thread(target=lambda: [c.inc() for _ in range(200)]) for _ in range(4)]\n        [t.start() for t in ts]\n        [t.join() for t in ts]\n        assert c.n == 800\n    stress(once, n=20)\n"
        result = run(tests_job(files, tests))
        self.assertEqual(result["passed"], 1, result)

    def test_torn_write(self):
        tests = "from dojo import torn_write, raises\ndef test_torn(tmp_path):\n    p = tmp_path / 'wal.log'\n    with torn_write(p, 10):\n        with raises(OSError):\n            with open(p, 'w') as f:\n                f.write('SET a 1\\nSET b 2\\n')\n    assert p.read_text() == 'SET a 1\\nSE'\n"
        result = run(tests_job([], tests))
        self.assertEqual(result["passed"], 1, result)

    def test_mutants_killed_and_survived(self):
        survivor = CACHE.replace("hit is None or", "hit is None or False or")
        killed = CACHE.replace(">=", ">")
        job = {
            "kind": "mutants",
            "files": [{"path": "cache.py", "content": CACHE}],
            "tests": {"path": "tests.py", "content": CACHE_TESTS},
            "mutants": [
                {"id": "off-by-one", "files": [{"path": "cache.py", "content": killed}]},
                {"id": "equivalent", "files": [{"path": "cache.py", "content": survivor}]},
                {"id": "broken", "files": [{"path": "cache.py", "content": "def ("}]},
            ],
            "options": opts(fakeClock=True),
        }
        result = run(job)
        self.assertEqual(result["status"], "mutants", result)
        verdicts = {m["id"]: m for m in result["mutants"]}
        self.assertEqual(verdicts["off-by-one"], {"id": "off-by-one", "killed": True, "by": "test_expires_exactly_at_ttl"})
        self.assertFalse(verdicts["equivalent"]["killed"])
        self.assertEqual(verdicts["broken"]["by"], "compile_error")

    def test_mutants_with_red_reference(self):
        job = {
            "kind": "mutants",
            "files": [{"path": "cache.py", "content": CACHE}],
            "tests": {"path": "tests.py", "content": "def test_wrong():\n    assert 1 == 2\n"},
            "mutants": [],
            "options": opts(),
        }
        self.assertEqual(run(job)["status"], "tests_fail_on_reference")

    def test_script_predict_mode(self):
        files = [{"path": "main.py", "content": "import sys\nprint(sys.stdin.read().upper(), end='')\nd = {}\nd['x']\n"}]
        result = run({"kind": "script", "files": files, "entry": "main.py", "stdin": "hi\n", "options": opts()})
        self.assertEqual(result["status"], "script")
        self.assertEqual(result["stdout"], "HI\n")
        self.assertEqual(result["exception"]["exc"], "KeyError")
        self.assertEqual(result["exception"]["frames"][-1][:2], ["main.py", 4])

    def test_script_timeout(self):
        files = [{"path": "main.py", "content": "while True:\n    pass\n"}]
        result = run({"kind": "script", "files": files, "entry": "main.py", "options": opts(stepBudget=10_000)})
        self.assertTrue(result["timedOut"])

    def test_collect_reports_kcs(self):
        result = run({"kind": "collect", "files": [{"path": "cache.py", "content": CACHE}], "tests": {"path": "tests.py", "content": CACHE_TESTS}, "options": opts()})
        self.assertEqual(result["status"], "collected")
        self.assertEqual(
            [(t["id"], t["kcs"]) for t in result["tests"]],
            [("test_fresh", ["ttl-expiry"]), ("test_expires_exactly_at_ttl", ["ttl-expiry", "boundary"])],
        )

    def test_modules_do_not_leak_between_runs_in_a_batch(self):
        first = tests_job([{"path": "m.py", "content": "X = 1\n"}], "import m\ndef test_x():\n    assert m.X == 1\n")
        second = tests_job([{"path": "m.py", "content": "X = 2\n"}], "import m\ndef test_x():\n    assert m.X == 2\n")
        env = {**os.environ}
        proc = subprocess.run([sys.executable, HARNESS], input=json.dumps({"jobs": [first, second]}).encode(), capture_output=True, env=env, timeout=30)
        results = json.loads(proc.stdout)["results"]
        self.assertEqual([r["passed"] for r in results], [1, 1], results)

    def test_harness_error_on_bad_job(self):
        self.assertEqual(run({"kind": "nope", "options": opts()})["status"], "harness_error")
        self.assertEqual(run(tests_job([{"path": "../x.py", "content": ""}], ""))["status"], "harness_error")

    def test_hard_timeout_kills_c_level_loops_and_children(self):
        src = "import subprocess, sys\nsubprocess.Popen([sys.executable, '-c', 'import time; time.sleep(30)  # dojo-orphan-probe'])\nsum(range(10**12))\n"
        job = {"kind": "script", "files": [{"path": "main.py", "content": src}], "entry": "main.py", "options": opts(wallMs=60_000)}
        t0 = time.monotonic()
        result = run(job, args=("--hard-timeout", "1.5"))
        self.assertLess(time.monotonic() - t0, 10)
        self.assertEqual((result["status"], result["scope"]), ("timeout", "job"))
        time.sleep(0.3)
        probe = subprocess.run(["pgrep", "-f", "dojo-orphan-probe"], capture_output=True)
        self.assertEqual(probe.stdout.strip(), b"", "child process outlived the hard timeout")

    def test_hard_timeout_does_not_fire_on_a_quick_job(self):
        result = run(tests_job([], "def test_x():\n    assert True\n"), args=("--hard-timeout", "5"))
        self.assertEqual(result["passed"], 1)

    def test_unsupported_fixture_is_reported(self):
        result = run(tests_job([], "def test_x(db):\n    pass\n"))
        self.assertIn("unsupported fixture", result["results"][0]["msg"])


    # ── (a) built-in pytest ──

    def test_builtin_pytest_raises_approx_parametrize_fixture_monkeypatch(self):
        tests = (
            "import os, pytest, time\n"
            "@pytest.fixture\n"
            "def store(tmp_path):\n"
            "    p = tmp_path / 's.txt'\n"
            "    p.write_text('x')\n"
            "    yield p\n"
            "    p.unlink()\n"
            "def test_raises():\n"
            "    with pytest.raises(KeyError, match='k') as info:\n"
            "        {}['k']\n"
            "    assert info.type is KeyError\n"
            "    pytest.raises(ZeroDivisionError, lambda: 1 / 0)\n"
            "def test_approx():\n"
            "    assert 0.1 + 0.2 == pytest.approx(0.3)\n"
            "    assert [0.1 + 0.2, 1.0] == pytest.approx([0.3, 1.0])\n"
            "    assert {'a': 0.30000001} == pytest.approx({'a': 0.3}, rel=1e-6)\n"
            "    assert 0.31 != pytest.approx(0.3)\n"
            "@pytest.mark.parametrize('a, b, total', [(1, 2, 3), (2, 2, 4)])\n"
            "def test_add(a, b, total):\n"
            "    assert a + b == total\n"
            "def test_fixture(store):\n"
            "    assert store.read_text() == 'x'\n"
            "def test_monkeypatch(monkeypatch):\n"
            "    monkeypatch.setattr(time, 'sleep', lambda s: None)\n"
            "    monkeypatch.setenv('DOJO_X', '1')\n"
            "    monkeypatch.setitem(os.environ, 'DOJO_Y', '2')\n"
            "    time.sleep(100)\n"
            "def test_monkeypatch_was_undone():\n"
            "    import time as t\n"
            "    assert 'DOJO_X' not in os.environ and 'DOJO_Y' not in os.environ\n"
            "    assert t.sleep.__name__ != '<lambda>'\n"
        )
        result = run(tests_job([], tests))
        self.assertEqual(result["status"], "ok", result)
        self.assertEqual(result["passed"], result["total"], result["results"])
        self.assertEqual([r["id"] for r in result["results"]], ["test_raises", "test_approx", "test_add", "test_fixture", "test_monkeypatch", "test_monkeypatch_was_undone"])

    def test_parametrize_failure_names_the_case_and_collect_lists_cases(self):
        tests = "import pytest\n@pytest.mark.parametrize('x', [1, 2, 3], ids=['one', 'two', 'three'])\ndef test_small(x):\n    assert x < 2\n"
        result = run(tests_job([], tests))
        failure = result["results"][0]
        self.assertFalse(failure["ok"])
        self.assertEqual(failure["case"], "two")
        self.assertTrue(failure["msg"].startswith("[two]"), failure["msg"])
        collected = run({"kind": "collect", "files": [], "tests": {"path": "tests.py", "content": tests}, "options": opts()})
        self.assertEqual(collected["tests"][0]["cases"], ["one", "two", "three"])

    def test_item_pytest_module_wins_over_the_builtin(self):
        files = [{"path": "pytest.py", "content": "MARKER = 'item'\n"}]
        result = run(tests_job(files, "import pytest\ndef test_x():\n    assert pytest.MARKER == 'item'\n"))
        self.assertEqual(result["passed"], 1, result)
        after = run({"jobs": [tests_job(files, "import pytest\ndef test_x():\n    assert pytest.MARKER == 'item'\n"),
                              tests_job([], "import pytest\ndef test_x():\n    assert hasattr(pytest, 'approx')\n")]})
        self.assertEqual([r["passed"] for r in after["results"]], [1, 1])

    def test_skip_counts_as_passed(self):
        result = run(tests_job([], "import pytest\n@pytest.mark.skip(reason='later')\ndef test_a():\n    assert False\ndef test_b():\n    pytest.skip('no')\n"))
        self.assertEqual(result["passed"], 2)
        self.assertEqual(result["results"][0]["skipped"], "later")

    # ── (b) separate wall and monotonic clocks ──

    def test_wall_clock_jumps_without_moving_monotonic(self):
        tests = (
            "import time\n"
            "def test_jump(clock):\n"
            "    w0, m0 = time.time(), time.monotonic()\n"
            "    clock.jump_wall(-3600)\n"
            "    assert time.time() == w0 - 3600\n"
            "    assert time.monotonic() == m0\n"
            "    clock.advance_monotonic(5)\n"
            "    assert time.monotonic() == m0 + 5 and time.time() == w0 - 3600\n"
            "    clock.advance(1)\n"
            "    assert time.monotonic() == m0 + 6 and time.time() == w0 - 3599\n"
            "    clock.set_wall(0)\n"
            "    assert time.time() == 0 and clock.wall() == 0 and clock.monotonic() == m0 + 6\n"
            "def test_reset_between_tests(clock):\n"
            "    assert time.monotonic() == 1000.0 and time.time() == clock.start\n"
        )
        result = run(tests_job([], tests, fakeClock=True))
        self.assertEqual(result["passed"], 2, result["results"])

    # ── (c) memory cap ──

    def test_memory_cap_turns_a_huge_allocation_into_a_memory_limit_fault(self):
        started = time.monotonic()
        result = run(tests_job([], "def test_big():\n    xs = list(range(10**10))\ndef test_after():\n    assert True\n", memoryMb=256))
        self.assertLess(time.monotonic() - started, 5)
        big, after = result["results"]
        self.assertEqual(big["kind"], "error")
        self.assertEqual(big["exc"], "MemoryError")
        self.assertEqual(big["fault"], "memory_limit")
        self.assertTrue(after["ok"])

    def test_memory_cap_zero_disables_it(self):
        result = run(tests_job([], "def test_ok():\n    xs = bytearray(64 * 1024 * 1024)\n    assert len(xs)\n", memoryMb=0))
        self.assertEqual(result["passed"], 1, result)

    # ── (d) fail fast ──

    def test_runaway_test_stops_at_its_own_slice(self):
        tests = "import os\ndef test_spin(tmp_path):\n    while True:\n        os.path.join('a', 'b')\ndef test_after():\n    assert True\n"
        started = time.monotonic()
        result = run(tests_job([], tests, wallMs=8_000, testWallMs=300, stepBudget=10**9))
        elapsed = time.monotonic() - started
        self.assertEqual(result["results"][0]["kind"], "timeout")
        self.assertTrue(result["results"][1]["ok"], "a test that used only its own slice must not stop the rest")
        self.assertLess(elapsed, 3)

    def test_stdlib_heavy_loop_notices_the_deadline(self):
        # Few user lines, most time in stdlib Python: the wall check runs on calls too.
        tests = "import json\ndef test_spin():\n    while True:\n        json.loads(json.dumps([list(range(50))] * 50))\n"
        started = time.monotonic()
        result = run(tests_job([], tests, wallMs=8_000, testWallMs=300, stepBudget=10**9))
        self.assertEqual(result["results"][0]["kind"], "timeout")
        self.assertLess(time.monotonic() - started, 3)


if __name__ == "__main__":
    unittest.main(verbosity=1)
