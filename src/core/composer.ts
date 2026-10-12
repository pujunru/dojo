/**
 * Dojo session composer (docs/ARCHITECTURE.md §4). Runs in the browser
 * over the learner's state snapshot.
 *
 * Deterministic for a given input and seed. O(KCs + items).
 *
 *  1. Review candidates — KCs already started whose recall `p` fell below
 *     R_DUE (or that are in a remediation window), lowest `p` first.
 *  2. New material — the ZPD frontier: unseen KCs whose prereq KCs are at
 *     mastery ≥ 1, in units whose prereq units are complete; new items are
 *     capped at a share of the time budget (20 % for `daily`).
 *  3. Item choice per KC — rung by mastery (70 % exact / 20 % one lower /
 *     10 % one higher), skin rotation, no repeat within a week, variant
 *     groups mutually exclusive, runtime-unavailable items substituted by
 *     same-KC items the current build can run.
 *  4. Ordering for flow — warm-up, hard items, new items, an easy finish,
 *     neighbours from different archetypes / skins.
 */
import { primaryKc, RUNG_OF, type DojoItemIndexRow } from "./content-schema";
import { DEFAULT_SCHEDULER, runtimeAvailable, type RuntimeAvailability as SeriesRuntimeAvailability, type SchedulerParams } from "./series";
import { isRemedial, recallProbability, R_DUE, type KcState } from "./learner-model";

export type SessionKind = "lesson" | "daily" | "practice" | "review" | "remedial";
export type PlanReason = "new" | "review" | "remedial" | "requeue";

export type ItemState = {
  itemId: string;
  lastSeenAt: string;
  seen: number;
  lastQ: number | null;
  bestLevel: number | null;
  nextRetryAt: string | null;
};

/** The subset of `skill-graph.json` the composer reads. */
export type ComposerGraph = {
  tiers?: readonly { id: string; order: number }[];
  units: readonly {
    id: string;
    tier?: string;
    order?: number;
    prereqUnits?: readonly string[];
    kcs?: readonly string[];
    lessons: readonly { id: string; kcs: readonly string[] }[];
  }[];
  kcs: readonly { id: string; prereqs: readonly string[]; payoff?: unknown }[];
};

/** Which runtimes this build serves (see `series.ts`). */
export type RuntimeAvailability = SeriesRuntimeAvailability;

export type ComposeInput = {
  kind: SessionKind;
  graph: ComposerGraph;
  items: readonly DojoItemIndexRow[];
  kc: ReadonlyMap<string, KcState>;
  itemState: ReadonlyMap<string, ItemState>;
  runtimeAvailability: RuntimeAvailability;
  /** The series' scheduler parameters; the default scheduler when omitted. */
  scheduler?: SchedulerParams;
  now: Date;
  seed: number;
  /** Session length; default 10 minutes. */
  minutes?: number;
  lessonId?: string;
  unitId?: string;
  /** remedial: the KCs to repair; default = every KC in a remediation window. */
  kcIds?: readonly string[];
  /** Accuracy of the previous session; below 0.7 no new KC is introduced. */
  lastSessionAccuracy?: number | null;
  /** In-session adaptation: shift every target rung by ±1. */
  rungShift?: -1 | 0 | 1;
};

export type PlannedItem = {
  itemId: string;
  kcId: string;
  reason: PlanReason;
  /** Rung the composer aimed at for this KC. */
  targetRung: number;
  /** Predicted success (recall p; 0.5 for new material). */
  pPred: number;
  /** True when no item at the target rung could run here and another was used. */
  substituted: boolean;
  estSeconds: number;
};

// --- tunables --------------------------------------------------------------

export const DEFAULT_SESSION_MINUTES = 10;
/** Share of the time budget new material may take, per kind. */
export const NEW_SHARE: Record<SessionKind, number> = {
  lesson: 0.3,
  daily: 0.2,
  practice: 0,
  review: 0,
  remedial: 0,
};
/** Previous-session accuracy below which no new KC is opened (ZPD). */
export const NEW_CONTENT_MIN_ACCURACY = 0.7;
/** New KCs per daily session. */
export const DAILY_NEW_KCS = 2;
/** First-exposure items per new KC in a lesson (teach, then practise). */
export const LESSON_ITEMS_PER_NEW_KC = 3;
export const REMEDIAL_MAX_ITEMS = 5;
export const MAX_REQUEUES = 2;
/** Highest rung the composer schedules; ladders and cases have their own flows. */
export const MAX_COMPOSED_RUNG = 3;
export const REMEDIAL_PRIORITY_BONUS = 0.3;
export const PAYOFF_PRIORITY_WEIGHT = 0.1;

const DAY_MS = 86_400_000;

// --- helpers ----------------------------------------------------------------

/** Small, fast, seedable PRNG. */
export function mulberry32(seed: number) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4_294_967_296;
  };
}

export function isRunnable(item: Pick<DojoItemIndexRow, "runtime">, avail: RuntimeAvailability) {
  return runtimeAvailable(item.runtime, avail);
}

function masteryOfKc(inp: ComposeInput, kcId: string) {
  return inp.kc.get(kcId)?.mastery ?? 0;
}

function seenWithinDays(st: ItemState | undefined, now: Date, days: number) {
  if (!st) return false;
  const at = Date.parse(st.lastSeenAt);
  return Number.isFinite(at) && now.getTime() - at < days * DAY_MS;
}

type Ctx = {
  inp: ComposeInput;
  rnd: () => number;
  rungOf: SchedulerParams["rungOf"];
  maxRung: number;
  usable: DojoItemIndexRow[];
  byKc: Map<string, DojoItemIndexRow[]>;
  /** Same-KC items regardless of runtime, to know when we substituted. */
  allByKc: Map<string, DojoItemIndexRow[]>;
  itemById: Map<string, DojoItemIndexRow>;
  payoff: Map<string, number>;
  /** Runnable items that exercise a KC only as a secondary KC (remedial fallback). */
  bySecondary: Map<string, DojoItemIndexRow[]>;
};

function buildCtx(inp: ComposeInput): Ctx {
  const rnd = mulberry32(inp.seed);
  const params = inp.scheduler ?? DEFAULT_SCHEDULER;
  // Ladders, checkpoints and simulations have their own flows.
  const composable = inp.items.filter((it) => it.type !== "ladder" && !it.checkpointFor && !it.simulationMinutes && params.rungOf[it.type] <= params.maxComposedRung);
  const usable = composable.filter((it) => isRunnable(it, inp.runtimeAvailability));
  const group = (rows: DojoItemIndexRow[]) => {
    const m = new Map<string, DojoItemIndexRow[]>();
    for (const it of rows) {
      const kc = primaryKc(it);
      m.set(kc, [...(m.get(kc) ?? []), it]);
    }
    return m;
  };
  const payoffOf = (v: unknown) => (Array.isArray(v) ? v.length : typeof v === "number" && Number.isFinite(v) ? v : 0);
  const maxPayoff = Math.max(1, ...inp.graph.kcs.map((k) => payoffOf(k.payoff)));
  const bySecondary = new Map<string, DojoItemIndexRow[]>();
  for (const it of usable) {
    for (const ref of it.kcs) if (ref.weight !== 1) bySecondary.set(ref.id, [...(bySecondary.get(ref.id) ?? []), it]);
  }
  return {
    inp,
    rnd,
    rungOf: params.rungOf,
    maxRung: params.maxComposedRung,
    usable,
    bySecondary,
    byKc: group(usable),
    allByKc: group(composable),
    itemById: new Map(inp.items.map((it) => [it.id, it])),
    payoff: new Map(inp.graph.kcs.map((k) => [k.id, payoffOf(k.payoff) / maxPayoff])),
  };
}

/** Units in path order: tier order, then unit order, then file order. */
export function orderedUnits(graph: ComposerGraph) {
  const tierOrder = new Map((graph.tiers ?? []).map((t) => [t.id, t.order]));
  return graph.units
    .map((u, i) => ({ u, i }))
    .sort((a, b) =>
      (tierOrder.get(a.u.tier ?? "") ?? 0) - (tierOrder.get(b.u.tier ?? "") ?? 0) ||
      (a.u.order ?? 0) - (b.u.order ?? 0) ||
      a.i - b.i)
    .map(({ u }) => u);
}

export function unitKcs(unit: ComposerGraph["units"][number]) {
  const ids = new Set<string>(unit.kcs ?? []);
  for (const lesson of unit.lessons) for (const kc of lesson.kcs) ids.add(kc);
  return [...ids];
}

/** A unit opens once every KC of every prereq unit is at mastery ≥ 1. */
export function isUnitUnlocked(graph: ComposerGraph, unitId: string, kc: ReadonlyMap<string, KcState>) {
  const unit = graph.units.find((u) => u.id === unitId);
  if (!unit) return false;
  return (unit.prereqUnits ?? []).every((pid) => {
    const pre = graph.units.find((u) => u.id === pid);
    return !pre || unitKcs(pre).every((id) => (kc.get(id)?.mastery ?? 0) >= 1);
  });
}

/** An unseen KC is learnable when each prereq KC is at mastery ≥ 1. */
export function isKcLearnable(graph: ComposerGraph, kcId: string, kc: ReadonlyMap<string, KcState>) {
  const node = graph.kcs.find((k) => k.id === kcId);
  return (node?.prereqs ?? []).every((id) => (kc.get(id)?.mastery ?? 0) >= 1);
}

/** The ZPD frontier in path order (unlocked units → lessons → KCs). */
export function frontierKcs(inp: Pick<ComposeInput, "graph" | "kc">, restrictTo?: ReadonlySet<string>) {
  const out: string[] = [];
  const seen = new Set<string>();
  for (const unit of orderedUnits(inp.graph)) {
    if (!isUnitUnlocked(inp.graph, unit.id, inp.kc)) continue;
    for (const lesson of unit.lessons) {
      for (const id of lesson.kcs) {
        if (seen.has(id)) continue;
        seen.add(id);
        if (restrictTo && !restrictTo.has(id)) continue;
        if ((inp.kc.get(id)?.seen ?? 0) > 0) continue;
        if (isKcLearnable(inp.graph, id, inp.kc)) out.push(id);
      }
    }
  }
  return out;
}

/** KCs a session may draw from. */
function scopeKcs(inp: ComposeInput): Set<string> {
  if (inp.kind === "lesson" && inp.lessonId) {
    for (const unit of inp.graph.units) {
      const lesson = unit.lessons.find((l) => l.id === inp.lessonId);
      if (!lesson) continue;
      const out = new Set(lesson.kcs);
      for (const id of lesson.kcs) {
        for (const pre of inp.graph.kcs.find((k) => k.id === id)?.prereqs ?? []) out.add(pre);
      }
      return out;
    }
    return new Set();
  }
  if (inp.kind === "practice" && inp.unitId) {
    const unit = inp.graph.units.find((u) => u.id === inp.unitId);
    return new Set(unit ? unitKcs(unit) : []);
  }
  if (inp.kind === "remedial") {
    if (inp.kcIds?.length) return new Set(inp.kcIds);
    return new Set([...inp.kc.values()].filter((s) => isRemedial(s, inp.now)).map((s) => s.kcId));
  }
  return new Set([...inp.kc.values()].filter((s) => s.seen > 0).map((s) => s.kcId));
}

/** Rung = mastery; 70 % exact, 20 % one lower, 10 % one higher. */
export function targetRung(st: KcState | undefined, rnd: () => number, shift = 0, remedial = false, maxRung: number = MAX_COMPOSED_RUNG) {
  const mastery = st?.mastery ?? 0;
  let rung = remedial ? mastery - 1 : mastery;
  if (!remedial) {
    const r = rnd();
    if (r >= 0.9) rung += 1;
    else if (r >= 0.7) rung -= 1;
  }
  return Math.max(0, Math.min(maxRung, rung + shift));
}

function lastSkinFor(ctx: Ctx, kcId: string) {
  let best: { at: number; skin: string } | null = null;
  for (const it of ctx.allByKc.get(kcId) ?? []) {
    const st = ctx.inp.itemState.get(it.id);
    if (!st) continue;
    const at = Date.parse(st.lastSeenAt);
    if (Number.isFinite(at) && (!best || at > best.at)) best = { at, skin: it.skin };
  }
  return best?.skin ?? null;
}

/**
 * Best item for a KC at a rung. Items within ±1 rung are preferred; when the
 * build cannot run any of them, the closest-rung runnable item of the same
 * KC substitutes. Returns null when the KC has no eligible item at all.
 */
function pickItem(
  ctx: Ctx,
  kcId: string,
  rung: number,
  chosen: readonly PlannedItem[],
  exclude: ReadonlySet<string> = new Set(),
): { item: DojoItemIndexRow; substituted: boolean } | null {
  const { inp } = ctx;
  const taken = new Set(chosen.map((c) => c.itemId));
  const takenGroups = new Set(chosen.map((c) => ctx.itemById.get(c.itemId)?.variantGroup).filter(Boolean));
  // Remediation targets KCs a ladder level, a surviving mutant or a missed
  // review issue named; when no item has that KC as its primary, an item that
  // exercises it as a secondary KC still repairs it.
  const primary = ctx.byKc.get(kcId) ?? [];
  const candidates = primary.length || inp.kind !== "remedial" ? primary : ctx.bySecondary.get(kcId) ?? [];
  const eligible = candidates.filter((it) =>
    !taken.has(it.id) && !exclude.has(it.id) && !(it.variantGroup && takenGroups.has(it.variantGroup)));
  if (!eligible.length) return null;

  const near = eligible.filter((it) => Math.abs(ctx.rungOf[it.type] - rung) <= 1);
  const pool = near.length ? near : eligible;
  const runnableNear = (ctx.allByKc.get(kcId) ?? []).some((it) =>
    Math.abs(ctx.rungOf[it.type] - rung) <= 1 && !taken.has(it.id) && !exclude.has(it.id));
  const substituted = !near.length && runnableNear;

  const lastSkin = lastSkinFor(ctx, kcId);
  const lastTwo = chosen.slice(-2).map((c) => ctx.itemById.get(c.itemId)?.type);
  const mastery = masteryOfKc(inp, kcId);
  const recentGroups = new Set<string>();
  for (const it of ctx.allByKc.get(kcId) ?? []) {
    if (it.variantGroup && seenWithinDays(inp.itemState.get(it.id), inp.now, 7)) recentGroups.add(it.variantGroup);
  }

  let best: DojoItemIndexRow | null = null;
  let bestScore = -Infinity;
  for (const it of pool) {
    const score =
      -(seenWithinDays(inp.itemState.get(it.id), inp.now, 7) ? 5 : 0)
      - (it.variantGroup && recentGroups.has(it.variantGroup) ? 2 : 0)
      - (lastSkin !== null && it.skin === lastSkin ? 0.5 : 0)
      - (lastTwo.length === 2 && lastTwo.every((t) => t === it.type) ? 0.4 : 0)
      - 0.3 * Math.abs(ctx.rungOf[it.type] - rung)
      - (it.difficulty > mastery + 1 ? 0.2 * (it.difficulty - mastery - 1) : 0)
      + 0.01 * ctx.rnd();
    if (score > bestScore) {
      bestScore = score;
      best = it;
    }
  }
  return best ? { item: best, substituted } : null;
}

function plan(item: DojoItemIndexRow, kcId: string, reason: PlanReason, rung: number, pPred: number, substituted: boolean): PlannedItem {
  return { itemId: item.id, kcId, reason, targetRung: rung, pPred, substituted, estSeconds: item.estSeconds };
}

// --- composition ---------------------------------------------------------------

export function composeSession(inp: ComposeInput): PlannedItem[] {
  const ctx = buildCtx(inp);
  const { now } = inp;
  const budget = Math.max(1, inp.minutes ?? DEFAULT_SESSION_MINUTES) * 60;
  const shift = inp.rungShift ?? 0;
  const scope = scopeKcs(inp);
  const out: PlannedItem[] = [];
  let used = 0;
  const fits = (it: DojoItemIndexRow) => used + it.estSeconds <= budget || out.length === 0;
  const push = (p: PlannedItem) => {
    out.push(p);
    used += p.estSeconds;
  };

  // 1) Review candidates.
  const p = (s: KcState) => recallProbability(s, now);
  const review = [...scope]
    .map((id) => inp.kc.get(id))
    .filter((s): s is KcState => Boolean(s) && (s as KcState).seen > 0)
    .filter((s) => inp.kind === "lesson" || inp.kind === "practice" || inp.kind === "remedial" ||
      p(s) < R_DUE || isRemedial(s, now))
    .map((s) => ({
      s,
      pri: (R_DUE - p(s)) + (isRemedial(s, now) ? REMEDIAL_PRIORITY_BONUS : 0) + PAYOFF_PRIORITY_WEIGHT * (ctx.payoff.get(s.kcId) ?? 0),
    }))
    .sort((a, b) => b.pri - a.pri || a.s.kcId.localeCompare(b.s.kcId));

  // 2) New KCs (ZPD frontier).
  const anySeen = [...inp.kc.values()].some((s) => s.seen > 0);
  const accuracyOk = inp.lastSessionAccuracy == null || inp.lastSessionAccuracy >= NEW_CONTENT_MIN_ACCURACY;
  let frontier: string[] = [];
  let newBudget = budget * NEW_SHARE[inp.kind];
  if (inp.kind === "lesson") {
    // The learner asked for this lesson: its unseen KCs (and unseen prereqs)
    // are the material. A weak last session narrows it to one KC.
    frontier = frontierKcs(inp, scope);
    if (!accuracyOk) frontier = frontier.slice(0, 1);
    if (!review.length) newBudget = budget;
  } else if (inp.kind === "daily") {
    // A weak last session slows new material to one KC rather than stopping
    // it: with only a few KCs started, review alone would spin on the same
    // handful of skills.
    frontier = frontierKcs(inp).slice(0, accuracyOk ? DAILY_NEW_KCS : 1);
    // Cold start: nothing to review yet, so the whole session teaches.
    if (!anySeen) newBudget = budget;
  }

  const perNewKc = inp.kind === "lesson" ? LESSON_ITEMS_PER_NEW_KC : 1;
  let newUsed = 0;
  for (let round = 0; round < perNewKc; round += 1) {
    for (const kcId of frontier) {
      // First exposure starts at rung 0; later rounds step up to rung 1.
      const rung = Math.min(ctx.maxRung, Math.max(0, Math.min(round, 1) + shift));
      const picked = pickItem(ctx, kcId, rung, out);
      if (!picked) continue;
      if (newUsed + picked.item.estSeconds > newBudget && out.length > 0) continue;
      if (!fits(picked.item)) continue;
      push(plan(picked.item, kcId, "new", rung, 0.5, picked.substituted));
      newUsed += picked.item.estSeconds;
    }
  }

  // 3) Reviews by priority.
  const remedialKind = inp.kind === "remedial";
  for (const { s } of review) {
    if (remedialKind && out.length >= REMEDIAL_MAX_ITEMS) break;
    const rung = targetRung(s, ctx.rnd, shift, remedialKind || isRemedial(s, now), ctx.maxRung);
    const picked = pickItem(ctx, s.kcId, rung, out);
    if (!picked || !fits(picked.item)) continue;
    push(plan(picked.item, s.kcId, remedialKind || isRemedial(s, now) ? "remedial" : "review", rung, p(s), picked.substituted));
  }

  // 4) Keep the drum turning: top up with the weakest started KCs, then a
  //    second pass over the scope for practice / remedial / lesson drills.
  if (inp.kind === "daily" || inp.kind === "review" || inp.kind === "practice" || inp.kind === "lesson" || remedialKind) {
    const pool = (inp.kind === "daily" || inp.kind === "review"
      ? [...inp.kc.values()]
      : [...scope].map((id) => inp.kc.get(id)).filter((s): s is KcState => Boolean(s)))
      .filter((s) => s.seen > 0)
      .sort((a, b) => p(a) - p(b) || a.kcId.localeCompare(b.kcId));
    for (let pass = 0; pass < 2; pass += 1) {
      for (const s of pool) {
        if (remedialKind && out.length >= REMEDIAL_MAX_ITEMS) break;
        if (used >= budget) break;
        const rung = targetRung(s, ctx.rnd, shift, remedialKind, ctx.maxRung);
        const picked = pickItem(ctx, s.kcId, rung, out);
        if (!picked || !fits(picked.item)) continue;
        push(plan(picked.item, s.kcId, remedialKind ? "remedial" : "review", rung, p(s), picked.substituted));
      }
    }
  }

  return orderForFlow(out, ctx.itemById);
}

/**
 * Flow order: warm-up (highest predicted success) → hardest reviews
 * → new material → an easy finish; then a greedy pass so neighbours differ
 * in archetype (and skin) where the plan allows it.
 */
export function orderForFlow(items: readonly PlannedItem[], itemById: ReadonlyMap<string, Pick<DojoItemIndexRow, "archetype" | "skin">>) {
  if (items.length <= 2) return [...items];
  const reviews = items.filter((i) => i.reason !== "new" && i.reason !== "requeue")
    .sort((a, b) => b.pPred - a.pPred || a.itemId.localeCompare(b.itemId));
  const fresh = items.filter((i) => i.reason === "new");
  const requeued = items.filter((i) => i.reason === "requeue");
  const ordered: PlannedItem[] = [];
  if (reviews.length) ordered.push(reviews.shift() as PlannedItem); // warm-up
  const finish = reviews.length ? reviews.shift() as PlannedItem : null; // next-easiest closes
  ordered.push(...reviews.reverse()); // hardest first
  ordered.push(...fresh);
  if (finish) ordered.push(finish);
  ordered.push(...requeued);
  return interleave(ordered, itemById);
}

/** Adjacency cost: same archetype 2, same skin 1, same KC 1. */
function adjacencyCost(
  a: PlannedItem | undefined,
  b: PlannedItem | undefined,
  itemById: ReadonlyMap<string, Pick<DojoItemIndexRow, "archetype" | "skin">>,
) {
  if (!a || !b) return 0;
  const x = itemById.get(a.itemId);
  const y = itemById.get(b.itemId);
  if (!x || !y) return 0;
  return (x.archetype === y.archetype ? 2 : 0) + (x.skin === y.skin ? 1 : 0) + (a.kcId === b.kcId ? 1 : 0);
}

/**
 * Greedy de-clustering: for each position, pull forward the later item that
 * lowers the local adjacency cost most. The warm-up stays first, the finish
 * stays last and requeues stay at the tail.
 */
function interleave(list: PlannedItem[], itemById: ReadonlyMap<string, Pick<DojoItemIndexRow, "archetype" | "skin">>) {
  const out = [...list];
  const tail = out.findIndex((p) => p.reason === "requeue");
  const end = tail === -1 ? out.length : tail;
  for (let i = 1; i < end; i += 1) {
    const here = adjacencyCost(out[i - 1], out[i], itemById);
    if (here === 0) continue;
    let bestJ = -1;
    let bestCost = here;
    // The last slot (the easy finish) is never pulled forward.
    for (let j = i + 1; j < end - 1; j += 1) {
      const cost = adjacencyCost(out[i - 1], out[j], itemById);
      if (cost < bestCost) {
        bestCost = cost;
        bestJ = j;
      }
    }
    if (bestJ !== -1) {
      const [moved] = out.splice(bestJ, 1);
      out.splice(i, 0, moved);
    }
  }
  return out;
}

/**
 * In-session re-queue: after a miss, append a *different* item for the
 * same KC (one rung lower when possible) at the end of the plan. At most
 * MAX_REQUEUES per session; returns the plan unchanged when the cap is hit
 * or no other item exists.
 */
export function requeueMissed(inp: ComposeInput, current: readonly PlannedItem[], missedItemId: string): PlannedItem[] {
  if (current.filter((p) => p.reason === "requeue").length >= MAX_REQUEUES) return [...current];
  const missed = current.find((p) => p.itemId === missedItemId);
  if (!missed) return [...current];
  const ctx = buildCtx({ ...inp, seed: inp.seed ^ hashString(missedItemId) });
  const rung = Math.max(0, missed.targetRung - 1);
  const picked = pickItem(ctx, missed.kcId, rung, current, new Set([missedItemId]));
  if (!picked) return [...current];
  return [...current, plan(picked.item, missed.kcId, "requeue", rung, missed.pPred, picked.substituted)];
}

function hashString(text: string) {
  let h = 2166136261;
  for (let i = 0; i < text.length; i += 1) h = Math.imul(h ^ text.charCodeAt(i), 16777619);
  return h >>> 0;
}

/**
 * The item that serves as a unit's checkpoint: a staged
 * case marked `checkpointFor` the unit wins (discussion series, no sandbox);
 * otherwise the unit's runnable ladder with the longest timebox.
 */
export function checkpointLadderFor(unitId: string, rows: readonly DojoItemIndexRow[], avail: RuntimeAvailability): DojoItemIndexRow | null {
  const cases = rows.filter((row) => row.type === "case" && row.checkpointFor === unitId && isRunnable(row, avail));
  if (cases.length) return cases.sort((a, b) => b.estSeconds - a.estSeconds || a.id.localeCompare(b.id))[0];
  const ladders = rows.filter((row) => row.unit === unitId && row.type === "ladder" && isRunnable(row, avail));
  return ladders.sort((a, b) => b.estSeconds - a.estSeconds || a.id.localeCompare(b.id))[0] ?? null;
}

/** A one-item plan for a checkpoint or a simulation (they are not composed). */
export function singleItemPlan(row: DojoItemIndexRow, kc: ReadonlyMap<string, KcState>, now: Date, reason: PlanReason = "review"): PlannedItem[] {
  const kcId = primaryKc(row);
  const st = kc.get(kcId);
  return [{ itemId: row.id, kcId, reason, targetRung: RUNG_OF[row.type], pPred: st ? recallProbability(st, now) : 0.5, substituted: false, estSeconds: row.estSeconds }];
}

/** Ladders due a retry: retry date passed and the failed KCs recovered. */
export function laddersDueForRetry(rows: readonly DojoItemIndexRow[], itemState: ReadonlyMap<string, ItemState>, kc: ReadonlyMap<string, KcState>, now: Date) {
  return rows.filter((row) => {
    if (row.type !== "ladder") return false;
    const st = itemState.get(row.id);
    if (!st?.nextRetryAt || Date.parse(st.nextRetryAt) > now.getTime()) return false;
    return row.kcs.every((ref) => {
      const s = kc.get(ref.id);
      return !s || s.seen === 0 || recallProbability(s, now) >= R_DUE;
    });
  });
}
