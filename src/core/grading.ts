/**
 * Dojo grading (docs/ARCHITECTURE.md): a per-type raw result becomes a
 * score `q ∈ [0, 1]`, a per-KC decomposition `qByKc`, and finally one of
 * Again / Hard / Good / Easy per KC for the scheduler.
 *
 * The scorers take the minimal facts they need (test → KC tags, bug lines,
 * blanks, …) rather than whole content items, so they stay usable from the
 * player, the store and tests alike. The store recomputes `passed` and the
 * grades from the signal; it never trusts a grade the player computed.
 */
import type { CaseItem, DojoItemIndexRow, DojoItemType, Rubric } from "./content-schema";
import type { Grade } from "./learner-model";
import { rubricQ, rubricQByKc, type CriterionVerdict } from "./rubric";

export type OutcomeSignal = {
  q: number;
  qByKc: Record<string, number>;
  passed: boolean;
  /** First display to first submit, excluding runtime load. */
  latencyMs: number;
  hintsUsed: number;
  aiHintsUsed: number;
  solutionRevealed: boolean;
  /** The first submission passed. */
  firstTry: boolean;
  /**
   * Ladder: KCs of levels that passed only after their timebox ran out.
   * Their grade caps at Hard; a failed KC stays Again.
   */
  overtimeKcs?: string[];
  /**
   * Rubric-judged answers (explain, case stages, choose-design rationale).
   * `by` says who decided the criteria: the AI judge or the learner. An AI
   * verdict never yields Easy -- only the learner's own `userGrade` can -- and
   * `userGrade` lets the learner overrule the judge in either direction.
   */
  judge?: { by: "ai" | "self"; userGrade?: Grade };
};

/** The scored part of a signal; the player adds latency, hints and flags. */
export type Score = { q: number; qByKc: Record<string, number> };

export const DEFAULT_RUBRIC_PASS_AT = 0.7;
/** Latency above this multiple of `estSeconds` downgrades to Hard. */
export const SLOW_FACTOR = 2.0;
/** Latency below this multiple of `estSeconds` upgrades Good to Easy. */
export const FAST_FACTOR = 0.6;
/** Ceiling on a reported latency. */
export const MAX_LATENCY_MS = 6 * 3_600_000;
/** Review: each comment that matches no issue costs this much q. */
export const REVIEW_FALSE_POSITIVE_PENALTY = 0.1;
/** Parsons: a wrong order earns at most this much (LCS partial credit). */
export const PARSONS_PARTIAL_MAX = 0.5;
const EPS = 1e-9;

const PASS_AT: Record<DojoItemType, number> = {
  predict: 1,
  parsons: 1,
  "fill-blank": 1,
  "choose-design": 1,
  "spot-bug": 0.75,
  implement: 1,
  refactor: 1,
  "write-tests": 1,
  ladder: 1,
  explain: DEFAULT_RUBRIC_PASS_AT,
  review: DEFAULT_RUBRIC_PASS_AT,
  case: DEFAULT_RUBRIC_PASS_AT,
};

/** Pass threshold for a type; rubric types may carry their own `passAt`. */
export function passThreshold(type: DojoItemType, rubricPassAt?: number) {
  if ((type === "explain" || type === "review" || type === "case") &&
      typeof rubricPassAt === "number" && Number.isFinite(rubricPassAt)) {
    return clamp01(rubricPassAt);
  }
  return PASS_AT[type];
}

export function isPass(type: DojoItemType, q: number, solutionRevealed: boolean, rubricPassAt?: number) {
  return !solutionRevealed && q >= passThreshold(type, rubricPassAt) - EPS;
}

type GradeItem = Pick<DojoItemIndexRow, "type" | "estSeconds">;

/** The four-way label for one KC of an answered item. */
export function gradeFor(kcId: string, s: OutcomeSignal, item: GradeItem, rubricPassAt?: number): Grade {
  const base = baseGradeFor(kcId, s, item, rubricPassAt);
  if (!s.judge) return base;
  const user = s.judge.userGrade;
  // The learner's own verdict wins: "I didn't know it" fails every KC, "that
  // was hard" caps them, and only an explicit Easy reaches 4.
  if (user === 1) return 1;
  if (user === 2) return Math.min(base, 2) as Grade;
  if (user === 4) return base === 1 ? 1 : 4;
  return Math.min(base, 3) as Grade;
}

function baseGradeFor(kcId: string, s: OutcomeSignal, item: GradeItem, rubricPassAt?: number): Grade {
  const q = s.qByKc[kcId] ?? s.q;
  if (s.solutionRevealed || q < passThreshold(item.type, rubricPassAt) - EPS) return 1;
  const estMs = Math.max(1, item.estSeconds) * 1000;
  const slow = s.latencyMs > SLOW_FACTOR * estMs;
  if (s.hintsUsed + s.aiHintsUsed > 0 || slow || !s.firstTry) return 2;
  if (s.overtimeKcs?.includes(kcId)) return 2;
  return s.latencyMs < FAST_FACTOR * estMs ? 4 : 3;
}

export type KcGrade = { kcId: string; weight: 1 | 0.5; qKc: number; grade: Grade };

/** Grades for every KC the item exercises, primary first. */
export function gradesForItem(s: OutcomeSignal, item: GradeItem & Pick<DojoItemIndexRow, "kcs">, rubricPassAt?: number): KcGrade[] {
  return [...item.kcs]
    .sort((a, b) => b.weight - a.weight)
    .map((ref) => ({
      kcId: ref.id,
      weight: ref.weight,
      qKc: clamp01(s.qByKc[ref.id] ?? s.q),
      grade: gradeFor(ref.id, s, item, rubricPassAt),
    }));
}

// ---------------------------------------------------------------------------
// Per-type scorers
// ---------------------------------------------------------------------------

/** Same q for every KC. */
export function uniformScore(q: number, kcs: readonly string[]): Score {
  const v = clamp01(q);
  return { q: v, qByKc: Object.fromEntries(kcs.map((kc) => [kc, v])) };
}

/** stdout / exception comparison: trailing whitespace and newline style ignored. */
export function normalizeOutput(text: string) {
  return text.replace(/\r\n?/g, "\n").split("\n").map((line) => line.replace(/\s+$/, "")).join("\n").replace(/\n+$/, "");
}

export function scorePredict(input: {
  kcs: readonly string[];
  expected: { mode: "stdout"; stdout: string } | { mode: "choice"; correct: number } | { mode: "exception"; excType: string };
  answer: { stdout?: string; choice?: number; excType?: string };
}): Score {
  const { expected, answer } = input;
  let ok = false;
  if (expected.mode === "stdout") ok = typeof answer.stdout === "string" && normalizeOutput(answer.stdout) === normalizeOutput(expected.stdout);
  else if (expected.mode === "choice") ok = answer.choice === expected.correct;
  else ok = typeof answer.excType === "string" && answer.excType.trim() === expected.excType.trim();
  return uniformScore(ok ? 1 : 0, input.kcs);
}

type Located = { path: string; line: number };

/**
 * Spot-bug: F1 of selected lines against the bug lines within `tolerance`.
 * Each bug counts toward its own KCs only. With a fix stage, half the score
 * comes from the fix's test pass rate.
 */
export function scoreSpotBug(input: {
  kcs: readonly string[];
  bugs: readonly { path: string; lines: readonly number[]; kcs: readonly string[] }[];
  tolerance: number;
  selected: readonly Located[];
  fixPassRate?: number;
}): Score {
  const tol = Math.max(0, input.tolerance);
  const hits = (sel: Located, bug: (typeof input.bugs)[number]) =>
    sel.path === bug.path && bug.lines.some((l) => Math.abs(l - sel.line) <= tol);
  const found = input.bugs.map((bug) => input.selected.some((sel) => hits(sel, bug)));
  const truePositives = input.selected.filter((sel) => input.bugs.some((bug) => hits(sel, bug))).length;
  const recall = input.bugs.length ? found.filter(Boolean).length / input.bugs.length : 0;
  const precision = input.selected.length ? truePositives / input.selected.length : 0;
  let q = precision + recall > 0 ? (2 * precision * recall) / (precision + recall) : 0;
  const fix = typeof input.fixPassRate === "number" ? clamp01(input.fixPassRate) : null;
  if (fix !== null) q = 0.5 * q + 0.5 * fix;

  const perKc = new Map<string, number[]>();
  input.bugs.forEach((bug, i) => {
    const hit = found[i] ? 1 : 0;
    const kcQ = fix === null ? hit : 0.5 * hit + 0.5 * fix;
    for (const kc of bug.kcs) perKc.set(kc, [...(perKc.get(kc) ?? []), kcQ]);
  });
  return { q: clamp01(q), qByKc: averaged(perKc) };
}

/** Normalise a blank for exact matching: collapse whitespace, strip ends. */
export function normalizeBlank(text: string) {
  return text.replace(/\s+/g, " ").trim();
}

/** Fill-blank: share of blanks matched (or all, if the tests passed). */
export function scoreFillBlank(input: {
  blanks: readonly { id: string; accept: readonly string[]; kcs: readonly string[] }[];
  answers: Readonly<Record<string, string>>;
  testsPassed?: boolean;
}): Score {
  const perKc = new Map<string, number[]>();
  let ok = 0;
  for (const blank of input.blanks) {
    const given = normalizeBlank(input.answers[blank.id] ?? "");
    const hit = input.testsPassed === true || blank.accept.some((a) => normalizeBlank(a) === given);
    if (hit) ok += 1;
    for (const kc of blank.kcs) perKc.set(kc, [...(perKc.get(kc) ?? []), hit ? 1 : 0]);
  }
  return { q: input.blanks.length ? ok / input.blanks.length : 0, qByKc: averaged(perKc) };
}

export function longestCommonSubsequence(a: readonly string[], b: readonly string[]) {
  const dp = Array.from({ length: a.length + 1 }, () => new Array<number>(b.length + 1).fill(0));
  for (let i = 1; i <= a.length; i += 1) {
    for (let j = 1; j <= b.length; j += 1) {
      dp[i][j] = a[i - 1] === b[j - 1] ? dp[i - 1][j - 1] + 1 : Math.max(dp[i - 1][j], dp[i][j - 1]);
    }
  }
  return dp[a.length][b.length];
}

/** Parsons: an accepted order (or green tests) is 1; otherwise LCS credit ≤ 0.5. */
export function scoreParsons(input: {
  kcs: readonly string[];
  solutions: readonly (readonly string[])[];
  order: readonly string[];
  testsPassed?: boolean;
}): Score {
  const exact = input.solutions.some((sol) => sol.length === input.order.length && sol.every((id, i) => id === input.order[i]));
  if (exact || input.testsPassed === true) return uniformScore(1, input.kcs);
  let best = 0;
  for (const sol of input.solutions) {
    const denom = Math.max(sol.length, input.order.length);
    if (denom) best = Math.max(best, longestCommonSubsequence(sol, input.order) / denom);
  }
  return uniformScore(PARSONS_PARTIAL_MAX * best, input.kcs);
}

/**
 * Choose-design: exact selection = 1. A multi-select earns partial credit
 * (correct picks minus wrong picks over the correct count) that can never
 * reach the pass mark. With a rationale score: `0.7·choice + 0.3·rationale`.
 */
export function scoreChooseDesign(input: {
  kcs: readonly string[];
  options: readonly { id: string; correct: boolean }[];
  selected: readonly string[];
  rationaleQ?: number;
}): Score {
  const correct = new Set(input.options.filter((o) => o.correct).map((o) => o.id));
  const picked = new Set(input.selected);
  const exact = correct.size === picked.size && [...picked].every((id) => correct.has(id));
  let choice = exact ? 1 : 0;
  if (!exact && correct.size > 1) {
    const tp = [...picked].filter((id) => correct.has(id)).length;
    const fp = picked.size - tp;
    choice = Math.min(0.99, Math.max(0, (tp - fp) / correct.size));
  }
  const q = typeof input.rationaleQ === "number" ? 0.7 * choice + 0.3 * clamp01(input.rationaleQ) : choice;
  return uniformScore(q, input.kcs);
}

export type TestResult = { id: string; passed: boolean };

/**
 * Hidden tests (implement / refactor / a ladder level): q is the pass rate
 * with equal weights; `q_kc` = passed / total over the tests tagged with
 * that KC. KCs with no tagged test inherit q.
 */
export function scoreTests(input: {
  kcs: readonly string[];
  testMeta: readonly { id: string; kcs: readonly string[] }[];
  results: readonly TestResult[];
}): Score {
  const passed = new Map(input.results.map((r) => [r.id, r.passed]));
  const total = input.testMeta.length;
  const ok = input.testMeta.filter((t) => passed.get(t.id) === true).length;
  const q = total ? ok / total : 0;
  const perKc = new Map<string, number[]>();
  for (const t of input.testMeta) {
    for (const kc of t.kcs) perKc.set(kc, [...(perKc.get(kc) ?? []), passed.get(t.id) === true ? 1 : 0]);
  }
  const qByKc = averaged(perKc);
  for (const kc of input.kcs) if (!(kc in qByKc)) qByKc[kc] = q;
  return { q, qByKc };
}

/** Write-tests: green on the reference is a precondition; q = killed share / killTarget. */
export function scoreWriteTests(input: {
  kcs: readonly string[];
  greenOnReference: boolean;
  mutants: readonly { id: string; kcs: readonly string[] }[];
  killed: readonly string[];
  killTarget: number;
}): Score {
  if (!input.greenOnReference) return uniformScore(0, input.kcs);
  const killed = new Set(input.killed);
  const target = input.killTarget > 0 ? input.killTarget : 0.8;
  const share = input.mutants.length ? input.mutants.filter((m) => killed.has(m.id)).length / input.mutants.length : 0;
  const perKc = new Map<string, number[]>();
  for (const m of input.mutants) {
    for (const kc of m.kcs) perKc.set(kc, [...(perKc.get(kc) ?? []), killed.has(m.id) ? 1 : 0]);
  }
  const qByKc: Record<string, number> = {};
  for (const [kc, vals] of perKc) qByKc[kc] = clamp01(mean(vals) / target);
  const q = clamp01(share / target);
  for (const kc of input.kcs) if (!(kc in qByKc)) qByKc[kc] = q;
  return { q, qByKc };
}

/** Ladder (whole item): q = levels passed / levels; KCs from each level's tests. */
export function scoreLadder(input: {
  kcs: readonly string[];
  levels: readonly { id: string; testMeta: readonly { id: string; kcs: readonly string[] }[] }[];
  results: Readonly<Record<string, readonly TestResult[]>>;
}): Score & { levelsPassed: string[] } {
  const levelsPassed: string[] = [];
  const perKc = new Map<string, number[]>();
  for (const level of input.levels) {
    const s = scoreTests({ kcs: [], testMeta: level.testMeta, results: input.results[level.id] ?? [] });
    if (level.testMeta.length && s.q >= 1 - EPS) levelsPassed.push(level.id);
    for (const [kc, v] of Object.entries(s.qByKc)) perKc.set(kc, [...(perKc.get(kc) ?? []), v]);
  }
  const q = input.levels.length ? levelsPassed.length / input.levels.length : 0;
  const qByKc = averaged(perKc);
  for (const kc of input.kcs) if (!(kc in qByKc)) qByKc[kc] = q;
  return { q, qByKc, levelsPassed };
}

/** Rubric (explain / review / case stages): `q = Σ w·s / Σ w`, per criterion KC. */
export function scoreRubric(input: {
  kcs: readonly string[];
  criteria: readonly { id: string; kcs: readonly string[]; weight: number }[];
  scores: readonly { id: string; score: number }[];
}): Score {
  const byId = new Map(input.scores.map((s) => [s.id, clamp01(s.score)]));
  let num = 0;
  let den = 0;
  const kcNum = new Map<string, number>();
  const kcDen = new Map<string, number>();
  for (const c of input.criteria) {
    const w = Math.max(0, c.weight);
    const s = byId.get(c.id) ?? 0;
    num += w * s;
    den += w;
    for (const kc of c.kcs) {
      kcNum.set(kc, (kcNum.get(kc) ?? 0) + w * s);
      kcDen.set(kc, (kcDen.get(kc) ?? 0) + w);
    }
  }
  const q = den > 0 ? num / den : 0;
  const qByKc: Record<string, number> = {};
  for (const [kc, d] of kcDen) qByKc[kc] = d > 0 ? (kcNum.get(kc) ?? 0) / d : q;
  for (const kc of input.kcs) if (!(kc in qByKc)) qByKc[kc] = q;
  return { q, qByKc };
}

/**
 * Self-grade against the model answer (explain without AI). The learner's
 * label becomes q so the normal pipeline still applies: Again fails, Hard
 * lands exactly on the default rubric pass mark.
 */
export const SELF_GRADE_Q: Record<Grade, number> = { 1: 0, 2: DEFAULT_RUBRIC_PASS_AT, 3: 0.9, 4: 1 };
export function scoreSelfGrade(grade: Grade, kcs: readonly string[]): Score {
  return uniformScore(SELF_GRADE_Q[grade], kcs);
}

/**
 * Review: a comment within `tolerance` lines of an issue locates it; the
 * content score (AI 0/0.5/1, or 1 when only locating is graded) decides how
 * much it counts. Comments matching no issue cost a fixed penalty.
 */
export function scoreReview(input: {
  kcs: readonly string[];
  issues: readonly { id: string; path: string; line: number; kcs: readonly string[] }[];
  tolerance: number;
  comments: readonly Located[];
  contentScores?: Readonly<Record<string, number>>;
}): Score {
  const tol = Math.max(0, input.tolerance);
  const near = (c: Located, i: (typeof input.issues)[number]) => c.path === i.path && Math.abs(c.line - i.line) <= tol;
  const perKc = new Map<string, number[]>();
  let sum = 0;
  for (const issue of input.issues) {
    const located = input.comments.some((c) => near(c, issue));
    const s = located ? clamp01(input.contentScores?.[issue.id] ?? 1) : 0;
    sum += s;
    for (const kc of issue.kcs) perKc.set(kc, [...(perKc.get(kc) ?? []), s]);
  }
  const falsePositives = input.comments.filter((c) => !input.issues.some((i) => near(c, i))).length;
  const recall = input.issues.length ? sum / input.issues.length : 0;
  const q = clamp01(recall - REVIEW_FALSE_POSITIVE_PENALTY * falsePositives);
  return { q, qByKc: averaged(perKc) };
}

// ---------------------------------------------------------------------------
// Advanced types (WP9): refactor, write-tests, review findings, ladder
// ---------------------------------------------------------------------------

/**
 * Refactor: the baseline's existing suite (`hidden: false`, the item's
 * visible tests) must stay green while the new requirement's hidden tests go
 * green. q is the pass rate over both, so a regression costs as much as a
 * missing feature; the split is reported for the view.
 */
export function scoreRefactor(input: {
  kcs: readonly string[];
  testMeta: readonly { id: string; kcs: readonly string[]; hidden: boolean }[];
  results: readonly TestResult[];
}): Score & { old: { passed: number; total: number }; added: { passed: number; total: number } } {
  const passed = new Map(input.results.map((r) => [r.id, r.passed]));
  const count = (hidden: boolean) => {
    const metas = input.testMeta.filter((t) => t.hidden === hidden);
    return { passed: metas.filter((t) => passed.get(t.id) === true).length, total: metas.length };
  };
  return { ...scoreTests(input), old: count(false), added: count(true) };
}

/** Write-tests from a harness mutant run (or its precondition failure). */
export function scoreWriteTestsRun(input: {
  kcs: readonly string[];
  mutants: readonly { id: string; kcs: readonly string[] }[];
  killTarget: number;
  run: { status: "mutants"; mutants: readonly { id: string; killed: boolean }[] } | { status: string };
}): Score {
  const green = input.run.status === "mutants";
  const killed = green ? (input.run as { mutants: readonly { id: string; killed: boolean }[] }).mutants.filter((m) => m.killed).map((m) => m.id) : [];
  return scoreWriteTests({ kcs: input.kcs, greenOnReference: green, mutants: input.mutants, killed, killTarget: input.killTarget });
}

export const REVIEW_SEVERITIES = ["blocker", "major", "minor"] as const;
export type ReviewSeverity = (typeof REVIEW_SEVERITIES)[number];
export type ReviewFinding = { path: string; line: number; severity: ReviewSeverity | null; category: string | null };
/** A located issue earns this much; matching severity and category earn the rest. */
export const REVIEW_LOCATE_SHARE = 0.5;

export type ReviewBreakdown = {
  /** issue id → index of the finding that located it. */
  hits: { issueId: string; finding: number; severityOk: boolean; categoryOk: boolean }[];
  missed: string[];
  /** Finding indices that located no issue. */
  falsePositives: number[];
};

/**
 * Review with structured findings: a finding within `tolerance` lines of an
 * issue locates it (each finding locates at most one issue, nearest first);
 * a located issue scores 0.5 plus 0.25 each for the right severity and
 * category. Unmatched findings are false positives (fixed penalty).
 */
export function scoreReviewFindings(input: {
  kcs: readonly string[];
  issues: readonly { id: string; path: string; line: number; kcs: readonly string[]; severity: string; category: string }[];
  tolerance: number;
  findings: readonly ReviewFinding[];
}): Score & ReviewBreakdown {
  const tol = Math.max(0, input.tolerance);
  const used = new Set<number>();
  const hits: ReviewBreakdown["hits"] = [];
  const missed: string[] = [];
  const contentScores: Record<string, number> = {};
  const comments: Located[] = [];
  for (const issue of input.issues) {
    let best = -1;
    let bestDist = Infinity;
    input.findings.forEach((f, i) => {
      const dist = Math.abs(f.line - issue.line);
      if (used.has(i) || f.path !== issue.path || dist > tol || dist >= bestDist) return;
      best = i;
      bestDist = dist;
    });
    if (best === -1) {
      missed.push(issue.id);
      continue;
    }
    used.add(best);
    const f = input.findings[best];
    const severityOk = f.severity === issue.severity;
    const categoryOk = (f.category ?? "").trim().toLowerCase() === issue.category.trim().toLowerCase();
    hits.push({ issueId: issue.id, finding: best, severityOk, categoryOk });
    contentScores[issue.id] = REVIEW_LOCATE_SHARE + (severityOk ? 0.25 : 0) + (categoryOk ? 0.25 : 0);
    comments.push({ path: issue.path, line: issue.line });
  }
  const falsePositives = input.findings.map((_, i) => i).filter((i) => !used.has(i));
  // Unmatched findings are placed far away so scoreReview counts them as false positives.
  for (const _ of falsePositives) comments.push({ path: "\u0000", line: -1_000_000 });
  const score = scoreReview({ kcs: input.kcs, issues: input.issues, tolerance: 0, comments, contentScores });
  return { ...score, hits, missed, falsePositives };
}

export type LadderLevelOutcome = {
  status: "passed" | "failed" | "skipped";
  results: readonly TestResult[];
  /** Seconds spent on the level (overtime allowed). */
  elapsedSec: number;
  timeboxSec: number;
};

/**
 * Ladder: q = levels passed / levels; each KC's q from its
 * tagged tests. A level that passed after its timebox marks its KCs
 * `overtime` (Hard at best); KCs of failed or skipped levels are the
 * remediation targets.
 */
export function scoreLadderOutcomes(input: {
  kcs: readonly string[];
  levels: readonly { id: string; kcs: readonly string[]; testMeta: readonly { id: string; kcs: readonly string[] }[] }[];
  outcomes: Readonly<Record<string, LadderLevelOutcome>>;
}): Score & { levelsPassed: string[]; overtimeKcs: string[]; failedKcs: string[]; overtimeLevels: string[] } {
  const results: Record<string, readonly TestResult[]> = {};
  for (const level of input.levels) {
    const o = input.outcomes[level.id];
    results[level.id] = o && o.status !== "skipped" ? o.results : [];
  }
  const base = scoreLadder({ kcs: input.kcs, levels: input.levels, results });
  const passed = new Set(base.levelsPassed);
  const overtimeLevels = input.levels.filter((l) => passed.has(l.id) && (input.outcomes[l.id]?.elapsedSec ?? 0) > (input.outcomes[l.id]?.timeboxSec ?? Infinity)).map((l) => l.id);
  const failedKcs = new Set<string>();
  for (const level of input.levels) {
    if (passed.has(level.id)) continue;
    const r = new Map((results[level.id] ?? []).map((t) => [t.id, t.passed]));
    const failingTests = level.testMeta.filter((t) => r.get(t.id) !== true);
    for (const t of failingTests) t.kcs.forEach((kc) => failedKcs.add(kc));
    if (!failingTests.length) level.kcs.forEach((kc) => failedKcs.add(kc));
  }
  const overtimeKcs = new Set<string>();
  for (const id of overtimeLevels) input.levels.find((l) => l.id === id)?.kcs.forEach((kc) => { if (!failedKcs.has(kc)) overtimeKcs.add(kc); });
  return { ...base, overtimeKcs: [...overtimeKcs], failedKcs: [...failedKcs], overtimeLevels };
}

/** KCs whose q fell below the pass mark: what a remedial session should repair. */
export function weakKcs(score: Score, type: DojoItemType, rubricPassAt?: number): string[] {
  const bar = passThreshold(type, rubricPassAt) - EPS;
  return Object.entries(score.qByKc).filter(([, q]) => q < bar).sort((a, b) => a[1] - b[1]).map(([kc]) => kc);
}

// ---------------------------------------------------------------------------
// Signal assembly and validation
// ---------------------------------------------------------------------------

export function buildSignal(
  type: DojoItemType,
  score: Score,
  meta: Omit<OutcomeSignal, "q" | "qByKc" | "passed">,
  rubricPassAt?: number,
): OutcomeSignal {
  return {
    ...meta,
    q: clamp01(score.q),
    qByKc: Object.fromEntries(Object.entries(score.qByKc).map(([k, v]) => [k, clamp01(v)])),
    passed: isPass(type, score.q, meta.solutionRevealed, rubricPassAt),
  };
}

export type SanitizedSignal =
  | { ok: true; signal: OutcomeSignal }
  | { ok: false; field: string };

/**
 * Validate a reported signal against the item's index row: numbers
 * clamped, `qByKc` keys must be KCs of the item, `passed` recomputed.
 */
export function sanitizeSignal(raw: unknown, item: Pick<DojoItemIndexRow, "type" | "kcs">): SanitizedSignal {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return { ok: false, field: "signal" };
  const s = raw as Record<string, unknown>;
  if (typeof s.q !== "number" || !Number.isFinite(s.q)) return { ok: false, field: "signal.q" };
  const kcIds = new Set(item.kcs.map((k) => k.id));
  const qByKc: Record<string, number> = {};
  if (s.qByKc !== undefined) {
    if (!s.qByKc || typeof s.qByKc !== "object" || Array.isArray(s.qByKc)) return { ok: false, field: "signal.qByKc" };
    for (const [kc, v] of Object.entries(s.qByKc as Record<string, unknown>)) {
      if (!kcIds.has(kc) || typeof v !== "number" || !Number.isFinite(v)) return { ok: false, field: "signal.qByKc" };
      qByKc[kc] = clamp01(v);
    }
  }
  const latency = typeof s.latencyMs === "number" && Number.isFinite(s.latencyMs) ? s.latencyMs : NaN;
  if (!Number.isFinite(latency)) return { ok: false, field: "signal.latencyMs" };
  const count = (v: unknown) => (typeof v === "number" && Number.isFinite(v) ? Math.min(99, Math.max(0, Math.floor(v))) : 0);
  const solutionRevealed = s.solutionRevealed === true;
  const q = clamp01(s.q);
  let overtimeKcs: string[] | undefined;
  if (s.overtimeKcs !== undefined) {
    if (!Array.isArray(s.overtimeKcs) || s.overtimeKcs.some((kc) => typeof kc !== "string" || !kcIds.has(kc))) {
      return { ok: false, field: "signal.overtimeKcs" };
    }
    overtimeKcs = [...new Set(s.overtimeKcs as string[])];
  }
  let judge: OutcomeSignal["judge"];
  if (s.judge !== undefined) {
    const j = s.judge as Record<string, unknown> | null;
    if (!j || typeof j !== "object" || (j.by !== "ai" && j.by !== "self")) return { ok: false, field: "signal.judge" };
    const ug = j.userGrade;
    if (ug !== undefined && ug !== 1 && ug !== 2 && ug !== 3 && ug !== 4) return { ok: false, field: "signal.judge.userGrade" };
    judge = { by: j.by, ...(ug !== undefined ? { userGrade: ug as Grade } : {}) };
  }
  return {
    ok: true,
    signal: {
      q,
      qByKc,
      latencyMs: Math.round(Math.min(MAX_LATENCY_MS, Math.max(0, latency))),
      hintsUsed: count(s.hintsUsed),
      aiHintsUsed: count(s.aiHintsUsed),
      solutionRevealed,
      firstTry: s.firstTry !== false,
      passed: isPass(item.type, q, solutionRevealed),
      ...(overtimeKcs?.length ? { overtimeKcs } : {}),
      ...(judge ? { judge } : {}),
    },
  };
}

function clamp01(v: number) {
  return Number.isFinite(v) ? Math.min(1, Math.max(0, v)) : 0;
}

function mean(values: readonly number[]) {
  return values.length ? values.reduce((a, b) => a + b, 0) / values.length : 0;
}

function averaged(perKc: Map<string, number[]>) {
  const out: Record<string, number> = {};
  for (const [kc, vals] of perKc) out[kc] = clamp01(mean(vals));
  return out;
}

// --- rubric-judged answers (explain, case stages, choose-design rationale) ---

/**
 * Score from criterion verdicts (AI judge or self-check): q is the weighted
 * share of criteria met; each KC scores the share of its own criteria. Item
 * KCs that no criterion names take the overall q.
 */
export function scoreJudged(rubric: Rubric, verdicts: readonly CriterionVerdict[], kcs: readonly string[]): Score {
  const q = rubricQ(rubric, verdicts);
  const byKc = rubricQByKc(rubric, verdicts);
  return { q, qByKc: Object.fromEntries(kcs.map((kc) => [kc, byKc[kc] ?? q])) };
}

/**
 * A staged case: every stage's rubric folded into one, each stage weighted
 * by `stage.weight` (default 1) regardless of how many criteria it has.
 * Stages not yet judged count as not met.
 */
export function caseRubric(item: CaseItem): Rubric {
  const criteria = item.stages.flatMap((stage) => {
    const total = stage.rubric.criteria.reduce((sum, c) => sum + c.weight, 0) || 1;
    const w = stage.weight ?? 1;
    return stage.rubric.criteria.map((c) => ({ ...c, id: `${stage.id}:${c.id}`, weight: (c.weight / total) * w }));
  });
  const passAt = item.stages.reduce((sum, s) => sum + s.rubric.passAt * (s.weight ?? 1), 0) /
    Math.max(1e-9, item.stages.reduce((sum, s) => sum + (s.weight ?? 1), 0));
  return { criteria, passAt };
}

export function scoreCase(item: CaseItem, stageVerdicts: Readonly<Record<string, readonly CriterionVerdict[]>>): Score {
  const verdicts = item.stages.flatMap((stage) => (stageVerdicts[stage.id] ?? []).map((v) => ({ ...v, id: `${stage.id}:${v.id}` })));
  return scoreJudged(caseRubric(item), verdicts, item.kcs.map((k) => k.id));
}

/** The grade offered first: never above Good (only the learner picks Easy). */
export function suggestedGrade(q: number, passAt: number): Grade {
  if (q < passAt - EPS) return 1;
  return q >= 0.9 ? 3 : 2;
}
