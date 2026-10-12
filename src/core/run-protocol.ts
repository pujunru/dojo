/**
 * Wire protocol between the app and a code runner executing
 * `runner/python/dojo_harness.py` (docs/ARCHITECTURE.md, "Code runners").
 *
 * The app ships no runner: a build registers one (`core/runner.ts`) for each
 * runtime it can execute. Without one, items that must run code are left out
 * of sessions and statically graded items still play.
 *
 * Every shape here is serialised to JSON exactly as written and read back by
 * the harness, so a field renamed here must be renamed in `dojo_harness.py`.
 * The module is runtime-free (types and pure helpers only) so that the
 * validator scripts and the browser can both import it.
 *
 * All codes are stable identifiers; the presentation layer translates them.
 */

/** One source file. `path` is POSIX, relative to the job root ("pkg/mod.py"). */
export type PyFile = { path: string; content: string };

export const FAULTS = ["torn-write"] as const;
export type Fault = (typeof FAULTS)[number];

export const PY_PACKAGES = ["numpy"] as const;
export type PyPackage = (typeof PY_PACKAGES)[number];

/** Stable codes for why a run failed outside the learner's logic. */
export const RUN_FAULTS = ["memory_limit"] as const;
export type RunFault = (typeof RUN_FAULTS)[number];

export type HarnessOptions = {
  /** `random.seed(seed)` before every test (and once before a script). */
  seed: number;
  /** Replace time.time / monotonic / perf_counter / sleep with `dojo.clock`. */
  fakeClock: boolean;
  /** Per-test budget of traced *user-code* line events. Default 2_000_000. */
  stepBudget: number;
  /** Wall-clock budget for the whole job. The harness also checks it softly. */
  wallMs: number;
  /**
   * Wall-clock slice per test id (all its parametrized cases). Default
   * max(1000, wallMs / 2), never more than `wallMs`. A runaway test times out
   * here instead of eating the whole job's budget.
   */
  testWallMs?: number;
  /**
   * Address-space headroom in MB over the harness's own footprint
   * (`setrlimit(RLIMIT_AS)`, relative on Linux and macOS alike). Default 1024;
   * 0 disables the cap. A MemoryError then fails the test with
   * `fault: "memory_limit"`. Falls back to `memoryHintMb` when absent.
   */
  memoryMb?: number;
  /** `async def test_*` are allowed; each runs on a fresh event loop. */
  asyncTests: boolean;
  faults?: Fault[];
  packages?: PyPackage[];
  /** Older name for `memoryMb`; still honoured. */
  memoryHintMb?: number;
};

export const DEFAULT_HARNESS_OPTIONS: HarnessOptions = {
  seed: 0,
  fakeClock: false,
  stepBudget: 2_000_000,
  wallMs: 8_000,
  asyncTests: false,
};

export type RunJob =
  | { kind: "tests"; files: PyFile[]; tests: PyFile; options: HarnessOptions }
  | {
      kind: "mutants";
      files: PyFile[];
      tests: PyFile;
      mutants: { id: string; files: PyFile[] }[];
      options: HarnessOptions;
    }
  /** Free "Run" button and predict generation: run `entry` as `__main__`. */
  | { kind: "script"; files: PyFile[]; entry: string; stdin?: string; options: HarnessOptions }
  /** Discover tests and their `@kc(...)` tags without running them. */
  | { kind: "collect"; files: PyFile[]; tests: PyFile; options: HarnessOptions };

export type RunJobKind = RunJob["kind"];

/** [file, line, function] — user files only, last five frames. */
export type Frame = [file: string, line: number, fn: string];

export type TestOutcome =
  /** `skipped`: pytest.skip() / a skip mark; counts as passed. */
  | { id: string; ok: true; ms: number; stdout?: string; skipped?: string }
  | {
      id: string;
      ok: false;
      ms: number;
      kind: "assert";
      msg: string;
      file: string;
      line: number;
      case?: string;
      stdout?: string;
    }
  | {
      id: string;
      ok: false;
      ms: number;
      kind: "error";
      exc: string;
      msg: string;
      frames: Frame[];
      traceback: string;
      /** Set when the error was a MemoryError under the run's memory cap. */
      fault?: RunFault;
      /** The parametrized case that failed (`test_x` runs all its cases under one id). */
      case?: string;
      stdout?: string;
    }
  | { id: string; ok: false; ms: number; kind: "timeout"; case?: string; stdout?: string };

/** Names the runner that produced a result. */
/** Which runner produced a result (a runner names itself, e.g. "pyodide", "remote-cpython"). */
export type RuntimeId = string;

export type ScriptException = { exc: string; msg: string; frames: Frame[]; traceback: string; fault?: RunFault };

/** `cases`: the case ids of a `@pytest.mark.parametrize` test, all run under `id`. */
export type CollectedTest = { id: string; kcs: string[]; line: number; async: boolean; cases?: string[] };

export type RunResult =
  | {
      status: "ok";
      passed: number;
      total: number;
      results: TestOutcome[];
      stdout: string;
      stderr: string;
      runtime: RuntimeId;
      ms: number;
    }
  | {
      status: "mutants";
      base: { passed: number; total: number };
      mutants: { id: string; killed: boolean; by?: string }[];
      runtime: RuntimeId;
      ms: number;
    }
  /** Mutant job whose tests are red on the reference files: the tests are wrong. */
  | { status: "tests_fail_on_reference"; base: Extract<RunResult, { status: "ok" }>; runtime: RuntimeId; ms: number }
  | {
      status: "script";
      stdout: string;
      stderr: string;
      exception: ScriptException | null;
      timedOut: boolean;
      runtime: RuntimeId;
      ms: number;
    }
  | { status: "collected"; tests: CollectedTest[]; runtime: RuntimeId; ms: number }
  | { status: "compile_error"; file: string; line: number; col?: number; msg: string; runtime: RuntimeId }
  | { status: "import_error"; exc: string; msg: string; frames: Frame[]; traceback: string; fault?: RunFault; runtime: RuntimeId }
  /** `job`: the hard wall-clock kill fired. `import`: budget exhausted while importing user modules. */
  | { status: "timeout"; scope: "job" | "import"; runtime: RuntimeId }
  | {
      status: "runtime_unavailable";
      /** no_runner: this build registered no runner for the item's runtime; the others come from a runner. */
      reason: "no_runner" | "host_unreachable" | "sandbox_failed" | "python_missing";
      runtime: RuntimeId;
      detail?: string;
    }
  /** Malformed job or a bug in the harness itself — never the learner's fault. */
  | { status: "harness_error"; msg: string; runtime: RuntimeId };

export type RunStatus = RunResult["status"];

/** Output caps applied by the harness (bytes of UTF-8, approximately characters). */
export const STDOUT_CAP = 16 * 1024;
export const TEST_STDOUT_CAP = 2 * 1024;

export function isRunResult(value: unknown): value is RunResult {
  return (
    typeof value === "object" &&
    value !== null &&
    typeof (value as { status?: unknown }).status === "string" &&
    typeof (value as { runtime?: unknown }).runtime === "string"
  );
}

/** True when every test ran and passed (status "ok" with passed === total > 0). */
export function allPassed(result: RunResult): boolean {
  return result.status === "ok" && result.total > 0 && result.passed === result.total;
}

/** Fill unspecified options with the defaults. */
export function withDefaultOptions(options?: Partial<HarnessOptions>): HarnessOptions {
  return { ...DEFAULT_HARNESS_OPTIONS, ...(options ?? {}) };
}
