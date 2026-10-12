/**
 * Dojo learner model (docs/ARCHITECTURE.md §4).
 *
 * One half-life per knowledge component (KC): recall decays as
 * `p = 2^(−Δ/h)` and each graded exposure multiplies `h`. v1 runs on the
 * hand-tuned constants below; every update returns the prediction it acted on
 * (`pPred`, `deltaDays`, `hBefore`, `hAfter`) so the attempt log carries the
 * `(Δ, p̂, recalled)` triples a v2 HLR fit needs. The fitted model will keep
 * this signature.
 *
 * Pure: no I/O, no clock reads, randomness injected.
 */
import { RUNG_OF, type DojoItemType } from "./content-schema";
import type { SchedulerParams } from "./series";

/** Again | Hard | Good | Easy. */
export type Grade = 1 | 2 | 3 | 4;
export type Mastery = 0 | 1 | 2 | 3 | 4 | 5;

export type KcState = {
  kcId: string;
  halfLifeDays: number;
  lastSeenAt: string | null;
  nextDueAt: string | null;
  seen: number;
  correct: number;
  lapses: number;
  streak: number;
  mastery: Mastery;
  /** Highest item rung passed (grade ≥ Hard) on this KC; −1 = none yet. */
  bestRung: number;
  bestRungAt: string | null;
  remedialUntil: string | null;
};

// ---------------------------------------------------------------------------
// v1 parameters. Named so a v2 fit can replace them in one place.
// ---------------------------------------------------------------------------

/** Recall probability at which a KC becomes due. */
export const R_DUE = 0.7;
/** A crown shows a crack when any of its KCs falls below this. */
export const R_CRACK = 0.5;
export const HALF_LIFE_MIN_DAYS = 0.1;
export const HALF_LIFE_MAX_DAYS = 365;
/** Half-life after the first graded exposure, indexed by grade − 1. */
export const FIRST_HALF_LIFE_DAYS = [0.25, 1.0, 2.0, 3.0] as const;
/** Growth multiplier per grade (Again unused), indexed by grade − 1. */
export const GRADE_GROWTH = [0, 0.6, 1.5, 2.5] as const;
/** Added to `1 − p`: even a review at p = 1 still grows the half-life. */
export const SPACING_FLOOR = 0.2;
/** Again: `h' = h · (AGAIN_BASE + AGAIN_PER_Q · q_kc)`. */
export const AGAIN_BASE = 0.35;
export const AGAIN_PER_Q = 0.3;
/** Secondary KCs (weight 0.5) take only this share of a lapse penalty. */
export const SECONDARY_LAPSE_SHARE = 0.5;
/** Recognition-only practice cannot push a KC past these half-lives. */
export const CAP_BELOW_PRODUCTION_DAYS = 7;   // bestRung < 2
export const CAP_BELOW_EXTENSION_DAYS = 30;   // bestRung < 3
/** Ladder / case lapse: half-life ceiling and remediation window. */
export const REMEDIAL_HALF_LIFE_DAYS = 0.5;
export const REMEDIAL_WINDOW_DAYS = 3;
/** Ladder retry delay after remediation. */
export const LADDER_RETRY_DAYS = 2;

/** Item-type gain on the half-life update. */
export const G_TYPE: Record<DojoItemType, number> = {
  predict: 0.6,
  parsons: 0.6,
  "choose-design": 0.6,
  "fill-blank": 0.8,
  "spot-bug": 0.9,
  explain: 0.9,
  review: 1.0,
  implement: 1.2,
  "write-tests": 1.2,
  refactor: 1.3,
  ladder: 1.5,
  case: 1.5,
};

/** Mastery thresholds, indexed by level. */
export const MASTERY_RULES: readonly { minHalfLife: number; minRung: number }[] = [
  { minHalfLife: 0, minRung: -1 },
  { minHalfLife: 0, minRung: -1 },  // level 1 = at least one passing exposure
  { minHalfLife: 3, minRung: 1 },
  { minHalfLife: 10, minRung: 2 },
  { minHalfLife: 25, minRung: 4 },
  { minHalfLife: 60, minRung: 5 },
];
/** A timed checkpoint passed within this many days substitutes for rung 5. */
export const CHECKPOINT_MASTERY_WINDOW_DAYS = 90;

const DAY_MS = 86_400_000;

export function clamp(value: number, lo: number, hi: number) {
  return Math.min(hi, Math.max(lo, value));
}

export function addDays(at: Date, days: number) {
  return new Date(at.getTime() + days * DAY_MS);
}

export function emptyKcState(kcId: string): KcState {
  return {
    kcId,
    halfLifeDays: FIRST_HALF_LIFE_DAYS[0],
    lastSeenAt: null,
    nextDueAt: null,
    seen: 0,
    correct: 0,
    lapses: 0,
    streak: 0,
    mastery: 0,
    bestRung: -1,
    bestRungAt: null,
    remedialUntil: null,
  };
}

/** Days since the KC was last practised; 0 when never seen or clock skew. */
export function elapsedDays(st: KcState, now: Date) {
  if (!st.lastSeenAt) return 0;
  const last = Date.parse(st.lastSeenAt);
  if (!Number.isFinite(last)) return 0;
  return Math.max(0, (now.getTime() - last) / DAY_MS);
}

/** `p = 2^(−Δ/h)`. An unseen KC has nothing to recall: p = 0. */
export function recallProbability(st: KcState, now: Date) {
  if (st.seen === 0 || !st.lastSeenAt) return 0;
  const h = Math.max(HALF_LIFE_MIN_DAYS, st.halfLifeDays);
  return Math.pow(2, -elapsedDays(st, now) / h);
}

/** Interval after which `p` reaches R_DUE: `h · log2(1/R_DUE)` ≈ 0.515·h. */
export function dueIntervalDays(halfLifeDays: number) {
  return halfLifeDays * Math.log2(1 / R_DUE);
}

export function isDue(st: KcState, now: Date) {
  return st.seen > 0 && recallProbability(st, now) < R_DUE;
}

export function isRemedial(st: KcState, now: Date) {
  return Boolean(st.remedialUntil) && Date.parse(st.remedialUntil as string) > now.getTime();
}

export type MasteryContext = {
  /** ISO time of the last passed timed checkpoint covering this KC. */
  checkpointPassedAt?: string | null;
  now?: Date;
};

/** Mastery level 0–5: the highest level whose conditions all hold. */
export function masteryOf(st: KcState, ctx: MasteryContext = {}): Mastery {
  if (st.seen === 0 || st.correct === 0) return 0;
  let level: Mastery = 1;
  for (let next = 2; next <= 5; next += 1) {
    const rule = MASTERY_RULES[next];
    if (st.halfLifeDays < rule.minHalfLife) break;
    let rungOk = st.bestRung >= rule.minRung;
    if (next === 5 && !rungOk && ctx.checkpointPassedAt && ctx.now) {
      const at = Date.parse(ctx.checkpointPassedAt);
      rungOk = Number.isFinite(at) &&
        ctx.now.getTime() - at <= CHECKPOINT_MASTERY_WINDOW_DAYS * DAY_MS;
    }
    if (!rungOk) break;
    level = next as Mastery;
  }
  return level;
}

export type KcUpdateContext = {
  /** KC-level score in [0, 1]; drives the size of a lapse. */
  qKc: number;
  itemType: DojoItemType;
  /** 1 = the item's primary KC, 0.5 = a secondary KC. */
  weight: 1 | 0.5;
  now: Date;
  /** Injected for deterministic tests; defaults to Math.random. */
  rand?: () => number;
  /** The item's series scheduler (rungs, gains, caps); the default when omitted. */
  params?: SchedulerParams;
};

/** What the scheduler saw and did; stored verbatim in `kc_outcomes`. */
export type KcOutcomeLog = {
  kc: string;
  w: 1 | 0.5;
  qKc: number;
  grade: Grade;
  pPred: number;
  deltaDays: number;
  hBefore: number;
  hAfter: number;
  masteryBefore: Mastery;
  masteryAfter: Mastery;
};

export type KcUpdate = { state: KcState; log: KcOutcomeLog };

/** One graded exposure → the KC's next state plus its log row. */
export function updateKc(st: KcState, grade: Grade, ctx: KcUpdateContext): KcUpdate {
  const { now, weight, itemType } = ctx;
  const rand = ctx.rand ?? Math.random;
  const qKc = clamp(Number.isFinite(ctx.qKc) ? ctx.qKc : 0, 0, 1);
  const first = st.seen === 0;
  const p = first ? 0 : recallProbability(st, now);
  const hBefore = st.halfLifeDays;

  let h: number;
  if (first) {
    h = FIRST_HALF_LIFE_DAYS[grade - 1];
  } else if (grade === 1) {
    const factor = AGAIN_BASE + AGAIN_PER_Q * qKc;
    const effective = weight === 1 ? factor : 1 - SECONDARY_LAPSE_SHARE * (1 - factor);
    h = Math.max(HALF_LIFE_MIN_DAYS, hBefore * effective);
  } else {
    const gain = (ctx.params?.gainOf ?? G_TYPE)[itemType] * weight;
    const surprise = (1 - p) + SPACING_FLOOR;
    h = hBefore * (1 + GRADE_GROWTH[grade - 1] * gain * surprise);
  }

  const rung = (ctx.params?.rungOf ?? RUNG_OF)[itemType];
  const passed = grade >= 2;
  const bestRung = passed ? Math.max(st.bestRung, rung) : st.bestRung;
  if (bestRung < 2) h = Math.min(h, ctx.params?.capBelowProductionDays ?? CAP_BELOW_PRODUCTION_DAYS);
  else if (bestRung < 3) h = Math.min(h, ctx.params?.capBelowExtensionDays ?? CAP_BELOW_EXTENSION_DAYS);
  h = clamp(h, HALF_LIFE_MIN_DAYS, HALF_LIFE_MAX_DAYS);

  const dueDays = jitterIntervalDays(dueIntervalDays(h), rand);
  const nowIso = now.toISOString();
  const next: KcState = {
    ...st,
    halfLifeDays: h,
    lastSeenAt: nowIso,
    nextDueAt: addDays(now, dueDays).toISOString(),
    seen: st.seen + 1,
    correct: st.correct + (passed ? 1 : 0),
    lapses: st.lapses + (grade === 1 && !first ? 1 : 0),
    streak: passed ? st.streak + 1 : 0,
    bestRung,
    bestRungAt: passed && rung > st.bestRung ? nowIso : st.bestRungAt,
  };
  const masteryAfter = masteryOf(next);
  const state = { ...next, mastery: masteryAfter };
  return {
    state,
    log: {
      kc: st.kcId,
      w: weight,
      qKc,
      grade,
      pPred: round4(p),
      deltaDays: round4(first ? 0 : elapsedDays(st, now)),
      hBefore: round4(hBefore),
      hAfter: round4(h),
      masteryBefore: st.mastery,
      masteryAfter,
    },
  };
}

/**
 * A lapse inside a ladder level or a staged case: cap the half-life, open a
 * remediation window and pull the due date in accordingly.
 */
export function applyRemediation(st: KcState, now: Date): KcState {
  const h = Math.min(st.halfLifeDays, REMEDIAL_HALF_LIFE_DAYS);
  return {
    ...st,
    halfLifeDays: h,
    nextDueAt: addDays(now, dueIntervalDays(h)).toISOString(),
    remedialUntil: addDays(now, REMEDIAL_WINDOW_DAYS).toISOString(),
    mastery: masteryOf({ ...st, halfLifeDays: h }),
  };
}

function round4(value: number) {
  return Math.round(value * 10_000) / 10_000;
}

/** ±15% jitter on intervals longer than three days, so reviews don't bunch on one day. */
function jitterIntervalDays(baseDays: number, random: () => number = Math.random) {
  if (!Number.isFinite(baseDays) || baseDays <= 3) return baseDays;
  return baseDays + Math.round(baseDays * (random() * 0.3 - 0.15));
}
