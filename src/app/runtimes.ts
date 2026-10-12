/**
 * The app's view of code runners (`core/runner.ts`): whether this build can
 * run code, the status the UI shows, and the one entry point that runs a job.
 */
import * as React from "react";
import type { SandboxStatus } from "../features";
import type { RunJob, RunResult } from "../core/run-protocol";
import { getRunner, noRunnerResult, onRunnersChanged, runtimeAvailability, type RunnerEvent } from "../core/runner";
import type { RuntimeAvailability } from "../core/series";

/** Code items in this app run on Python; a runner for it is optional. */
export const CODE_RUNTIME = "sandbox:python" as const;

/** True once a runner for Python is registered. */
export function hasRunner(): boolean {
  return getRunner(CODE_RUNTIME) !== null;
}

/** What this build can grade right now. */
export function buildRuntimes(): RuntimeAvailability {
  return runtimeAvailability();
}

/** Runs a job on the registered runner, or reports that there is none. */
export function runCode(job: RunJob): Promise<RunResult> {
  const runner = getRunner(CODE_RUNTIME);
  return runner ? runner.run(job) : Promise.resolve(noRunnerResult());
}

export function resetRunner() {
  getRunner(CODE_RUNTIME)?.reset();
}

const FAILURE_REASONS = new Set(["host_unreachable", "sandbox_failed", "python_missing"]);

/** Runner events → the status the compositions render. */
export function runnerStatusOf(event: RunnerEvent | null, available: boolean): SandboxStatus {
  if (!available) return { state: "no-runner" };
  if (!event) return { state: "ready", runtimeLabel: getRunner(CODE_RUNTIME)?.label };
  switch (event.status) {
    case "idle":
    case "running":
      return { state: "ready", runtimeLabel: getRunner(CODE_RUNTIME)?.label };
    case "provisioning":
      return { state: "provisioning" };
    case "timed-out":
      return { state: "timed-out", scope: "job" };
    case "failed":
      return { state: "failed", reason: "harness_error", detail: event.detail };
    case "unavailable":
      return FAILURE_REASONS.has(event.detail ?? "")
        ? { state: "failed", reason: event.detail as "host_unreachable" | "sandbox_failed" | "python_missing" }
        : { state: "failed", reason: "sandbox_failed", detail: event.detail };
  }
}

/** Live runner status; "no runner" when none is registered. */
export function useRunnerStatus(): SandboxStatus {
  const [available, setAvailable] = React.useState(hasRunner);
  const [event, setEvent] = React.useState<RunnerEvent | null>(null);
  React.useEffect(() => onRunnersChanged(() => setAvailable(hasRunner())), []);
  React.useEffect(() => {
    if (!available) return undefined;
    return getRunner(CODE_RUNTIME)?.subscribe(setEvent);
  }, [available]);
  return runnerStatusOf(event, available);
}
