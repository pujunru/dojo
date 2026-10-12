/**
 * View-model contracts for the Dojo compositions.
 *
 * Every composition here is presentational and controlled: it receives
 * locale-neutral data plus already-resolved strings for user/curriculum
 * content, owns only its own UI copy (the `dojo` namespace), and
 * reports intent through callbacks. Nothing in this folder fetches, runs code
 * or writes state — the app layer (WP6) wires the sandbox runtime and the API.
 */
import type { DojoItemType, PyFile } from "../core/content-schema";
import type { RunResult } from "../core/run-protocol";
import type { MasteryLevel } from "../ui/mastery-crown";

export type { DojoItemType, PyFile, RunResult, MasteryLevel };

/** Whether this build has a code runner (`core/runner.ts`). */
export type DojoPlatform = "runner" | "no-runner";

/** Outcome of one checked item, as the grader reports it. */
export type ItemVerdict = "correct" | "partial" | "incorrect";

/**
 * Lifecycle of the item on screen:
 * `unanswered` → `answered` (Check enabled) → `checking` (grading / running)
 * → `revealed` (feedback sheet + Continue).
 */
export type ItemPhase = "unanswered" | "answered" | "checking" | "revealed";

/** The grader's verdict for the item, passed back into the item view to lock and annotate it. */
export type ItemReveal = {
  verdict: ItemVerdict;
  /** Raw score q ∈ [0, 1]. */
  q: number;
};

/** Sandbox lifecycle as the UI shows it. */
export type SandboxStatus =
  | { state: "no-runner" }
  | { state: "provisioning"; /** 0..1 when known. */ progress?: number }
  | { state: "ready"; /** e.g. "CPython 3.12 · tmpdir" — data, not copy. */ runtimeLabel?: string }
  | { state: "running"; elapsedMs?: number }
  | { state: "timed-out"; scope?: "job" | "import" }
  | {
      state: "failed";
      reason: "host_unreachable" | "sandbox_failed" | "python_missing" | "harness_error";
      /** Technical detail from the runtime, shown verbatim (data). */
      detail?: string;
    };

/** Run state of a code item, owned by the app layer. */
export type CodeRunState =
  | { state: "idle" }
  | { state: "running" }
  | { state: "done"; result: RunResult };

/** Shared props of every item view. */
export type DojoItemViewBaseProps<TItem, TAnswer> = {
  item: TItem;
  answer: TAnswer;
  onAnswerChange: (answer: TAnswer) => void;
  /** Present once checked: the view locks and shows what was right and wrong. */
  reveal?: ItemReveal | null;
  /** Lock input without revealing (e.g. while checking). */
  disabled?: boolean;
  /** Whether code can run; sandbox items need `runner`. */
  platform: DojoPlatform;
};

