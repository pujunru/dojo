/**
 * The engine: learner model, grading, composer, gamification, series and
 * rubric rules. Pure functions, no browser.
 */
import assert from "node:assert/strict";
import { test } from "node:test";
import { locales } from "../src/i18n/config.ts";
import { schedulerParams } from "../src/core/series.ts";
import type { DojoItemIndexRow, DojoItemType } from "../src/core/content-schema.ts";
import {
  addDays,
  applyRemediation,
  CAP_BELOW_EXTENSION_DAYS,
  CAP_BELOW_PRODUCTION_DAYS,
  dueIntervalDays,
  emptyKcState,
  isRemedial,
  masteryOf,
  R_DUE,
  recallProbability,
  updateKc,
  type Grade,
  type KcState,
} from "../src/core/learner-model.ts";
import {
  buildSignal,
  gradeFor,
  gradesForItem,
  longestCommonSubsequence,
  passThreshold,
  sanitizeSignal,
  scoreChooseDesign,
  scoreFillBlank,
  scoreLadder,
  scoreParsons,
  scorePredict,
  scoreReview,
  scoreRubric,
  scoreSelfGrade,
  scoreSpotBug,
  scoreTests,
  scoreWriteTests,
  type OutcomeSignal,
} from "../src/core/grading.ts";
import {
  composeSession,
  frontierKcs,
  isRunnable,
  MAX_REQUEUES,
  mulberry32,
  NEW_SHARE,
  orderForFlow,
  requeueMissed,
  type ComposeInput,
  type ComposerGraph,
  type ItemState,
  type PlannedItem,
} from "../src/core/composer.ts";
import {
  dayDiff,
  isAcceptableLocalDay,
  isUnitCracked,
  itemXp,
  deviceLocalDay,
  localDayAtOffset,
  recordActivity,
  sessionBonusXp,
  settleStreak,
  unitCrown,
  weeklySelfComparison,
  FULL_CROWN_OPTIONS,
  type StreakState,
} from "../src/core/gamification.ts";

const T0 = new Date("2026-10-05T08:00:00.000Z");
const DAY = 86_400_000;
const at = (days: number) => new Date(T0.getTime() + days * DAY);
const fixedRand = () => 0.5; // jitter midpoint = no jitter

function row(id: string, type: DojoItemType, kc: string, extra: Partial<DojoItemIndexRow> = {}): DojoItemIndexRow {
  return {
    id,
    version: 1,
    type,
    unit: extra.unit ?? "u1",
    lesson: extra.lesson ?? "l1",
    kcs: extra.kcs ?? [{ id: kc, weight: 1 }],
    archetype: extra.archetype ?? "python-core",
    skin: extra.skin ?? "bank",
    difficulty: extra.difficulty ?? 1,
    estSeconds: extra.estSeconds ?? 60,
    runtime: extra.runtime ?? "none",
    ...(extra.variantGroup ? { variantGroup: extra.variantGroup } : {}),
  };
}

function signal(over: Partial<OutcomeSignal> = {}): OutcomeSignal {
  return {
    q: 1, qByKc: {}, passed: true, latencyMs: 40_000, hintsUsed: 0, aiHintsUsed: 0,
    solutionRevealed: false, firstTry: true, ...over,
  };
}

// ---------------------------------------------------------------------------
// Learner model
// ---------------------------------------------------------------------------

test("recall probability halves every half-life; unseen KCs recall nothing", () => {
  const unseen = emptyKcState("a");
  assert.equal(recallProbability(unseen, T0), 0);
  const st: KcState = { ...unseen, seen: 1, correct: 1, halfLifeDays: 4, lastSeenAt: T0.toISOString() };
  assert.equal(recallProbability(st, T0), 1);
  assert.ok(Math.abs(recallProbability(st, at(4)) - 0.5) < 1e-9);
  assert.ok(Math.abs(recallProbability(st, at(8)) - 0.25) < 1e-9);
  assert.ok(Math.abs(dueIntervalDays(1) - 0.5146) < 1e-3);
});

test("first exposure sets the half-life from the grade", () => {
  const expected: Record<Grade, number> = { 1: 0.25, 2: 1, 3: 2, 4: 3 };
  for (const g of [1, 2, 3, 4] as Grade[]) {
    const { state, log } = updateKc(emptyKcState("a"), g, { qKc: g > 1 ? 1 : 0, itemType: "predict", weight: 1, now: T0, rand: fixedRand });
    assert.equal(state.halfLifeDays, expected[g]);
    assert.equal(state.seen, 1);
    assert.equal(state.lapses, 0, "a first-contact Again is not a lapse");
    assert.equal(log.pPred, 0);
    assert.equal(log.deltaDays, 0);
  }
});

test("spacing: reviewing on the due date grows intervals, capped by rung", () => {
  // Recognition only (predict, rung 0): never beyond 7 days.
  let st = emptyKcState("a");
  let now = T0;
  for (let i = 0; i < 12; i += 1) {
    st = updateKc(st, 3, { qKc: 1, itemType: "predict", weight: 1, now, rand: fixedRand }).state;
    now = new Date(Date.parse(st.nextDueAt as string));
  }
  assert.equal(st.halfLifeDays, CAP_BELOW_PRODUCTION_DAYS);

  // Implement (rung 2): grows past 7 but stops at 30.
  st = emptyKcState("b");
  now = T0;
  const intervals: number[] = [];
  for (let i = 0; i < 12; i += 1) {
    const next = updateKc(st, 3, { qKc: 1, itemType: "implement", weight: 1, now, rand: fixedRand }).state;
    intervals.push((Date.parse(next.nextDueAt as string) - now.getTime()) / DAY);
    st = next;
    now = new Date(Date.parse(st.nextDueAt as string));
  }
  for (let i = 1; i < intervals.length; i += 1) assert.ok(intervals[i] >= intervals[i - 1] - 1e-9, `interval ${i} shrank`);
  assert.ok(intervals[3] > 2 * intervals[0]);
  assert.equal(st.halfLifeDays, CAP_BELOW_EXTENSION_DAYS);
  assert.equal(st.bestRung, 2);
  assert.ok(st.mastery >= 3);
});

test("a late (riskier) successful review grows the half-life more than an early one", () => {
  const base: KcState = { ...emptyKcState("a"), seen: 3, correct: 3, halfLifeDays: 4, bestRung: 3, lastSeenAt: T0.toISOString(), mastery: 2 };
  const early = updateKc(base, 3, { qKc: 1, itemType: "implement", weight: 1, now: at(0.5), rand: fixedRand });
  const late = updateKc(base, 3, { qKc: 1, itemType: "implement", weight: 1, now: at(6), rand: fixedRand });
  assert.ok(late.state.halfLifeDays > early.state.halfLifeDays);
  assert.ok(late.log.pPred < early.log.pPred);
  // Easy > Good > Hard at the same moment.
  const g = (grade: Grade) => updateKc(base, grade, { qKc: 1, itemType: "implement", weight: 1, now: at(3), rand: fixedRand }).state.halfLifeDays;
  assert.ok(g(4) > g(3) && g(3) > g(2) && g(2) > base.halfLifeDays);
});

test("lapses shrink the half-life; partial credit softens it; secondary KCs take half", () => {
  const base: KcState = { ...emptyKcState("a"), seen: 5, correct: 5, streak: 5, halfLifeDays: 20, bestRung: 3, lastSeenAt: T0.toISOString(), mastery: 3 };
  const zero = updateKc(base, 1, { qKc: 0, itemType: "implement", weight: 1, now: at(10), rand: fixedRand });
  assert.ok(Math.abs(zero.state.halfLifeDays - 20 * 0.35) < 1e-9);
  assert.equal(zero.state.lapses, 1);
  assert.equal(zero.state.streak, 0);
  assert.equal(zero.state.correct, 5);
  const partial = updateKc(base, 1, { qKc: 0.5, itemType: "implement", weight: 1, now: at(10), rand: fixedRand });
  assert.ok(partial.state.halfLifeDays > zero.state.halfLifeDays);
  const secondary = updateKc(base, 1, { qKc: 0, itemType: "implement", weight: 0.5, now: at(10), rand: fixedRand });
  assert.ok(Math.abs(secondary.state.halfLifeDays - 20 * (1 - 0.5 * 0.65)) < 1e-9);
  assert.equal(zero.log.hBefore, 20);
  assert.equal(zero.log.grade, 1);
  // The floor holds.
  const tiny = updateKc({ ...base, halfLifeDays: 0.12 }, 1, { qKc: 0, itemType: "predict", weight: 1, now: at(1), rand: fixedRand });
  assert.equal(tiny.state.halfLifeDays, 0.1);
});

test("jitter is applied above three days and is deterministic under an injected rand", () => {
  const base: KcState = { ...emptyKcState("a"), seen: 4, correct: 4, halfLifeDays: 20, bestRung: 3, lastSeenAt: T0.toISOString(), mastery: 3 };
  const lo = updateKc(base, 3, { qKc: 1, itemType: "refactor", weight: 1, now: at(10), rand: () => 0 }).state;
  const hi = updateKc(base, 3, { qKc: 1, itemType: "refactor", weight: 1, now: at(10), rand: () => 0.999 }).state;
  assert.ok(Date.parse(lo.nextDueAt as string) < Date.parse(hi.nextDueAt as string));
  assert.equal(lo.halfLifeDays, hi.halfLifeDays);
});

test("mastery levels follow §6.3", () => {
  const s = (over: Partial<KcState>): KcState => ({ ...emptyKcState("a"), seen: 1, correct: 1, ...over });
  assert.equal(masteryOf(emptyKcState("a")), 0);
  assert.equal(masteryOf(s({ correct: 0 })), 0);
  assert.equal(masteryOf(s({ halfLifeDays: 2, bestRung: 0 })), 1);
  assert.equal(masteryOf(s({ halfLifeDays: 3, bestRung: 1 })), 2);
  assert.equal(masteryOf(s({ halfLifeDays: 12, bestRung: 1 })), 2, "rung gates level 3");
  assert.equal(masteryOf(s({ halfLifeDays: 12, bestRung: 2 })), 3);
  assert.equal(masteryOf(s({ halfLifeDays: 30, bestRung: 4 })), 4);
  assert.equal(masteryOf(s({ halfLifeDays: 70, bestRung: 4 })), 4);
  assert.equal(masteryOf(s({ halfLifeDays: 70, bestRung: 5 })), 5);
  assert.equal(masteryOf(s({ halfLifeDays: 70, bestRung: 4 }), { checkpointPassedAt: at(-10).toISOString(), now: T0 }), 5);
  assert.equal(masteryOf(s({ halfLifeDays: 70, bestRung: 4 }), { checkpointPassedAt: at(-100).toISOString(), now: T0 }), 4);
});

test("remediation caps the half-life and opens a three-day window", () => {
  const base: KcState = { ...emptyKcState("a"), seen: 4, correct: 4, halfLifeDays: 9, bestRung: 2, lastSeenAt: T0.toISOString(), mastery: 2 };
  const r = applyRemediation(base, T0);
  assert.equal(r.halfLifeDays, 0.5);
  assert.ok(isRemedial(r, at(2.9)));
  assert.ok(!isRemedial(r, at(3.1)));
  assert.ok(Date.parse(r.nextDueAt as string) < at(1).getTime());
});

// ---------------------------------------------------------------------------
// Grading
// ---------------------------------------------------------------------------

test("gradeFor: Again on failure or revealed solution, Hard on hints/slow/retry, Easy when fast", () => {
  const item = { type: "implement" as const, estSeconds: 100 };
  assert.equal(gradeFor("a", signal({ q: 0.9 }), item), 1);
  assert.equal(gradeFor("a", signal({ solutionRevealed: true }), item), 1);
  assert.equal(gradeFor("a", signal({ hintsUsed: 1 }), item), 2);
  assert.equal(gradeFor("a", signal({ latencyMs: 250_000 }), item), 2);
  assert.equal(gradeFor("a", signal({ firstTry: false }), item), 2);
  assert.equal(gradeFor("a", signal({ latencyMs: 59_000 }), item), 4);
  assert.equal(gradeFor("a", signal({ latencyMs: 61_000 }), item), 3);
  // Per-KC: one KC failed its tests while the item as a whole scored high.
  assert.equal(gradeFor("b", signal({ q: 1, qByKc: { b: 0.5 } }), item), 1);
  assert.equal(passThreshold("spot-bug"), 0.75);
  assert.equal(passThreshold("explain", 0.6), 0.6);
});

test("gradesForItem lists every KC, primary first", () => {
  const item = row("dj-x", "implement", "a", { kcs: [{ id: "b", weight: 0.5 }, { id: "a", weight: 1 }] });
  const g = gradesForItem(signal({ q: 0.75, qByKc: { a: 1, b: 0.5 } }), item);
  assert.deepEqual(g.map((x) => [x.kcId, x.weight, x.grade]), [["a", 1, 3], ["b", 0.5, 1]]);
});

test("per-type scorers", () => {
  assert.equal(scorePredict({ kcs: ["a"], expected: { mode: "stdout", stdout: "1\n2\n" }, answer: { stdout: "1  \r\n2" } }).q, 1);
  assert.equal(scorePredict({ kcs: ["a"], expected: { mode: "choice", correct: 2 }, answer: { choice: 1 } }).q, 0);
  assert.equal(scorePredict({ kcs: ["a"], expected: { mode: "exception", excType: "KeyError" }, answer: { excType: "KeyError" } }).qByKc.a, 1);

  const bug = scoreSpotBug({
    kcs: ["a"], tolerance: 1,
    bugs: [{ path: "m.py", lines: [10], kcs: ["a"] }, { path: "m.py", lines: [20], kcs: ["b"] }],
    selected: [{ path: "m.py", line: 11 }, { path: "m.py", line: 40 }],
  });
  assert.ok(Math.abs(bug.q - 0.5) < 1e-9); // P = 0.5, R = 0.5
  assert.equal(bug.qByKc.a, 1);
  assert.equal(bug.qByKc.b, 0);

  const fill = scoreFillBlank({
    blanks: [{ id: "x", accept: ["d.get(k, 0)"], kcs: ["a"] }, { id: "y", accept: ["sorted(xs)"], kcs: ["b"] }],
    answers: { x: "  d.get(k,  0) ", y: "xs.sort()" },
  });
  assert.equal(fill.q, 0.5);
  assert.deepEqual(fill.qByKc, { a: 1, b: 0 });
  assert.equal(scoreFillBlank({ blanks: [{ id: "x", accept: ["q"], kcs: ["a"] }], answers: { x: "other" }, testsPassed: true }).q, 1);

  assert.equal(longestCommonSubsequence(["a", "b", "c", "d"], ["a", "c", "b", "d"]), 3);
  assert.equal(scoreParsons({ kcs: ["a"], solutions: [["1", "2", "3"], ["2", "1", "3"]], order: ["2", "1", "3"] }).q, 1);
  const parsons = scoreParsons({ kcs: ["a"], solutions: [["1", "2", "3", "4"]], order: ["1", "3", "2", "4"] });
  assert.equal(parsons.q, 0.5 * 0.75);

  const opts = [{ id: "x", correct: true }, { id: "y", correct: true }, { id: "z", correct: false }];
  assert.equal(scoreChooseDesign({ kcs: ["a"], options: opts, selected: ["y", "x"] }).q, 1);
  assert.equal(scoreChooseDesign({ kcs: ["a"], options: opts, selected: ["x"] }).q, 0.5);
  assert.equal(scoreChooseDesign({ kcs: ["a"], options: opts, selected: ["x", "z"] }).q, 0);
  assert.ok(Math.abs(scoreChooseDesign({ kcs: ["a"], options: opts, selected: ["x", "y"], rationaleQ: 0.5 }).q - 0.85) < 1e-9);

  const tests = scoreTests({
    kcs: ["a", "b", "c"],
    testMeta: [{ id: "t1", kcs: ["a"] }, { id: "t2", kcs: ["a", "b"] }, { id: "t3", kcs: ["b"] }, { id: "t4", kcs: [] }],
    results: [{ id: "t1", passed: true }, { id: "t2", passed: false }, { id: "t3", passed: true }, { id: "t4", passed: true }],
  });
  assert.equal(tests.q, 0.75);
  assert.deepEqual(tests.qByKc, { a: 0.5, b: 0.5, c: 0.75 });

  const wt = scoreWriteTests({ kcs: ["a"], greenOnReference: true, killTarget: 0.8, mutants: [{ id: "m1", kcs: ["a"] }, { id: "m2", kcs: ["a"] }, { id: "m3", kcs: ["b"] }, { id: "m4", kcs: ["b"] }, { id: "m5", kcs: ["b"] }], killed: ["m1", "m2", "m3", "m4"] });
  assert.equal(wt.q, 1);
  assert.equal(scoreWriteTests({ kcs: ["a"], greenOnReference: false, killTarget: 0.8, mutants: [{ id: "m1", kcs: ["a"] }], killed: ["m1"] }).q, 0);

  const ladder = scoreLadder({
    kcs: ["a"],
    levels: [{ id: "L1", testMeta: [{ id: "t1", kcs: ["a"] }] }, { id: "L2", testMeta: [{ id: "t2", kcs: ["b"] }] }],
    results: { L1: [{ id: "t1", passed: true }], L2: [{ id: "t2", passed: false }] },
  });
  assert.equal(ladder.q, 0.5);
  assert.deepEqual(ladder.levelsPassed, ["L1"]);

  const rubric = scoreRubric({ kcs: ["a"], criteria: [{ id: "c1", kcs: ["a"], weight: 2 }, { id: "c2", kcs: ["b"], weight: 1 }], scores: [{ id: "c1", score: 1 }, { id: "c2", score: 0.4 }] });
  assert.ok(Math.abs(rubric.q - 0.8) < 1e-9);
  assert.equal(rubric.qByKc.b, 0.4);

  assert.equal(scoreSelfGrade(2, ["a"]).q, 0.7);
  const review = scoreReview({
    kcs: ["a"], tolerance: 1,
    issues: [{ id: "i1", path: "x.py", line: 5, kcs: ["a"] }, { id: "i2", path: "x.py", line: 30, kcs: ["b"] }],
    comments: [{ path: "x.py", line: 6 }, { path: "x.py", line: 100 }],
    contentScores: { i1: 0.5 },
  });
  assert.ok(Math.abs(review.q - (0.25 - 0.1)) < 1e-9);
});

test("buildSignal and sanitizeSignal recompute pass and reject foreign KCs", () => {
  const s = buildSignal("spot-bug", { q: 0.8, qByKc: { a: 2 } }, { latencyMs: 1000, hintsUsed: 0, aiHintsUsed: 0, solutionRevealed: false, firstTry: true });
  assert.equal(s.passed, true);
  assert.equal(s.qByKc.a, 1);
  const item = row("dj-x", "implement", "a");
  const ok = sanitizeSignal({ q: 7, passed: false, latencyMs: 9e12, hintsUsed: -3, qByKc: { a: 0.9 } }, item);
  assert.ok(ok.ok);
  if (ok.ok) {
    assert.equal(ok.signal.q, 1);
    assert.equal(ok.signal.passed, true, "server derives passed");
    assert.equal(ok.signal.latencyMs, 6 * 3_600_000);
    assert.equal(ok.signal.hintsUsed, 0);
  }
  assert.deepEqual(sanitizeSignal({ q: 1, latencyMs: 1, qByKc: { zz: 1 } }, item), { ok: false, field: "signal.qByKc" });
  assert.deepEqual(sanitizeSignal({ latencyMs: 1 }, item), { ok: false, field: "signal.q" });
  assert.deepEqual(sanitizeSignal(null, item), { ok: false, field: "signal" });
});

// ---------------------------------------------------------------------------
// Composer
// ---------------------------------------------------------------------------

const GRAPH: ComposerGraph = {
  tiers: [{ id: "t0", order: 0 }, { id: "t1", order: 1 }],
  units: [
    { id: "u2", tier: "t1", order: 1, prereqUnits: ["u1"], kcs: ["c"], lessons: [{ id: "l3", kcs: ["c"] }] },
    { id: "u1", tier: "t0", order: 1, prereqUnits: [], kcs: ["a", "b", "d", "e"], lessons: [{ id: "l1", kcs: ["a", "b"] }, { id: "l2", kcs: ["d", "e"] }] },
  ],
  kcs: [
    { id: "a", prereqs: [], payoff: ["A1", "A2"] },
    { id: "b", prereqs: ["a"], payoff: [] },
    { id: "c", prereqs: [], payoff: [] },
    { id: "d", prereqs: [], payoff: ["A1"] },
    { id: "e", prereqs: [], payoff: [] },
  ],
};

function itemsFor(kc: string, unit: string, lesson: string, archetype: DojoItemIndexRow["archetype"] = "python-core"): DojoItemIndexRow[] {
  const types: DojoItemType[] = ["predict", "parsons", "fill-blank", "spot-bug", "implement", "refactor"];
  const skins = ["bank", "crawler"];
  const out: DojoItemIndexRow[] = [];
  types.forEach((type) => {
    for (const skin of skins) {
      out.push(row(`dj-${kc}-${type}-${skin}`, type, kc, {
        unit, lesson, skin, archetype,
        runtime: type === "implement" || type === "refactor" ? "sandbox:python" : "none",
        estSeconds: type === "implement" ? 180 : 60,
      }));
    }
  });
  out.push(row(`dj-${kc}-ladder`, "ladder", kc, { unit, lesson, runtime: "sandbox:python", estSeconds: 1200 }));
  return out;
}

const ITEMS: DojoItemIndexRow[] = [
  ...itemsFor("a", "u1", "l1"),
  ...itemsFor("b", "u1", "l1", "stateful-time"),
  ...itemsFor("c", "u2", "l3"),
  ...itemsFor("d", "u1", "l2", "persistence"),
  ...itemsFor("e", "u1", "l2"),
];

function learned(kcId: string, over: Partial<KcState> = {}): KcState {
  return { ...emptyKcState(kcId), seen: 3, correct: 3, halfLifeDays: 2, bestRung: 1, mastery: 1, lastSeenAt: at(-10).toISOString(), ...over };
}

function input(over: Partial<ComposeInput> = {}): ComposeInput {
  return {
    kind: "daily",
    graph: GRAPH,
    items: ITEMS,
    kc: new Map(),
    itemState: new Map(),
    runtimeAvailability: { "sandbox:python": true },
    now: T0,
    seed: 42,
    minutes: 10,
    ...over,
  };
}

const byId = new Map(ITEMS.map((i) => [i.id, i]));

test("cold-start daily teaches only the ZPD frontier: prereqs and locked units gate new KCs", () => {
  assert.deepEqual(frontierKcs(input()), ["a", "d", "e"]);
  const plan = composeSession(input());
  assert.ok(plan.length > 0);
  assert.ok(plan.every((p) => p.reason === "new"));
  const kcs = new Set(plan.map((p) => p.kcId));
  assert.ok(!kcs.has("b"), "b needs a at mastery ≥ 1");
  assert.ok(!kcs.has("c"), "u2 is locked until u1 is learned");
  for (const p of plan) assert.ok(byId.get(p.itemId)!.type === "predict" || byId.get(p.itemId)!.type === "parsons" || byId.get(p.itemId)!.type === "fill-blank" || byId.get(p.itemId)!.type === "spot-bug", "new material starts at low rungs");

  // Once a is learned, b opens; once all of u1 is, u2 opens.
  const kc = new Map([["a", learned("a")]]);
  assert.deepEqual(frontierKcs({ graph: GRAPH, kc }), ["b", "d", "e"]);
  const all = new Map(["a", "b", "d", "e"].map((id) => [id, learned(id)]));
  assert.deepEqual(frontierKcs({ graph: GRAPH, kc: all }), ["c"]);
});

test("daily keeps new material within its 20% share and puts due KCs first", () => {
  const kc = new Map(["a", "b", "d", "e"].map((id, i) => [id, learned(id, { lastSeenAt: at(-5 - i).toISOString() })]));
  // Make u2 reachable so there is new material on offer.
  const plan = composeSession(input({ kc, minutes: 10 }));
  const newSec = plan.filter((p) => p.reason === "new").reduce((s, p) => s + p.estSeconds, 0);
  const total = plan.reduce((s, p) => s + p.estSeconds, 0);
  assert.ok(newSec <= 600 * NEW_SHARE.daily + 1e-9, `new ${newSec}s exceeds share`);
  assert.ok(total <= 600);
  assert.ok(plan.some((p) => p.reason === "review"));
  // Every due KC gets reviewed.
  for (const id of ["a", "b", "d", "e"]) assert.ok(plan.some((p) => p.kcId === id), `due KC ${id} missing`);
});

test("a weak last session slows daily to one new KC (ZPD)", () => {
  const kc = new Map(["a", "b", "d", "e"].map((id) => [id, learned(id)]));
  const weak = composeSession(input({ kc, lastSessionAccuracy: 0.5 }));
  assert.ok(new Set(weak.filter((p) => p.reason === "new").map((p) => p.kcId)).size <= 1);
  const strong = composeSession(input({ kc, lastSessionAccuracy: 0.9 }));
  assert.ok(strong.some((p) => p.reason === "new" && p.kcId === "c"));
});

test("runtime filtering: without the sandbox, sandbox items are replaced by same-KC items", () => {
  const kc = new Map([["a", learned("a", { mastery: 2, bestRung: 2, halfLifeDays: 4 })]]);
  for (let seed = 0; seed < 20; seed += 1) {
    const plan = composeSession(input({ kind: "review", kc, seed, runtimeAvailability: { "sandbox:python": false } }));
    for (const p of plan) assert.equal(byId.get(p.itemId)!.runtime, "none");
    assert.ok(plan.every((p) => p.kcId === "a"));
  }
  assert.equal(isRunnable({ runtime: "sandbox:python" }, { "sandbox:python": false }), false);
  assert.equal(isRunnable({ runtime: "sandbox:python" }, { "sandbox:python": true }), true);
  // With the sandbox, implement items become eligible at rung 2.
  const withSandbox = composeSession(input({ kind: "review", kc, seed: 1, runtimeAvailability: { "sandbox:python": true } }));
  assert.ok(withSandbox.some((p) => byId.get(p.itemId)!.runtime === "sandbox:python"));
  // Ladders and mocks are never composed.
  assert.ok(withSandbox.every((p) => byId.get(p.itemId)!.type !== "ladder"));
});

test("a KC whose only items need the sandbox is substituted and flagged", () => {
  const items = [
    row("dj-z-impl", "implement", "z", { runtime: "sandbox:python" }),
    row("dj-z-predict", "predict", "z"),
  ];
  const graph: ComposerGraph = { units: [{ id: "u1", lessons: [{ id: "l1", kcs: ["z"] }] }], kcs: [{ id: "z", prereqs: [] }] };
  const kc = new Map([["z", learned("z", { mastery: 3, bestRung: 2, halfLifeDays: 12, lastSeenAt: at(-30).toISOString() })]]);
  const plan = composeSession(input({ kind: "review", graph, items, kc, runtimeAvailability: { "sandbox:python": false } }));
  assert.equal(plan[0].itemId, "dj-z-predict");
  assert.equal(plan[0].substituted, true);
});

test("item choice: no repeat within a week, rotate skins, exclude variant siblings", () => {
  const items = [
    row("dj-k-1", "predict", "k", { skin: "bank", variantGroup: "vg" }),
    row("dj-k-2", "predict", "k", { skin: "bank", variantGroup: "vg" }),
    row("dj-k-3", "predict", "k", { skin: "crawler" }),
    row("dj-k-4", "parsons", "k", { skin: "bank" }),
  ];
  const graph: ComposerGraph = { units: [{ id: "u1", lessons: [{ id: "l1", kcs: ["k"] }] }], kcs: [{ id: "k", prereqs: [] }] };
  const kc = new Map([["k", learned("k", { mastery: 0, bestRung: 0, correct: 0 })]]);
  const itemState = new Map<string, ItemState>([
    ["dj-k-4", { itemId: "dj-k-4", lastSeenAt: at(-1).toISOString(), seen: 1, lastQ: 1, bestLevel: null, nextRetryAt: null }],
  ]);
  for (let seed = 0; seed < 10; seed += 1) {
    const plan = composeSession(input({ kind: "practice", unitId: "u1", graph, items, kc, itemState, seed }));
    const ids = plan.map((p) => p.itemId);
    assert.ok(!(ids.includes("dj-k-1") && ids.includes("dj-k-2")), "variant siblings in one session");
    assert.equal(new Set(ids).size, ids.length, "duplicate item");
    assert.ok(ids.includes("dj-k-3"), "skin rotation: the last skin was bank, so crawler is preferred");
    assert.ok(!ids.includes("dj-k-4") || ids.length === 3, "seen yesterday: only as a last resort");
  }
});

test("composition is deterministic for a seed and respects the time budget", () => {
  const kc = new Map(["a", "b", "d", "e"].map((id, i) => [id, learned(id, { lastSeenAt: at(-3 - i).toISOString() })]));
  const a = composeSession(input({ kc, seed: 7 }));
  const b = composeSession(input({ kc, seed: 7 }));
  assert.deepEqual(a, b);
  const short = composeSession(input({ kc, seed: 7, minutes: 3 }));
  assert.ok(short.reduce((s, p) => s + p.estSeconds, 0) <= 180);
  const r = mulberry32(1);
  const r2 = mulberry32(1);
  assert.equal(r(), r2());
});

test("remedial sessions target KCs in their window at a lower rung, ≤ 5 items", () => {
  const rem = applyRemediation(learned("a", { mastery: 3, bestRung: 2, halfLifeDays: 12 }), at(-1));
  const kc = new Map([["a", { ...rem, mastery: 3 as const }], ["d", learned("d")]]);
  const plan = composeSession(input({ kind: "remedial", kc }));
  assert.ok(plan.length > 0 && plan.length <= 5);
  assert.ok(plan.every((p) => p.kcId === "a" && p.reason === "remedial"));
  assert.ok(plan.every((p) => p.targetRung === 2));
});

test("lesson sessions teach the lesson's KCs with several items each", () => {
  const plan = composeSession(input({ kind: "lesson", lessonId: "l1" }));
  assert.ok(plan.length >= 3);
  assert.ok(plan.every((p) => p.kcId === "a"), "b is gated until a is learned");
  assert.ok(plan.some((p) => p.targetRung === 1));
});

test("orderForFlow: warm-up first, finish last, neighbours de-clustered", () => {
  const mk = (itemId: string, kcId: string, reason: PlannedItem["reason"], pPred: number): PlannedItem =>
    ({ itemId, kcId, reason, pPred, targetRung: 0, substituted: false, estSeconds: 60 });
  const meta = new Map([
    ["w", { archetype: "python-core" as const, skin: "s1" }],
    ["h1", { archetype: "python-core" as const, skin: "s1" }],
    ["h2", { archetype: "python-core" as const, skin: "s2" }],
    ["x", { archetype: "persistence" as const, skin: "s3" }],
    ["n", { archetype: "serving" as const, skin: "s4" }],
    ["f", { archetype: "persistence" as const, skin: "s5" }],
  ]);
  const ordered = orderForFlow([
    mk("h1", "k1", "review", 0.2), mk("w", "k2", "review", 0.69), mk("h2", "k3", "review", 0.3),
    mk("x", "k4", "review", 0.25), mk("n", "k5", "new", 0.5), mk("f", "k6", "review", 0.6),
  ], meta);
  assert.equal(ordered[0].itemId, "w");
  assert.equal(ordered.at(-1)!.itemId, "f");
  for (let i = 1; i < ordered.length - 1; i += 1) {
    const x = meta.get(ordered[i - 1].itemId)!;
    const y = meta.get(ordered[i].itemId)!;
    assert.ok(!(x.archetype === y.archetype && x.skin === y.skin), `clustered at ${i}`);
  }
});

test("requeue appends a different same-KC item, at most twice", () => {
  const kc = new Map([["a", learned("a", { mastery: 2, bestRung: 1, halfLifeDays: 3 })]]);
  const inp = input({ kind: "review", kc });
  let plan = composeSession(inp);
  const missed = plan[0];
  plan = requeueMissed(inp, plan, missed.itemId);
  const added = plan.at(-1)!;
  assert.equal(added.reason, "requeue");
  assert.equal(added.kcId, missed.kcId);
  assert.notEqual(added.itemId, missed.itemId);
  plan = requeueMissed(inp, plan, plan[1]?.itemId ?? missed.itemId);
  const capped = requeueMissed(inp, plan, missed.itemId);
  assert.ok(capped.filter((p) => p.reason === "requeue").length <= MAX_REQUEUES);
});

test("simulated month: daily sessions keep every learned KC near or above R_DUE", () => {
  let kc = new Map<string, KcState>();
  const itemState = new Map<string, ItemState>();
  const rnd = mulberry32(99);
  for (let day = 0; day < 30; day += 1) {
    const now = at(day);
    const plan = composeSession(input({ kc, itemState, now, seed: day, minutes: 10 }));
    for (const p of plan) {
      const item = byId.get(p.itemId)!;
      const s = signal({ latencyMs: item.estSeconds * 1000 });
      for (const g of gradesForItem(s, item)) {
        const before = kc.get(g.kcId) ?? emptyKcState(g.kcId);
        kc.set(g.kcId, updateKc(before, g.grade, { qKc: g.qKc, itemType: item.type, weight: g.weight, now, rand: rnd }).state);
      }
      itemState.set(item.id, { itemId: item.id, lastSeenAt: now.toISOString(), seen: (itemState.get(item.id)?.seen ?? 0) + 1, lastQ: 1, bestLevel: null, nextRetryAt: null });
    }
    kc = new Map(kc);
  }
  const learnedKcs = [...kc.values()].filter((s) => s.seen > 0);
  assert.ok(learnedKcs.length >= 4, `only ${learnedKcs.length} KCs learned in 30 days`);
  const atEnd = at(30);
  const lowest = Math.min(...learnedKcs.map((s) => recallProbability(s, atEnd)));
  assert.ok(lowest > 0.4, `a KC decayed to ${lowest}`);
  assert.ok(learnedKcs.some((s) => s.halfLifeDays > 5), "intervals never grew");
  assert.ok(R_DUE === 0.7);
});

// ---------------------------------------------------------------------------
// Gamification
// ---------------------------------------------------------------------------

test("XP per item and per session", () => {
  assert.equal(itemXp("implement", 0.75), 6);
  assert.equal(itemXp("predict", 1), 2);
  assert.equal(itemXp("predict", 0.01), 1);
  assert.equal(itemXp("implement", 1, true), 0);
  assert.equal(itemXp("explain", 0), 0);
  assert.equal(sessionBonusXp(5, 1), 10);
  assert.equal(sessionBonusXp(5, 0.8), 5);
  assert.equal(sessionBonusXp(0, null), 0);
});

test("local days across midnight and time zones", () => {
  const instant = new Date("2026-03-01T23:30:00.000Z");
  assert.equal(localDayAtOffset(instant, 0), "2026-03-01");
  assert.equal(localDayAtOffset(instant, 480), "2026-03-02"); // Asia/Shanghai
  assert.equal(localDayAtOffset(instant, -480), "2026-03-01"); // America/Los_Angeles (PST)
  assert.equal(localDayAtOffset(new Date("2026-03-02T07:59:00.000Z"), -480), "2026-03-01");
  assert.equal(localDayAtOffset(new Date("2026-03-02T08:00:00.000Z"), -480), "2026-03-02");
  assert.equal(localDayAtOffset(new Date("2026-12-31T10:00:00.000Z"), 840), "2027-01-01"); // UTC+14
  const probe = new Date("2026-07-01T12:00:00.000Z");
  assert.equal(deviceLocalDay(probe), localDayAtOffset(probe, -probe.getTimezoneOffset()));
  assert.equal(dayDiff("2026-02-28", "2026-03-01"), 1);
  assert.equal(dayDiff("2028-02-28", "2028-03-01"), 2);
  assert.equal(isAcceptableLocalDay("2026-10-06", T0), true);
  assert.equal(isAcceptableLocalDay("2026-10-04", T0), true);
  assert.equal(isAcceptableLocalDay("2026-10-07", T0), false);
  assert.equal(isAcceptableLocalDay("2026-02-30", new Date("2026-02-28T00:00:00Z")), false);
  assert.equal(isAcceptableLocalDay("20261005", T0), false);
  assert.equal(isAcceptableLocalDay(undefined, T0), false);
});

test("streaks: extend, same day, bridge with freezes, reset, earn and cap freezes", () => {
  const empty: StreakState = { streakCurrent: 0, streakBest: 0, lastActiveDay: null, freezes: 0 };
  let r = recordActivity(empty, "2026-10-01");
  assert.equal(r.change, "extended");
  assert.equal(r.state.streakCurrent, 1);
  assert.equal(recordActivity(r.state, "2026-10-01").change, "unchanged");
  assert.equal(recordActivity(r.state, "2026-09-30").change, "unchanged", "a day before the last active day");

  let st = r.state;
  for (let d = 2; d <= 7; d += 1) {
    r = recordActivity(st, `2026-10-0${d}`);
    st = r.state;
  }
  assert.equal(st.streakCurrent, 7);
  assert.equal(r.freezeEarned, true);
  assert.equal(st.freezes, 1);

  // Two missed days, one freeze: reset.
  const reset = recordActivity(st, "2026-10-10");
  assert.equal(reset.change, "reset");
  assert.equal(reset.state.streakCurrent, 1);
  assert.equal(reset.state.freezes, 1);
  assert.equal(reset.state.streakBest, 7);

  // One missed day, one freeze: kept.
  const kept = recordActivity(st, "2026-10-09");
  assert.equal(kept.change, "kept-by-freeze");
  assert.equal(kept.state.streakCurrent, 8);
  assert.equal(kept.state.freezes, 0);
  assert.deepEqual(kept.frozenDays, ["2026-10-08"]);

  // Freezes cap at two.
  const rich: StreakState = { streakCurrent: 20, streakBest: 20, lastActiveDay: "2026-10-01", freezes: 2 };
  const capped = recordActivity(rich, "2026-10-02");
  assert.equal(capped.state.streakCurrent, 21);
  assert.equal(capped.state.freezes, 2);
  assert.equal(capped.freezeEarned, false);

  // Across a month boundary.
  const eom = recordActivity({ streakCurrent: 3, streakBest: 3, lastActiveDay: "2026-10-31", freezes: 0 }, "2026-11-01");
  assert.equal(eom.change, "extended");

  // Read-only settlement.
  assert.equal(settleStreak(st, "2026-10-07").atRisk, false);
  assert.equal(settleStreak(st, "2026-10-08").atRisk, true);
  assert.equal(settleStreak(st, "2026-10-09").streakCurrent, 7);
  assert.equal(settleStreak(st, "2026-10-09").freezesPending, 1);
  assert.equal(settleStreak(st, "2026-10-10").streakCurrent, 0);
});

test("unit crowns are the minimum KC mastery, gated and capped; cracks show decay", () => {
  const states = new Map<string, KcState>([
    ["a", learned("a", { halfLifeDays: 12, bestRung: 2, mastery: 3, lastSeenAt: T0.toISOString() })],
    ["b", learned("b", { halfLifeDays: 4, bestRung: 1, mastery: 2, lastSeenAt: T0.toISOString() })],
  ]);
  assert.equal(unitCrown(["a", "b"], states, null), 2);
  assert.equal(unitCrown(["a"], states, null), 3);
  assert.equal(unitCrown(["a"], states, null, FULL_CROWN_OPTIONS), 3, "the checkpoint gates crowns above 3 only");
  assert.equal(unitCrown(["a", "c"], states, null), 0, "an untouched KC holds the crown at 0");
  assert.equal(isUnitCracked(["a", "b"], states, T0), false);
  assert.equal(isUnitCracked(["a", "b"], states, at(5)), true);
  const cmp = weeklySelfComparison([{ localDay: "2026-10-05", xp: 30 }, { localDay: "2026-09-30", xp: 10 }, { localDay: "2026-09-20", xp: 40 }], "2026-10-05");
  assert.equal(cmp.thisWeek, 40); // 09-30 is five days back: same rolling week
  assert.equal(cmp.medianPrior, 0); // prior weeks 0, 40, 0, 0
});

// ---------------------------------------------------------------------------
// Advanced item types, remediation routing, checkpoints
// ---------------------------------------------------------------------------

test("refactor: old (visible) and new (hidden) tests both count", async () => {
  const { scoreRefactor } = await import("../src/core/grading.ts");
  const meta = [
    { id: "test_old_a", kcs: ["a"], hidden: false },
    { id: "test_old_b", kcs: ["a"], hidden: false },
    { id: "test_new", kcs: ["b"], hidden: true },
  ];
  const s = scoreRefactor({ kcs: ["a", "b"], testMeta: meta, results: [{ id: "test_old_a", passed: true }, { id: "test_old_b", passed: false }, { id: "test_new", passed: true }] });
  assert.deepEqual(s.old, { passed: 1, total: 2 });
  assert.deepEqual(s.added, { passed: 1, total: 1 });
  assert.equal(Math.round(s.q * 100), 67);
  assert.equal(s.qByKc.a, 0.5, "a regression lowers the old KC");
});

test("write-tests from a run: reference failure scores 0, kills map to mutant KCs", async () => {
  const { scoreWriteTestsRun, weakKcs } = await import("../src/core/grading.ts");
  const mutants = [{ id: "m1", kcs: ["a"] }, { id: "m2", kcs: ["b"] }, { id: "m3", kcs: ["a"] }, { id: "m4", kcs: ["b"] }];
  assert.equal(scoreWriteTestsRun({ kcs: ["a", "b"], mutants, killTarget: 0.75, run: { status: "tests_fail_on_reference" } }).q, 0);
  const s = scoreWriteTestsRun({ kcs: ["a", "b"], mutants, killTarget: 0.75, run: { status: "mutants", mutants: [{ id: "m1", killed: true }, { id: "m2", killed: true }, { id: "m3", killed: true }, { id: "m4", killed: false }] } });
  assert.equal(s.qByKc.a, 1);
  assert.equal(Math.round(s.qByKc.b * 100), 67); // 1 of 2 killed against a 0.75 target
  assert.deepEqual(weakKcs(s, "write-tests"), ["b"], "surviving mutants route their KC to remediation");
});

test("review findings: tolerance, severity/category credit, false positives", async () => {
  const { scoreReviewFindings } = await import("../src/core/grading.ts");
  const issues = [
    { id: "i1", path: "p.py", line: 10, kcs: ["a"], severity: "major", category: "correctness" },
    { id: "i2", path: "p.py", line: 20, kcs: ["b"], severity: "blocker", category: "state" },
  ];
  const s = scoreReviewFindings({
    kcs: ["a", "b"], issues, tolerance: 1,
    findings: [
      { path: "p.py", line: 11, severity: "major", category: "Correctness" },
      { path: "p.py", line: 30, severity: "minor", category: "style" },
    ],
  });
  assert.deepEqual(s.hits.map((h) => [h.issueId, h.severityOk, h.categoryOk]), [["i1", true, true]]);
  assert.deepEqual(s.missed, ["i2"]);
  assert.deepEqual(s.falsePositives, [1]);
  assert.equal(s.qByKc.a, 1);
  assert.equal(s.qByKc.b, 0);
  assert.equal(Math.round(s.q * 100), 40); // 0.5 recall − 0.1 for one false positive
  const half = scoreReviewFindings({ kcs: ["a"], issues: [issues[0]], tolerance: 1, findings: [{ path: "p.py", line: 10, severity: "minor", category: null }] });
  assert.equal(half.q, 0.5, "located but wrong severity and no category");
});

test("ladder outcomes: failed and skipped levels feed remediation, overtime caps at Hard", async () => {
  const { scoreLadderOutcomes } = await import("../src/core/grading.ts");
  const levels = [
    { id: "l1", kcs: ["a"], testMeta: [{ id: "test_1", kcs: ["a"] }] },
    { id: "l2", kcs: ["b"], testMeta: [{ id: "test_2", kcs: ["b"] }] },
    { id: "l3", kcs: ["c"], testMeta: [{ id: "test_3", kcs: ["c"] }] },
  ];
  const s = scoreLadderOutcomes({
    kcs: ["a", "b", "c"], levels,
    outcomes: {
      l1: { status: "passed", results: [{ id: "test_1", passed: true }], elapsedSec: 700, timeboxSec: 600 },
      l2: { status: "failed", results: [{ id: "test_2", passed: false }], elapsedSec: 300, timeboxSec: 600 },
      l3: { status: "skipped", results: [], elapsedSec: 0, timeboxSec: 900 },
    },
  });
  assert.deepEqual(s.levelsPassed, ["l1"]);
  assert.deepEqual(s.overtimeLevels, ["l1"]);
  assert.deepEqual(s.overtimeKcs, ["a"]);
  assert.deepEqual(s.failedKcs.sort(), ["b", "c"]);
  const signal = buildSignal("ladder", s, { latencyMs: 60_000, hintsUsed: 0, aiHintsUsed: 0, solutionRevealed: false, firstTry: true, overtimeKcs: s.overtimeKcs });
  const ladderRow = row("dj-l", "ladder", "a", { kcs: [{ id: "a", weight: 1 }, { id: "b", weight: 0.5 }, { id: "c", weight: 0.5 }], estSeconds: 2100 });
  // Per-KC grading: a's level passed (q_kc = 1) but overtime; b's level failed.
  assert.equal(gradeFor("a", signal, ladderRow), 2, "overtime level: Hard");
  assert.equal(gradeFor("b", signal, ladderRow), 1);
  const sanitized = sanitizeSignal({ ...signal, overtimeKcs: ["a"] }, ladderRow);
  assert.ok(sanitized.ok && sanitized.signal.overtimeKcs?.[0] === "a");
  assert.equal(sanitizeSignal({ ...signal, overtimeKcs: ["zzz"] }, ladderRow).ok, false);
});

test("remedial sessions fall back to items that exercise a KC as secondary", async () => {
  const items = [
    row("dj-i1", "implement", "p", { kcs: [{ id: "p", weight: 1 }, { id: "s", weight: 0.5 }] }),
    row("dj-i2", "predict", "p"),
  ];
  const graph: ComposerGraph = { units: [{ id: "u", lessons: [{ id: "l", kcs: ["p"] }] }], kcs: [{ id: "p", prereqs: [] }, { id: "s", prereqs: [] }] };
  const kc = new Map<string, KcState>([["s", learned("s", { remedialUntil: addDays(T0, 2).toISOString(), mastery: 2 })], ["p", learned("p")]]);
  const plan = composeSession({ kind: "remedial", graph, items, kc, itemState: new Map(), runtimeAvailability: { "sandbox:python": true }, now: T0, seed: 1, kcIds: ["s"] });
  assert.deepEqual(plan.map((p) => [p.itemId, p.kcId]), [["dj-i1", "s"]]);
  const daily = composeSession({ kind: "daily", graph, items, kc, itemState: new Map(), runtimeAvailability: { "sandbox:python": true }, now: T0, seed: 1 });
  assert.ok(!daily.some((p) => p.kcId === "s"), "only remedial sessions use the secondary fallback");
});

test("checkpoint helpers: ladder per unit, retry after recovery, timed pass", async () => {
  const { checkpointLadderFor, laddersDueForRetry, singleItemPlan } = await import("../src/core/composer.ts");
  const { passesCheckpoint, checkpointUnitOf } = await import("../src/core/gamification.ts");
  const rows = [row("dj-l1", "ladder", "a", { unit: "u", estSeconds: 600, runtime: "sandbox:python" }), row("dj-l2", "ladder", "a", { unit: "u", estSeconds: 2100, runtime: "sandbox:python" })];
  assert.equal(checkpointLadderFor("u", rows, { "sandbox:python": true })?.id, "dj-l2");
  assert.equal(checkpointLadderFor("u", rows, { "sandbox:python": false }), null);
  assert.equal(singleItemPlan(rows[1], new Map(), T0)[0].targetRung, 4);
  const itemState = new Map<string, ItemState>([["dj-l2", { itemId: "dj-l2", lastSeenAt: T0.toISOString(), seen: 1, lastQ: 0.3, bestLevel: null, nextRetryAt: addDays(T0, 2).toISOString() }]]);
  assert.equal(laddersDueForRetry(rows, itemState, new Map(), T0).length, 0);
  assert.equal(laddersDueForRetry(rows, itemState, new Map(), addDays(T0, 3)).length, 1);
  assert.equal(checkpointUnitOf({ type: "ladder", unit: "u" }), "u");
  assert.equal(checkpointUnitOf({ type: "implement", unit: "u" }), null);
  assert.equal(passesCheckpoint({ passed: true, solutionRevealed: false, latencyMs: 2100_000 }, 2100), true);
  assert.equal(passesCheckpoint({ passed: true, solutionRevealed: false, latencyMs: 3000_000 }, 2100), false, "a checkpoint is timed");
});

test("a start continues the unfinished session for the same target instead of composing anew", async () => {
  const { resumableSession } = await import("../src/app/resume.ts");
  const base = {
    id: "djs-1", kind: "lesson", unitId: "u-a", lessonId: "l-1", contentHash: "abc", startedAt: "2026-10-09T18:00:00.000Z",
    finishedAt: null, abandoned: false, itemsDone: 2, itemsPassed: 1, accuracy: null, xp: 0, activeSec: 0, localDay: "2026-10-09",
    planned: [1, 2, 3, 4].map((i) => ({ itemId: `dj-${i}`, reason: "new", kcId: "k" })),
  } as const;
  const lesson = { ...base, planned: [...base.planned] } as never;
  assert.equal(resumableSession(lesson, { kind: "lesson", lessonId: "l-1" }, "2026-10-09"), lesson);
  assert.equal(resumableSession(lesson, { kind: "lesson", lessonId: "l-2" }, "2026-10-09"), null);
  assert.equal(resumableSession(lesson, { kind: "daily" }, "2026-10-09"), null);
  const daily = { ...base, kind: "daily", lessonId: null, planned: [...base.planned] } as never;
  assert.equal(resumableSession(daily, { kind: "daily" }, "2026-10-09"), daily);
  assert.equal(resumableSession(daily, { kind: "daily" }, "2026-10-10"), null, "yesterday's daily is not today's");
  const spent = { ...base, itemsDone: 4, planned: [...base.planned] } as never;
  assert.equal(resumableSession(spent, { kind: "lesson", lessonId: "l-1" }, "2026-10-09"), null, "nothing left to play");
  assert.equal(resumableSession(null, { kind: "daily" }, "2026-10-09"), null);
});

test("series: ids are qualified per series and parsed back", async () => {
  const s = await import("../src/core/series.ts");
  assert.equal(s.qualifyItemId("python", "dj-flu-x"), "dj-python-flu-x");
  assert.equal(s.qualifyRef("mleval", "eval-clarify"), "mleval:eval-clarify");
  assert.equal(s.seriesOfItemId("dj-python-flu-x"), "python");
  assert.equal(s.seriesOfItemId("dj-_demo-demo-x"), "_demo");
  assert.equal(s.seriesOfRef("python:py-dict-idioms"), "python");
  assert.equal(s.seriesOfRef("py-dict-idioms"), null);
  assert.equal(s.localRef("python:u-py-fluency"), "u-py-fluency");
  assert.ok(s.isSeriesId("python") && s.isSeriesId("_demo") && !s.isSeriesId("ml-eval") && !s.isSeriesId("Python"));
});

test("series: config validation, runtimes and scheduler overrides", async () => {
  const s = await import("../src/core/series.ts");
  const ok = s.parseSeriesConfig({ id: "mleval", order: 2, title_zh: "评测", title_en: "Eval", archetypes: ["eval-design"], runtimes: ["none", "sandbox:python"], scheduler: { rungOf: { explain: 2 }, capBelowProductionDays: 10 } }, "mleval");
  assert.ok(ok.ok);
  const bad = s.parseSeriesConfig({ id: "mleval", order: 1, title_zh: "x", title_en: "x", archetypes: [], runtimes: ["sandbox:python"] }, "other");
  assert.ok(!bad.ok && bad.errors.some((e) => /directory/.test(e)) && bad.errors.some((e) => /"none"/.test(e)) && bad.errors.some((e) => /archetypes/.test(e)));
  assert.equal(s.runtimeAvailable("none", {}), true);
  assert.equal(s.runtimeAvailable("sandbox:python", { "sandbox:python": false }), false);
  assert.equal(s.runtimeAvailable("sandbox:ruby", { "sandbox:python": true }), false);
  const p = s.schedulerParams({ rungOf: { explain: 2 }, capBelowProductionDays: 10 });
  assert.equal(p.rungOf.explain, 2);
  assert.equal(p.rungOf.implement, s.DEFAULT_SCHEDULER.rungOf.implement);
  assert.equal(p.capBelowProductionDays, 10);
});

test("series scheduler: rung and caps change what a pass is worth", () => {
  const st = learned("k", { halfLifeDays: 6, bestRung: 1, mastery: 1, seen: 3, correct: 3 });
  const now = new Date(Date.parse(st.lastSeenAt!) + 6 * 86_400_000);
  const python = updateKc(st, 4, { qKc: 1, itemType: "explain", weight: 1, now, rand: () => 0.5 });
  // Under the default scheduler explain is rung 1: the KC stays capped at 7 days.
  assert.ok(python.state.halfLifeDays <= 7, `capped, got ${python.state.halfLifeDays}`);
  assert.equal(python.state.bestRung, 1);
  const discussion = updateKc(st, 4, { qKc: 1, itemType: "explain", weight: 1, now, rand: () => 0.5, params: schedulerParams({ rungOf: { explain: 2 } }) });
  // A discussion series counts explaining as production (rung 2): the 7-day cap no longer applies.
  assert.equal(discussion.state.bestRung, 2);
  assert.ok(discussion.state.halfLifeDays > python.state.halfLifeDays);
});

test("rubric: forbidden-phrase criteria and mustMention are decided from the text", async () => {
  const r = await import("../src/core/rubric.ts");
  const c = { id: "no-bleu", kcs: ["k"], weight: 1, description: { [locales[0]]: "Does not use BLEU", [locales[1]]: "不用 BLEU" }, forbidden: ["BLEU", " 困惑度 "] } as never;
  assert.deepEqual(r.forbiddenPhrases(c), ["BLEU", "困惑度"]);
  assert.deepEqual(r.forbiddenPhrases({ forbidden: undefined } as never), []);
  assert.deepEqual(r.forbiddenHits(c, "I would track bleu and resolution"), ["BLEU"]);
  assert.deepEqual(r.forbiddenHits(c, "resolution rate"), []);
  assert.deepEqual(r.missingMentions({ mustMention: ["基线", "TPR"] }, "和基线比较"), ["TPR"]);
});

test("case: stages weigh equally whatever their criteria count; KCs score their own criteria", async () => {
  const g = await import("../src/core/grading.ts");
  const crit = (id: string, kc: string, weight = 1) => ({ id, kcs: [kc], weight, description: Object.fromEntries(locales.map((l) => [l, id])) });
  const item = {
    type: "case", kcs: [{ id: "a", weight: 1 }, { id: "b", weight: 0.5 }],
    stages: [
      { id: "s1", question: {}, modelAnswer: {}, rubric: { passAt: 0.7, criteria: [crit("x", "a"), crit("y", "a"), crit("z", "b")] } },
      { id: "s2", question: {}, modelAnswer: {}, rubric: { passAt: 0.7, criteria: [crit("w", "a")] } },
    ],
  } as never;
  const score = g.scoreCase(item, { s1: [{ id: "x", met: true }, { id: "y", met: true }, { id: "z", met: true }], s2: [{ id: "w", met: false }] });
  assert.ok(Math.abs(score.q - 0.5) < 1e-9, `half the stages, got ${score.q}`);
  assert.ok(score.qByKc.b === 1);
  assert.ok(Math.abs(score.qByKc.a - 0.4) < 1e-9, `a: 2/3 of stage 1 + none of stage 2, got ${score.qByKc.a}`);
  const unjudged = g.scoreCase(item, { s1: [{ id: "x", met: true }, { id: "y", met: true }, { id: "z", met: true }] });
  assert.ok(Math.abs(unjudged.q - 0.5) < 1e-9, "an unjudged stage counts as not met");
});
