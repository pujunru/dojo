---
name: dojo-code-runner
description: Implement, register or debug a code runner that lets Dojo grade code items (implement, refactor, write-tests, ladder, tested parsons/fill-blank/spot-bug) by executing runner/python/dojo_harness.py — for example Pyodide in a Web Worker or a remote sandbox service. Use when enabling code execution, changing the run protocol, or investigating why code items are skipped.
---

# Dojo code runner

Dojo ships the interface and the harness, not an executor. Read
`src/core/runner.ts` (the `CodeRunner` interface and registry),
`src/core/run-protocol.ts` (the `RunJob` / `RunResult` wire format) and the
header of `runner/python/dojo_harness.py` before writing a runner.

## Contract

- `runtime: "sandbox:python"`; `label` is shown to the learner (data).
- `run(job)` executes the harness with the job as JSON on stdin and resolves
  with the `RunResult` it prints. It **never rejects**: infrastructure
  failures resolve to `{ status: "runtime_unavailable", reason, runtime }` or
  `{ status: "harness_error", … }`, so the UI can say what happened and the
  learner is never graded on a broken runner.
- Enforce the job's budgets: `options.wallMs` per run (× mutants for a
  `mutants` job). The harness enforces per-test step budgets and timeouts
  itself; the runner adds the outer wall-clock kill.
- `subscribe` emits `{ status, queued, detail? }`: `provisioning` while the
  runtime loads (e.g. Pyodide's first download), `running`, `idle`,
  `timed-out`, `failed`, `unavailable`. Emit the current status on subscribe.
- `reset()` drops a wedged state (the learner's "try again").
- Run one job at a time per runner, in order.

## Register it

In `src/main.tsx`, before `createRoot(...)`:

```ts
import { registerRunner } from "./core/runner";
import { createPyodideRunner } from "./runners/pyodide"; // your implementation
registerRunner(createPyodideRunner());
```

Registration flips `runtimeAvailability()["sandbox:python"]` to true: the
composer starts scheduling code items, the path unlocks code lessons and the
player shows the runner status. Lazy-load heavy runtimes inside `run` so the
first page stays light on phones.

## Notes per runner type

- **Pyodide (in browser)**: run in a Web Worker; write the harness and job
  files to the in-memory FS; Pyodide lacks real threads and subprocesses, so
  items whose KCs need them (threads, multiprocessing) will not behave as on
  CPython. Gate such series on a remote runner instead.
- **Remote sandbox**: never send anything but the job; isolate each run
  (no network, CPU/memory limits); the job is deterministic, so results can be
  cached by a hash of the job.

## Verify

1. `npm test` (the protocol types are shared with the validator).
2. Run the `_sample` fixture series in `npm run dev:demo`: implement-ttl-cache must
   fail on the starter, pass on the reference solution, and show per-test
   results; a deliberately infinite loop must end as a timeout, not a hang.
3. Check the runner status story in Storybook (Dojo / Runtime and Tests).
