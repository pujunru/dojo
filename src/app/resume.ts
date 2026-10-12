import type { DojoSession } from "../core/contract";

export type ResumeTarget = { kind: string; lessonId?: string; unitId?: string };

/**
 * The unfinished session a start should continue instead of composing anew:
 * same kind and target (the lesson, the unit, or today for daily/review), with
 * items left. Composing a fresh one would abandon it in the store and throw
 * its remaining plan away.
 */
export function resumableSession(open: DojoSession | null | undefined, options: ResumeTarget, today: string): DojoSession | null {
  if (!open || open.finishedAt || open.planned.length <= open.itemsDone) return null;
  switch (options.kind) {
    case "daily":
    case "review":
      return open.kind === options.kind && open.localDay === today ? open : null;
    case "lesson":
      return open.kind === "lesson" && Boolean(options.lessonId) && open.lessonId === options.lessonId ? open : null;
    case "practice":
      return open.kind === "practice" && Boolean(options.unitId) && open.unitId === options.unitId ? open : null;
    default:
      return null;
  }
}

/** The open session of `series` in the learner's state (one open session per series). */
export function openSessionFor(state: { openSessions: readonly DojoSession[] } | null | undefined, series: string): DojoSession | null {
  return state?.openSessions.find((s) => s.series === series) ?? null;
}
