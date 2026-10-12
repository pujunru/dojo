/**
 * Dojo gamification (docs/ARCHITECTURE.md): XP, daily goal, streak with
 * freezes, unit crowns and cracks. Pure; the store calls these on writes.
 *
 * Days are the learner's local calendar days (`YYYY-MM-DD`), computed on the
 * device with `deviceLocalDay`; `localDayAtOffset` is the same computation for an explicit
 * offset (tests, or a future settings timezone). Streaks are settled lazily on write by
 * comparing with `lastActiveDay` — there is no cron.
 */
import type { DojoItemType } from "./content-schema";
import { masteryOf, recallProbability, R_CRACK, type KcState, type Mastery } from "./learner-model";

// --- XP --------------------------------------------------------------------

export const XP_BASE: Record<DojoItemType, number> = {
  predict: 2,
  parsons: 3,
  "choose-design": 3,
  "fill-blank": 3,
  "spot-bug": 3,
  explain: 5,
  review: 6,
  implement: 8,
  refactor: 10,
  "write-tests": 10,
  ladder: 10, // per level
  case: 20,
};
export const SESSION_COMPLETE_XP = 5;
export const SESSION_PERFECT_XP = 5;

/** `ceil(base × q)`; a revealed solution earns nothing. */
export function itemXp(type: DojoItemType, q: number, solutionRevealed = false) {
  if (solutionRevealed || !Number.isFinite(q) || q <= 0) return 0;
  return Math.ceil(XP_BASE[type] * Math.min(1, q));
}

/** Bonus on finishing a non-abandoned session with at least one item. */
export function sessionBonusXp(itemsDone: number, accuracy: number | null) {
  if (itemsDone <= 0) return 0;
  return SESSION_COMPLETE_XP + (accuracy !== null && accuracy >= 1 ? SESSION_PERFECT_XP : 0);
}

// --- Daily goal -------------------------------------------------------------

export const DAILY_GOAL_OPTIONS = [10, 20, 30, 50] as const;
export const DEFAULT_DAILY_GOAL_XP = 30;
export const SESSION_MINUTES_MIN = 3;
export const SESSION_MINUTES_MAX = 60;

export function isDailyGoalOption(v: unknown): v is (typeof DAILY_GOAL_OPTIONS)[number] {
  return typeof v === "number" && (DAILY_GOAL_OPTIONS as readonly number[]).includes(v);
}

export function isSessionMinutes(v: unknown): v is number {
  return typeof v === "number" && Number.isInteger(v) && v >= SESSION_MINUTES_MIN && v <= SESSION_MINUTES_MAX;
}

// --- Local days -------------------------------------------------------------

const DAY_RE = /^(\d{4})-(\d{2})-(\d{2})$/;
const DAY_MS = 86_400_000;

/** Days since the epoch for a valid `YYYY-MM-DD`, else null. */
export function dayNumber(day: string): number | null {
  const m = DAY_RE.exec(day);
  if (!m) return null;
  const t = Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3]));
  const d = new Date(t);
  if (d.getUTCFullYear() !== Number(m[1]) || d.getUTCMonth() !== Number(m[2]) - 1 || d.getUTCDate() !== Number(m[3])) return null;
  return Math.round(t / DAY_MS);
}

export function dayFromNumber(n: number) {
  return new Date(n * DAY_MS).toISOString().slice(0, 10);
}

/** `b − a` in whole days; null when either is malformed. */
export function dayDiff(a: string, b: string) {
  const x = dayNumber(a);
  const y = dayNumber(b);
  return x === null || y === null ? null : y - x;
}

export function addLocalDays(day: string, delta: number) {
  const n = dayNumber(day);
  return n === null ? null : dayFromNumber(n + delta);
}

/**
 * The calendar day of `at` at a UTC offset (minutes east of UTC, e.g. +480
 * for Asia/Shanghai). A machine key, so no Intl formatting is involved.
 */
export function localDayAtOffset(at: Date, offsetMinutes: number) {
  return new Date(at.getTime() + offsetMinutes * 60_000).toISOString().slice(0, 10);
}

/**
 * The learner's day as their device sees it. `getTimezoneOffset` is
 * evaluated for this instant, so DST transitions are handled.
 */
export function deviceLocalDay(at: Date = new Date()) {
  return localDayAtOffset(at, -at.getTimezoneOffset());
}

/**
 * A client day is accepted when well-formed and within one day of the
 * server's UTC day (zones span UTC−12…UTC+14).
 */
export function isAcceptableLocalDay(day: unknown, now: Date): day is string {
  if (typeof day !== "string") return false;
  const n = dayNumber(day);
  if (n === null) return false;
  const utc = Math.floor(now.getTime() / DAY_MS);
  return Math.abs(n - utc) <= 1;
}

// --- Streak + freezes -------------------------------------------------------

export const FREEZE_EVERY_DAYS = 7;
export const MAX_FREEZES = 2;

export type StreakState = {
  streakCurrent: number;
  streakBest: number;
  lastActiveDay: string | null;
  freezes: number;
};

export type StreakChange = "extended" | "kept-by-freeze" | "reset" | "unchanged";

export type StreakView = StreakState & {
  /** Today still needs a session to keep the streak. */
  atRisk: boolean;
  /** Freezes that would be spent if a session were finished today. */
  freezesPending: number;
};

/**
 * Read-only settlement for display: what the streak is as of
 * `today`, without spending freezes. A gap the freezes cannot cover shows 0.
 */
export function settleStreak(st: StreakState, today: string): StreakView {
  if (!st.lastActiveDay) return { ...st, streakCurrent: 0, atRisk: false, freezesPending: 0 };
  const gap = dayDiff(st.lastActiveDay, today);
  if (gap === null || gap <= 0) return { ...st, atRisk: false, freezesPending: 0 };
  if (gap === 1) return { ...st, atRisk: st.streakCurrent > 0, freezesPending: 0 };
  const missed = gap - 1;
  if (st.freezes >= missed) return { ...st, atRisk: st.streakCurrent > 0, freezesPending: missed };
  return { ...st, streakCurrent: 0, atRisk: false, freezesPending: 0 };
}

export type ActivityResult = {
  state: StreakState;
  change: StreakChange;
  freezeEarned: boolean;
  /** Missed days bridged by freezes (stored as `dojo_days.freeze_used = 1`). */
  frozenDays: string[];
};

/**
 * A session was finished on `day`: extend, bridge with freezes, or reset.
 * One freeze is earned at every multiple of 7 streak days, holding at most 2.
 * A day earlier than the last active day (zone change, clock skew) changes
 * nothing.
 */
export function recordActivity(st: StreakState, day: string): ActivityResult {
  const unchanged: ActivityResult = { state: st, change: "unchanged", freezeEarned: false, frozenDays: [] };
  if (dayNumber(day) === null) return unchanged;
  let current: number;
  let freezes = st.freezes;
  let change: StreakChange;
  const frozenDays: string[] = [];
  if (!st.lastActiveDay) {
    current = 1;
    change = "extended";
  } else {
    const gap = dayDiff(st.lastActiveDay, day);
    if (gap === null || gap <= 0) return unchanged;
    if (gap === 1) {
      current = st.streakCurrent + 1;
      change = "extended";
    } else {
      const missed = gap - 1;
      if (st.streakCurrent > 0 && freezes >= missed) {
        freezes -= missed;
        for (let i = 1; i <= missed; i += 1) frozenDays.push(addLocalDays(st.lastActiveDay, i) as string);
        current = st.streakCurrent + 1;
        change = "kept-by-freeze";
      } else {
        current = 1;
        change = "reset";
      }
    }
  }
  let freezeEarned = false;
  if (current % FREEZE_EVERY_DAYS === 0 && freezes < MAX_FREEZES) {
    freezes += 1;
    freezeEarned = true;
  }
  return {
    state: {
      streakCurrent: current,
      streakBest: Math.max(st.streakBest, current),
      lastActiveDay: day,
      freezes,
    },
    change,
    freezeEarned,
    frozenDays,
  };
}

// --- Crowns + cracks -------------------------------------------------

export type CrownOptions = {
  /** Crowns above `checkpointGate` require a passed unit checkpoint (ladder). */
  requireCheckpoint: boolean;
  /** Highest crown reachable without the checkpoint. */
  checkpointGate: number;
  /** Highest crown attainable. */
  maxCrown: number;
};
/** The MVP shipped without checkpoints: no gate, crowns capped at 3. */
export const MVP_CROWN_OPTIONS: CrownOptions = { requireCheckpoint: false, checkpointGate: 3, maxCrown: 3 };
/** WP9: the unit checkpoint (a ladder with `checkpointFor`) gates crowns 4–5. */
export const FULL_CROWN_OPTIONS: CrownOptions = { requireCheckpoint: true, checkpointGate: 3, maxCrown: 5 };

/**
 * Unit crown = minimum mastery over the unit's KCs (an untouched KC counts
 * as 0), gated by the checkpoint and capped. Crowns never decay: callers
 * keep `max(previous, computed)`.
 */
export function unitCrown(
  kcIds: readonly string[],
  states: ReadonlyMap<string, KcState>,
  checkpointPassedAt: string | null,
  opts: CrownOptions = FULL_CROWN_OPTIONS,
  now?: Date,
): Mastery {
  if (!kcIds.length) return 0;
  let crown = 5;
  for (const id of kcIds) {
    const st = states.get(id);
    crown = Math.min(crown, st ? masteryOf(st, { checkpointPassedAt, now }) : 0);
  }
  if (opts.requireCheckpoint && !checkpointPassedAt) crown = Math.min(crown, opts.checkpointGate);
  return Math.min(crown, opts.maxCrown) as Mastery;
}

/**
 * A ladder attempt passes its unit checkpoint when every level passed, no
 * solution was revealed and the whole ladder finished within the timed
 * budget plus this grace (overtime is allowed per level, but a checkpoint
 * is a timed exam).
 */
/**
 * The unit a row is the checkpoint of. A ladder without `checkpointFor`
 * stands for its own unit (the Python series' checkpoints are its ladders);
 * a staged case is a checkpoint only when it says so.
 */
export function checkpointUnitOf(row: { type: string; unit: string; checkpointFor?: string }): string | null {
  if (row.type === "ladder") return row.checkpointFor ?? row.unit;
  if (row.type === "case") return row.checkpointFor ?? null;
  return null;
}

export const CHECKPOINT_OVERTIME_GRACE = 1.25;
export function passesCheckpoint(signal: { passed: boolean; solutionRevealed: boolean; latencyMs: number }, estSeconds: number) {
  return signal.passed && !signal.solutionRevealed && signal.latencyMs <= estSeconds * 1000 * CHECKPOINT_OVERTIME_GRACE;
}

/** A crown is cracked when any started KC of the unit is below R_CRACK. */
export function isUnitCracked(kcIds: readonly string[], states: ReadonlyMap<string, KcState>, now: Date) {
  return kcIds.some((id) => {
    const st = states.get(id);
    return Boolean(st && st.seen > 0 && recallProbability(st, now) < R_CRACK);
  });
}

// --- Self comparison (replaces leagues) -------------------------------------

/** This week's XP against the median of the previous four weeks. */
export function weeklySelfComparison(days: readonly { localDay: string; xp: number }[], today: string) {
  const t = dayNumber(today);
  if (t === null) return { thisWeek: 0, medianPrior: 0 };
  const weeks = [0, 0, 0, 0, 0];
  for (const d of days) {
    const n = dayNumber(d.localDay);
    if (n === null || n > t) continue;
    const w = Math.floor((t - n) / 7);
    if (w < 5) weeks[w] += d.xp;
  }
  const prior = weeks.slice(1).sort((a, b) => a - b);
  return { thisWeek: weeks[0], medianPrior: (prior[1] + prior[2]) / 2 };
}
