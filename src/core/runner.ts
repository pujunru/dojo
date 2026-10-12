/**
 * Code runners: the pluggable part that executes learner code.
 *
 * Items whose `runtime` is a sandbox runtime (`sandbox:python`) are graded by
 * running hidden tests. This app ships no runner; a build registers one per
 * runtime it can execute, e.g. Pyodide in a Web Worker, a remote sandbox
 * service, or a desktop shell, each running `runner/python/dojo_harness.py`.
 *
 * With no runner registered, `runtimeAvailability()` reports the runtime as
 * missing, so the composer leaves those items out and the path marks them as
 * unavailable. Nothing else in the app needs to know whether code can run.
 */
import type { RunJob, RunResult } from "./run-protocol";
import type { RuntimeAvailability, RuntimeId } from "./series";

export type RunnerStatus = "idle" | "provisioning" | "running" | "timed-out" | "failed" | "unavailable";

export type RunnerEvent = { status: RunnerStatus; queued: number; detail?: string };

export interface CodeRunner {
  /** The series runtime it serves, e.g. "sandbox:python". */
  readonly runtime: RuntimeId;
  /** Shown in the UI, e.g. "CPython 3.12 (Pyodide)". Data, not copy. */
  readonly label: string;
  /** Runs one job. Must resolve (never reject) with a RunResult. */
  run(job: RunJob): Promise<RunResult>;
  subscribe(listener: (event: RunnerEvent) => void): () => void;
  /** Drops a wedged state, e.g. after the learner presses "try again". */
  reset(): void;
}

const runners = new Map<RuntimeId, CodeRunner>();
const changeListeners = new Set<() => void>();

/** Registers (or replaces) the runner for its runtime. Call before the app renders. */
export function registerRunner(runner: CodeRunner) {
  runners.set(runner.runtime, runner);
  for (const listener of changeListeners) listener();
}

export function getRunner(runtime: RuntimeId): CodeRunner | null {
  return runners.get(runtime) ?? null;
}

export function onRunnersChanged(listener: () => void): () => void {
  changeListeners.add(listener);
  return () => changeListeners.delete(listener);
}

/** What this build can grade: static items always, a sandbox runtime only with a runner. */
export function runtimeAvailability(): RuntimeAvailability {
  const avail: RuntimeAvailability = { none: true };
  for (const runtime of runners.keys()) avail[runtime] = true;
  return avail;
}

/** The answer for a job when no runner is registered. */
export function noRunnerResult(): RunResult {
  return { status: "runtime_unavailable", reason: "no_runner", runtime: "none" };
}
