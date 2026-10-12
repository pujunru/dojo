/**
 * Answer lifecycle per item type: the empty answer, when Check is allowed, the
 * static score, and — for items that execute — the sandbox job and the score
 * from its result. Scoring is `core/grading.ts`; this file only
 * adapts each item view's answer shape to the scorer's input.
 */
import type { DojoItem, L10n, Rubric } from "../core/content-schema";
import {
  caseRubric,
  isPass,
  PARSONS_PARTIAL_MAX,
  scoreChooseDesign,
  scoreFillBlank,
  scoreParsons,
  scorePredict,
  scoreSelfGrade,
  scoreSpotBug,
  scoreLadderOutcomes,
  scoreRefactor,
  scoreReviewFindings,
  scoreTests,
  scoreWriteTestsRun,
  uniformScore,
  type LadderLevelOutcome,
  type Score,
} from "../core/grading";
import type { Grade } from "../core/learner-model";
import { allPassed, type PyFile, type RunJob, type RunResult } from "../core/run-protocol";
import {
  emptyChooseDesignAnswer,
  emptyLadderAnswer,
  emptyRefactorAnswer,
  emptyReviewAnswer,
  emptyWriteTestsAnswer,
  isLadderAnswerComplete,
  isRefactorAnswerComplete,
  isReviewAnswerComplete,
  isWriteTestsAnswerComplete,
  type LadderAnswer,
  type RefactorAnswer,
  type ReviewAnswer,
  type WriteTestsAnswer,
  emptyCaseAnswer,
  emptyExplainAnswer,
  emptyFillBlankAnswer,
  emptyImplementAnswer,
  emptyParsonsAnswer,
  emptyPredictAnswer,
  emptySpotBugAnswer,
  fillBlankFiles,
  fillBlankValues,
  isChooseDesignAnswerComplete,
  isCaseAnswerComplete,
  isExplainAnswerComplete,
  isFillBlankAnswerComplete,
  isImplementAnswerComplete,
  isParsonsAnswerComplete,
  isPredictAnswerComplete,
  isSpotBugAnswerComplete,
  parsonsOrder,
  type CaseAnswer,
  type ChooseDesignAnswer,
  type ExplainAnswer,
  type FillBlankAnswer,
  type ImplementAnswer,
  type ItemVerdict,
  type ParsonsAnswer,
  type PredictAnswer,
  type SpotBugAnswer,
} from "../features";

/** Item types this player renders. Others never reach it (the composer does not schedule them). */
export const PLAYABLE_TYPES = new Set(["predict", "spot-bug", "fill-blank", "parsons", "choose-design", "implement", "explain", "refactor", "write-tests", "review", "ladder", "case"]);

/** Types whose Check runs code; runs are unlimited until every test passes (or the learner gives up). */
export const RUN_TYPES = new Set(["implement", "refactor", "write-tests"]);

const kcIds = (item: DojoItem) => item.kcs.map((kc) => kc.id);

/** Stable small seed from the item id, so a reload shuffles parsons the same way. */
export function seedOf(text: string) {
  let h = 2166136261;
  for (let i = 0; i < text.length; i += 1) h = Math.imul(h ^ text.charCodeAt(i), 16777619);
  return (h >>> 0) || 1;
}

export function emptyAnswerFor(item: DojoItem): unknown {
  switch (item.type) {
    case "predict": return emptyPredictAnswer();
    case "spot-bug": return emptySpotBugAnswer();
    case "fill-blank": return emptyFillBlankAnswer(item);
    case "parsons": return emptyParsonsAnswer(item, seedOf(item.id));
    case "choose-design": return emptyChooseDesignAnswer();
    case "implement": return emptyImplementAnswer(item);
    case "explain": return emptyExplainAnswer();
    case "refactor": return emptyRefactorAnswer(item);
    case "write-tests": return emptyWriteTestsAnswer(item);
    case "review": return emptyReviewAnswer();
    case "ladder": return emptyLadderAnswer(item);
    case "case": return emptyCaseAnswer();
    default: return null;
  }
}

export function isAnswerComplete(item: DojoItem, answer: unknown): boolean {
  switch (item.type) {
    case "predict": return isPredictAnswerComplete(item, answer as PredictAnswer);
    case "spot-bug": return isSpotBugAnswerComplete(answer as SpotBugAnswer);
    case "fill-blank": return isFillBlankAnswerComplete(answer as FillBlankAnswer);
    case "parsons": return isParsonsAnswerComplete(answer as ParsonsAnswer);
    case "choose-design": return isChooseDesignAnswerComplete(answer as ChooseDesignAnswer);
    case "implement": return isImplementAnswerComplete(item, answer as ImplementAnswer);
    case "explain": return isExplainAnswerComplete(answer as ExplainAnswer);
    case "refactor": return isRefactorAnswerComplete(item, answer as RefactorAnswer);
    case "write-tests": return isWriteTestsAnswerComplete(item, answer as WriteTestsAnswer);
    case "review": return isReviewAnswerComplete(answer as ReviewAnswer);
    case "ladder": return isLadderAnswerComplete(item, answer as LadderAnswer);
    case "case": return isCaseAnswerComplete(item, answer as CaseAnswer);
    default: return false;
  }
}

/** Score without executing anything; null for items whose score needs a run (implement) or a self-grade (explain). */
export function staticScore(item: DojoItem, answer: unknown): Score | null {
  const kcs = kcIds(item);
  switch (item.type) {
    case "predict": {
      const expected = item.answer.mode === "choice" ? { mode: "choice" as const, correct: item.answer.correct } : item.answer;
      return scorePredict({ kcs, expected, answer: answer as PredictAnswer });
    }
    case "spot-bug":
      return scoreSpotBug({ kcs, bugs: item.bugs, tolerance: item.tolerance, selected: (answer as SpotBugAnswer).selected });
    case "fill-blank":
      return scoreFillBlank({ blanks: item.blanks, answers: fillBlankValues(answer as FillBlankAnswer) });
    case "parsons": {
      const score = scoreParsons({ kcs, solutions: item.solutions, order: parsonsOrder(answer as ParsonsAnswer) });
      if (!item.requireIndent) return score;
      // The order scorer ignores indentation; an item that asks for it (and
      // whose reveal marks wrong indents) must not pass with them wrong.
      const placed = (answer as ParsonsAnswer).items;
      const indentOk = placed.length
        ? placed.filter((line) => item.lines.find((l) => l.id === line.id)?.indent === (line.indent ?? 0)).length / placed.length
        : 0;
      return indentOk >= 1 ? score : uniformScore(Math.min(score.q, PARSONS_PARTIAL_MAX * indentOk), kcs);
    }
    case "choose-design":
      return scoreChooseDesign({ kcs, options: item.options, selected: (answer as ChooseDesignAnswer).selected });
    case "review":
      return reviewDetail(item, answer as ReviewAnswer);
    default:
      return null;
  }
}

/** Assembles the parsons answer into the module its tests import. */
export function parsonsProgram(answer: ParsonsAnswer) {
  return `${answer.items.map((line) => `${"    ".repeat(Math.max(0, line.indent ?? 0))}${line.code}`).join("\n")}\n`;
}

/**
 * The sandbox job for an answer, or null when nothing runs. Implement always
 * runs its hidden tests; fill-blank and parsons run theirs only as a second
 * chance for an answer the static check did not accept (an equivalent spelling
 * or order).
 */
export function runJobFor(item: DojoItem, answer: unknown): RunJob | null {
  switch (item.type) {
    case "implement":
    case "refactor":
      return { kind: "tests", files: (answer as ImplementAnswer).files, tests: item.tests, options: item.options };
    case "write-tests":
      return { kind: "mutants", files: item.subject, tests: (answer as WriteTestsAnswer).tests, mutants: item.mutants.map((m) => ({ id: m.id, files: m.files })), options: item.options };
    case "ladder": {
      const a = answer as LadderAnswer;
      const level = item.levels[Math.min(a.current, item.levels.length - 1)];
      return { kind: "tests", files: a.files, tests: level.tests, options: item.options };
    }
    case "fill-blank":
      return item.tests ? { kind: "tests", files: fillBlankFiles(answer as FillBlankAnswer), tests: item.tests.tests, options: item.tests.options } : null;
    case "parsons":
      if (!item.tests || !item.module) return null;
      return {
        kind: "tests",
        files: [{ path: item.module, content: parsonsProgram(answer as ParsonsAnswer) } satisfies PyFile],
        tests: item.tests.tests,
        options: item.tests.options,
      };
    default:
      return null;
  }
}

/**
 * Implement items carry hidden tests and, optionally, visible tests in a
 * second file; `testMeta` lists both, so both run (one job each, since a job
 * takes one test module) and their outcomes are merged into one result.
 */
export function implementJobs(item: DojoItem, answer: unknown): RunJob[] {
  const main = runJobFor(item, answer);
  if (!main || main.kind !== "tests" || (item.type !== "implement" && item.type !== "refactor") || !item.visibleTests) return main ? [main] : [];
  return [main, { ...main, tests: item.visibleTests }];
}

export function mergeRunResults(results: readonly RunResult[]): RunResult {
  const failed = results.find((result) => result.status !== "ok");
  if (failed || results.length === 1) return failed ?? results[0];
  const oks = results as Extract<RunResult, { status: "ok" }>[];
  return {
    status: "ok",
    passed: oks.reduce((sum, r) => sum + r.passed, 0),
    total: oks.reduce((sum, r) => sum + r.total, 0),
    results: oks.flatMap((r) => r.results),
    stdout: oks.map((r) => r.stdout).filter(Boolean).join("\n"),
    stderr: oks.map((r) => r.stderr).filter(Boolean).join("\n"),
    runtime: oks[0].runtime,
    ms: oks.reduce((sum, r) => sum + r.ms, 0),
  };
}

/** A run that says nothing about the learner's code: the runtime or harness failed. */
export function isInfrastructureFailure(result: RunResult) {
  return result.status === "runtime_unavailable" || result.status === "harness_error";
}

/** Score from a finished run (implement), or the static score upgraded by green tests. */
export function scoreFromRun(item: DojoItem, answer: unknown, result: RunResult): Score {
  const kcs = kcIds(item);
  if (item.type === "implement") {
    const results = result.status === "ok" ? result.results.map((outcome) => ({ id: outcome.id, passed: outcome.ok })) : [];
    return scoreTests({ kcs, testMeta: item.testMeta, results });
  }
  if (item.type === "refactor") {
    const results = result.status === "ok" ? result.results.map((outcome) => ({ id: outcome.id, passed: outcome.ok })) : [];
    return scoreRefactor({ kcs, testMeta: item.testMeta, results });
  }
  if (item.type === "write-tests") {
    return scoreWriteTestsRun({ kcs, mutants: item.mutants, killTarget: item.killTarget, run: result });
  }
  if (item.type === "fill-blank") {
    return scoreFillBlank({ blanks: item.blanks, answers: fillBlankValues(answer as FillBlankAnswer), testsPassed: allPassed(result) });
  }
  if (item.type === "parsons") {
    return scoreParsons({ kcs, solutions: item.solutions, order: parsonsOrder(answer as ParsonsAnswer), testsPassed: allPassed(result) });
  }
  return staticScore(item, answer) ?? { q: 0, qByKc: {} };
}

export function selfGradeScore(item: DojoItem, grade: Grade): Score {
  return scoreSelfGrade(grade, kcIds(item));
}

/** Review breakdown (hits / misses / false positives) for an answer. */
export function reviewDetail(item: Extract<DojoItem, { type: "review" }>, answer: ReviewAnswer) {
  return scoreReviewFindings({ kcs: kcIds(item), issues: item.issues, tolerance: item.tolerance, findings: answer.findings });
}

/** Ladder: did the current level's run pass every one of its tests? */
export function ladderLevelPassed(item: Extract<DojoItem, { type: "ladder" }>, level: number, result: RunResult) {
  const meta = item.levels[level]?.testMeta ?? [];
  if (result.status !== "ok") return false;
  const ok = new Set(result.results.filter((outcome) => outcome.ok).map((outcome) => outcome.id));
  return meta.length > 0 && meta.every((t) => ok.has(t.id));
}

/** Final ladder score from the per-level records. */
export function ladderScore(item: Extract<DojoItem, { type: "ladder" }>, answer: LadderAnswer) {
  const outcomes: Record<string, LadderLevelOutcome> = {};
  for (const level of item.levels) {
    const rec = answer.levels[level.id];
    const result = rec?.result;
    outcomes[level.id] = {
      status: rec?.status === "passed" ? "passed" : rec?.status === "skipped" || rec?.status === "locked" ? "skipped" : "failed",
      results: result && result.status === "ok" ? result.results.map((outcome) => ({ id: outcome.id, passed: outcome.ok })) : [],
      elapsedSec: rec?.elapsedSec ?? 0,
      timeboxSec: level.timeboxMin * 60,
    };
  }
  return scoreLadderOutcomes({ kcs: kcIds(item), levels: item.levels, outcomes });
}

export function rubricPassAt(item: DojoItem) {
  if (item.type === "explain") return item.rubric.passAt;
  if (item.type === "case") return caseRubric(item).passAt;
  return undefined;
}

/** One rubric of an item that is judged (AI or self-check). */
export type JudgedPart = { part: string; rubric: Rubric; question: L10n; modelAnswer: L10n };

/**
 * The judged rubrics of an item, in order: explain's rubric ("main"), a
 * choose-design rationale ("rationale"), or a case's stages (by stage id).
 */
export function judgedParts(item: DojoItem): JudgedPart[] {
  if (item.type === "explain") return [{ part: "main", rubric: item.rubric, question: item.question, modelAnswer: item.modelAnswer }];
  if (item.type === "case") return item.stages.map((st) => ({ part: st.id, rubric: st.rubric, question: st.question, modelAnswer: st.modelAnswer }));
  if (item.type === "choose-design" && item.rationale) {
    const why = item.options.filter((o) => o.correct)[0]?.why ?? item.explanation;
    return [{ part: "rationale", rubric: item.rationale, question: item.scenario, modelAnswer: why }];
  }
  return [];
}

export function verdictFor(item: DojoItem, q: number): ItemVerdict {
  if (isPass(item.type, q, false, rubricPassAt(item))) return "correct";
  return q > 0 ? "partial" : "incorrect";
}
