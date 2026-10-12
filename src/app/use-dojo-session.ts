"use client";

/**
 * The session runner: compose → start → per-item answer / check / feedback →
 * requeue misses → write attempts → finish → summary.
 *
 * Composition happens here (`composeSession`); the store records the
 * plan, each attempt and the finish. Attempts go through the queue in
 * `api.ts`; the session is finished only once every attempt of it is saved,
 * because the store refuses attempts for a closed session.
 */
import * as React from "react";
import { primaryKc, RUNG_OF, type DojoItem, type DojoItemIndexRow, type DojoManifest } from "../core/content-schema";
import { applyForbidden, isForbiddenCriterion } from "../core/rubric";
import {
  checkpointLadderFor,
  composeSession,
  requeueMissed,
  singleItemPlan,
  type ComposeInput,
  type ItemState,
  type PlannedItem,
  type SessionKind,
} from "../core/composer";
import type { DojoSession, DojoSessionKind, DojoStateResponse, DojoToday, FinishSessionResponse, KcUpdateView } from "../core/contract";
import { deviceLocalDay, itemXp } from "../core/gamification";
import { buildSignal, scoreCase, scoreChooseDesign, scoreJudged, scoreSelfGrade, weakKcs, type OutcomeSignal, type Score } from "../core/grading";
import type { Grade, KcState } from "../core/learner-model";
import type { RunResult } from "../core/run-protocol";
import type { CaseAnswer, CodeRunState, ItemReveal, JudgedCriterion, LadderAnswer } from "../features";
import { openSessionFor, resumableSession } from "./resume";
import { finishDojoSession, getAttemptQueue, loadUnit, newDojoId, startDojoSession, DojoApiError } from "./api";
import {
  emptyAnswerFor,
  isAnswerComplete,
  implementJobs,
  isInfrastructureFailure,
  judgedParts,
  ladderLevelPassed,
  ladderScore,
  RUN_TYPES,
  mergeRunResults,
  rubricPassAt,
  runJobFor,
  scoreFromRun,
  selfGradeScore,
  staticScore,
  verdictFor,
} from "./grade";
import type { DojoGraphs } from "./model";
import { buildRuntimes, hasRunner, runCode } from "./runtimes";
import type { SchedulerParams } from "../core/series";

/** One self-checked part of an item: the verdicts, and whether the learner ticked any. */
export type JudgePartState = { verdicts: Record<string, JudgedCriterion>; touched: boolean };

export type ItemProgress = {
  answer: unknown;
  shownAt: number;
  firstCheckAt: number | null;
  answeredAt: number | null;
  hintsShown: number;
  hintOpen: boolean;
  runs: number;
  run: CodeRunState;
  /** A run or check failed before the final answer: the grade caps at Hard. */
  missedOnce: boolean;
  /** Explain: the learner is grading themselves against the model answer. */
  selfGrading: boolean;
  /** Rubric verdicts per judged part ("main", "rationale", or a case stage id). */
  judge: Record<string, JudgePartState>;
  /** Choose-design with a rationale: the choice's score, held while the rationale is judged. */
  pendingScore?: Score | null;
  selfGrade: Grade | null;
  reveal: ItemReveal | null;
  xp: number;
  passed: boolean;
  /** Ladder: when the current level's clock started (ms). */
  levelStartedAt: number;
};

/** `weakKcs`: KCs that scored below the pass mark (failed levels, surviving mutants, missed issues). */
export type SessionResult = { itemId: string; kcId: string; passed: boolean; q: number; xp: number; weakKcs: string[] };

export type DojoSessionRun = {
  id: string;
  kind: DojoSessionKind;
  unitId: string | null;
  lessonId: string | null;
  contentHash: string;
  plan: PlannedItem[];
  index: number;
  items: Record<string, DojoItem>;
  progress: Record<string, ItemProgress>;
  results: SessionResult[];
  /** First and last KC update seen this session, per KC. */
  kcUpdates: Record<string, { first: KcUpdateView; last: KcUpdateView }>;
  phase: "playing" | "finishing" | "summary";
  finishError: string | null;
  summary: FinishSessionResponse | null;
  /** Answer-time seconds, summed per item. */
  activeSec: number;
};

export type StartOptions = {
  /** `checkpoint`: the unit's boss ladder alone (not composed). `simulation`: one timed case, `itemId`. */
  kind: SessionKind | "checkpoint" | "simulation";
  itemId?: string;
  lessonId?: string;
  unitId?: string;
  kcIds?: readonly string[];
  /** Continue an unfinished session from the learner's state. */
  resume?: DojoSession;
  /** Compose anew even if an unfinished session for the same target exists. */
  fresh?: boolean;
};


type Deps = {
  manifest: DojoManifest | null;
  graphs: DojoGraphs | null;
  state: DojoStateResponse | null;
  locale: string;
  /** The store's newest numbers for today (after each attempt). */
  onToday: (today: DojoToday) => void;
  /** A stale open session was closed in the store: refetch the learner state. */
  onSessionClosed?: () => void;
};

/** `isShortRef` in the API contract. */
const SERVER_REF = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,99}$/;
const COMPOSER_KINDS: readonly SessionKind[] = ["lesson", "daily", "practice", "review", "remedial"];
/** One item's answer time counts at most this long toward the session's active time. */
const MAX_ITEM_ACTIVE_SEC = 15 * 60;

function freshProgress(item: DojoItem): ItemProgress {
  return {
    answer: emptyAnswerFor(item),
    shownAt: Date.now(),
    firstCheckAt: null,
    answeredAt: null,
    hintsShown: 0,
    hintOpen: false,
    runs: 0,
    run: { state: "idle" },
    missedOnce: false,
    selfGrading: false,
    judge: {},
    selfGrade: null,
    reveal: null,
    xp: 0,
    passed: false,
    levelStartedAt: Date.now(),
  };
}

export function composeInputFor(
  deps: Pick<Deps, "graphs" | "state">,
  kind: SessionKind,
  extra: Partial<ComposeInput> = {},
): ComposeInput | null {
  const { graphs, state } = deps;
  if (!graphs || !state) return null;
  return {
    kind,
    graph: graphs.compose,
    items: graphs.rows,
    kc: new Map<string, KcState>(state.kcs.map((kc) => [kc.kcId, kc])),
    itemState: new Map<string, ItemState>(state.items.map((it) => [it.itemId, it])),
    runtimeAvailability: buildRuntimes(),
    scheduler: graphs.scheduler,
    now: new Date(),
    seed: Math.floor(Math.random() * 2 ** 31),
    minutes: state.profile.sessionMinutes,
    lastSessionAccuracy: state.lastSessionAccuracy,
    ...extra,
  };
}

function plannedFromSession(session: DojoSession, rows: ReadonlyMap<string, DojoItemIndexRow>, rungOf?: SchedulerParams["rungOf"]): PlannedItem[] {
  return session.planned.slice(session.itemsDone).flatMap((entry) => {
    const row = rows.get(entry.itemId);
    if (!row) return [];
    return [{ itemId: entry.itemId, kcId: entry.kcId, reason: entry.reason, targetRung: (rungOf ?? RUNG_OF)[row.type], pPred: 0.5, substituted: false, estSeconds: row.estSeconds }];
  });
}

export function useDojoSession(deps: Deps) {
  const [run, setRun] = React.useState<DojoSessionRun | null>(null);
  const [busy, setBusy] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);
  const runRef = React.useRef<DojoSessionRun | null>(null);
  const depsRef = React.useRef(deps);
  depsRef.current = deps;
  const composeRef = React.useRef<ComposeInput | null>(null);

  /** Synchronous against the ref, so async steps always see the latest run. */
  const update = React.useCallback((fn: (current: DojoSessionRun) => DojoSessionRun, sessionId?: string) => {
    const current = runRef.current;
    if (!current || (sessionId && current.id !== sessionId)) return;
    const next = fn(current);
    runRef.current = next;
    setRun(next);
  }, []);

  const updateItem = React.useCallback((itemId: string, fn: (p: ItemProgress) => ItemProgress) => {
    update((current) => {
      const p = current.progress[itemId];
      return p ? { ...current, progress: { ...current.progress, [itemId]: fn(p) } } : current;
    });
  }, [update]);

  const rowsById = React.useMemo(
    () => new Map((deps.graphs?.rows ?? []).map((row) => [row.id, row])),
    [deps.graphs],
  );

  /** Loads the bundles the plan needs (and seeds the progress of any new items). */
  const ensureItems = React.useCallback(async (plan: readonly PlannedItem[], contentHash: string, have: Record<string, DojoItem>) => {
    const units = new Set<string>();
    for (const entry of plan) {
      if (have[entry.itemId]) continue;
      const row = rowsById.get(entry.itemId);
      if (row) units.add(row.unit);
    }
    const found: Record<string, DojoItem> = {};
    for (const items of await Promise.all([...units].map((unit) => loadUnit(contentHash, unit)))) {
      for (const item of items) if (plan.some((entry) => entry.itemId === item.id)) found[item.id] = item;
    }
    return found;
  }, [rowsById]);

  /**
   * Closes a session the store still lists as open but that has nothing left
   * to play: every planned item answered (the app was closed before the
   * summary), or every remaining item gone from the current content. Left
   * open, it would be "resumed" on every start and always come back empty.
   */
  const closeSpentSession = React.useCallback(async (session: DojoSession) => {
    const summary = await finishDojoSession({
      id: session.id,
      patch: { finishedAt: new Date().toISOString(), activeSec: 0, abandoned: session.itemsDone === 0 },
      localDay: deviceLocalDay(),
    });
    depsRef.current.onToday(summary.today);
    depsRef.current.onSessionClosed?.();
  }, []);

  const start = React.useCallback(async (options: StartOptions): Promise<"started" | "empty" | "error"> => {
    const { manifest, state, graphs } = depsRef.current;
    if (!manifest || !state || !graphs) return "error";
    setBusy(true);
    setError(null);
    try {
      const resume = options.resume ?? (options.fresh ? null : resumableSession(openSessionFor(state, graphs.series.id), options, deviceLocalDay()));
      const checkpoint = options.kind === "checkpoint" || resume?.kind === "checkpoint";
      const simulation = options.kind === "simulation" || resume?.kind === "simulation";
      const kind: SessionKind = resume
        ? (COMPOSER_KINDS as readonly string[]).includes(resume.kind) ? resume.kind as SessionKind : "daily"
        : options.kind === "checkpoint" || options.kind === "simulation" ? "practice" : options.kind;
      const input = composeInputFor(depsRef.current, kind, {
        lessonId: resume?.lessonId ?? options.lessonId,
        unitId: resume?.unitId ?? options.unitId,
        kcIds: options.kcIds,
      });
      if (!input) return "error";
      composeRef.current = input;
      let planned: PlannedItem[];
      if (resume) planned = plannedFromSession(resume, rowsById, graphs.scheduler.rungOf);
      else if (checkpoint) {
        const ladder = options.unitId ? checkpointLadderFor(options.unitId, graphs.rows, input.runtimeAvailability) : null;
        planned = ladder ? singleItemPlan(ladder, input.kc, input.now) : [];
      } else if (simulation) {
        const row = options.itemId ? rowsById.get(options.itemId) : undefined;
        planned = row ? singleItemPlan(row, input.kc, input.now) : [];
      } else planned = composeSession(input);
      const sessionKind: DojoSessionKind = checkpoint ? "checkpoint" : simulation ? "simulation" : kind;
      const loaded = await ensureItems(planned, manifest.contentHash, {});
      // An item the bundle lacks (content changed under an open session) is dropped.
      const plan = planned.filter((entry) => loaded[entry.itemId]);
      if (!plan.length && resume) {
        await closeSpentSession(resume);
        setBusy(false);
        // Compose what the learner asked for (the button's kind), not the
        // spent session's kind: a closed remedial session must not turn a
        // daily start into an empty remedial one.
        return startRef.current({ ...options, resume: undefined, fresh: true });
      }
      if (!plan.length) return "empty";
      const id = resume?.id ?? newDojoId("djs");
      const localDay = deviceLocalDay();
      if (!resume) {
        await startDojoSession({
          id,
          kind: sessionKind,
          series: graphs.series.id,
          // Session refs are curriculum ids only.
          ...(options.unitId && SERVER_REF.test(options.unitId) ? { unitId: options.unitId } : {}),
          ...(options.lessonId && SERVER_REF.test(options.lessonId) ? { lessonId: options.lessonId } : {}),
          planned: plan.map((entry) => ({ itemId: entry.itemId, reason: entry.reason, kcId: entry.kcId })),
          contentHash: manifest.contentHash,
          localDay,
        });
      }
      const first = loaded[plan[0].itemId];
      const next: DojoSessionRun = {
        id,
        kind: sessionKind,
        unitId: resume?.unitId ?? options.unitId ?? null,
        lessonId: resume?.lessonId ?? options.lessonId ?? null,
        contentHash: manifest.contentHash,
        plan,
        index: 0,
        items: loaded,
        progress: { [first.id]: freshProgress(first) },
        results: [],
        kcUpdates: {},
        phase: "playing",
        finishError: null,
        summary: null,
        activeSec: 0,
      };
      runRef.current = next;
      setRun(next);
      return "started";
    } catch (cause) {
      setError(cause instanceof DojoApiError ? cause.code : "UNKNOWN");
      return "error";
    } finally {
      setBusy(false);
    }
  }, [ensureItems, rowsById, closeSpentSession]);
  const startRef = React.useRef(start);
  startRef.current = start;

  const current = run && run.phase === "playing" ? run.items[run.plan[run.index]?.itemId ?? ""] ?? null : null;

  const setAnswer = React.useCallback((answer: unknown) => {
    const r = runRef.current;
    const itemId = r?.plan[r.index]?.itemId;
    if (itemId) updateItem(itemId, (p) => (p.reveal ? p : { ...p, answer }));
  }, [updateItem]);

  const toggleHint = React.useCallback(() => {
    const r = runRef.current;
    const itemId = r?.plan[r.index]?.itemId;
    if (itemId) updateItem(itemId, (p) => ({ ...p, hintOpen: !p.hintOpen, hintsShown: Math.max(1, p.hintsShown) }));
  }, [updateItem]);

  const nextHint = React.useCallback(() => {
    const r = runRef.current;
    const itemId = r?.plan[r.index]?.itemId;
    const item = itemId ? r?.items[itemId] : null;
    if (itemId && item) updateItem(itemId, (p) => ({ ...p, hintsShown: Math.min(item.hints.length, p.hintsShown + 1) }));
  }, [updateItem]);

  /** Locks the answer, records the attempt, and requeues a miss. */
  const finalize = React.useCallback((item: DojoItem, score: Score, runtime: "none" | "runner", extra: { latencyMs?: number; overtimeKcs?: string[]; solutionRevealed?: boolean; judge?: OutcomeSignal["judge"] } = {}) => {
    const r = runRef.current;
    const p = r?.progress[item.id];
    if (!r || !p || p.reveal) return;
    const now = Date.now();
    const firstCheckAt = p.firstCheckAt ?? now;
    const signal = buildSignal(item.type, score, {
      latencyMs: extra.latencyMs ?? Math.max(0, firstCheckAt - p.shownAt),
      ...(extra.overtimeKcs?.length ? { overtimeKcs: extra.overtimeKcs } : {}),
      hintsUsed: p.hintsShown,
      aiHintsUsed: 0,
      solutionRevealed: extra.solutionRevealed === true,
      firstTry: !p.missedOnce,
      ...(extra.judge ? { judge: extra.judge } : {}),
    }, rubricPassAt(item));
    const xp = itemXp(item.type, signal.q, signal.solutionRevealed);
    const reveal: ItemReveal = { verdict: verdictFor(item, signal.q), q: signal.q };
    const entry = r.plan[r.index];
    const answeredAt = new Date(now).toISOString();
    const activeSec = Math.min(MAX_ITEM_ACTIVE_SEC, Math.max(0, (now - p.shownAt) / 1000));

    let plan = r.plan;
    // A ladder or a staged case is not requeued: its failed KCs go to the remedial
    // pack instead; checkpoints and simulations are single timed rounds.
    if (!signal.passed && composeRef.current && item.type !== "ladder" && item.type !== "case" && r.kind !== "checkpoint" && r.kind !== "simulation") plan = requeueMissed(composeRef.current, r.plan, item.id);

    update((cur) => ({
      ...cur,
      plan,
      activeSec: cur.activeSec + activeSec,
      results: [...cur.results, { itemId: item.id, kcId: entry?.kcId ?? primaryKc(item), passed: signal.passed, q: signal.q, xp, weakKcs: weakKcs(signal, item.type, rubricPassAt(item)) }],
      progress: { ...cur.progress, [item.id]: { ...(cur.progress[item.id] ?? p), firstCheckAt, answeredAt: now, reveal, xp, passed: signal.passed } },
    }));

    if (plan.length > r.plan.length) {
      void ensureItems(plan, r.contentHash, r.items).then((found) => {
        if (Object.keys(found).length) update((cur) => ({ ...cur, items: { ...cur.items, ...found } }), r.id);
      });
    }

    const { locale, onToday } = depsRef.current;
    void getAttemptQueue().enqueue({
      id: newDojoId("dja"),
      sessionId: r.id,
      itemId: item.id,
      itemVersion: item.version,
      contentHash: r.contentHash,
      runtime,
      startedAt: new Date(p.shownAt).toISOString(),
      answeredAt,
      localDay: deviceLocalDay(),
      locale,
      signal,
      answer: p.answer,
    }).then((outcome) => {
      if (!outcome.ok) return;
      onToday(outcome.response.today);
      update((cur) => {
        const kcUpdates = { ...cur.kcUpdates };
        for (const u of outcome.response.kcUpdates) {
          kcUpdates[u.kcId] = { first: kcUpdates[u.kcId]?.first ?? u, last: u };
        }
        return { ...cur, kcUpdates };
      }, r.id);
    });
  }, [ensureItems, update]);

  /** Closes the ladder once every level is resolved (passed or skipped). */
  const finishLadder = React.useCallback((item: Extract<DojoItem, { type: "ladder" }>, answer: LadderAnswer) => {
    const score = ladderScore(item, answer);
    const latencyMs = Object.values(answer.levels).reduce((sum, rec) => sum + rec.elapsedSec, 0) * 1000;
    finalize(item, score, "runner", { latencyMs, overtimeKcs: score.overtimeKcs });
  }, [finalize]);

  /** Resolves the current level and opens the next one (or finishes). */
  const resolveLevel = React.useCallback((item: Extract<DojoItem, { type: "ladder" }>, status: "passed" | "skipped", result: RunResult | null) => {
    const r = runRef.current;
    const p = r?.progress[item.id];
    if (!p) return;
    const now = Date.now();
    const a = p.answer as LadderAnswer;
    const level = item.levels[a.current];
    if (!level) return;
    const rec = a.levels[level.id];
    const levels = {
      ...a.levels,
      [level.id]: { ...rec, status, elapsedSec: rec.elapsedSec + Math.max(0, (now - p.levelStartedAt) / 1000), result: result ?? rec.result ?? null },
    };
    const nextIndex = a.current + 1;
    const nextLevel = item.levels[nextIndex];
    if (nextLevel) levels[nextLevel.id] = { ...levels[nextLevel.id], status: "active" };
    const answer: LadderAnswer = { ...a, current: nextIndex, levels };
    updateItem(item.id, (cur) => ({ ...cur, answer, levelStartedAt: now, run: { state: "idle" } }));
    if (!nextLevel) finishLadder(item, answer);
  }, [finishLadder, updateItem]);

  /** Runs the current ladder level's tests in the sandbox. */
  const checkLadderLevel = React.useCallback(async (item: Extract<DojoItem, { type: "ladder" }>, p: ItemProgress) => {
    const job = hasRunner() ? runJobFor(item, p.answer) : null;
    if (!job) return;
    updateItem(item.id, (cur) => ({ ...cur, run: { state: "running" } }));
    const result = await runCode(job);
    updateItem(item.id, (cur) => ({ ...cur, run: { state: "done", result } }));
    if (isInfrastructureFailure(result)) return;
    const a = (runRef.current?.progress[item.id]?.answer ?? p.answer) as LadderAnswer;
    if (ladderLevelPassed(item, a.current, result)) {
      resolveLevel(item, "passed", result);
      return;
    }
    const level = item.levels[a.current];
    updateItem(item.id, (cur) => {
      const ans = cur.answer as LadderAnswer;
      const rec = ans.levels[level.id];
      return { ...cur, missedOnce: true, answer: { ...ans, levels: { ...ans.levels, [level.id]: { ...rec, failedRuns: rec.failedRuns + 1, result } } } };
    });
  }, [resolveLevel, updateItem]);

  /** Ladder: give up on the current level and reveal the next. */
  const skipLevel = React.useCallback(() => {
    const r = runRef.current;
    const item = r ? r.items[r.plan[r.index]?.itemId ?? ""] : null;
    const p = item ? r?.progress[item.id] : null;
    if (!item || item.type !== "ladder" || !p || p.reveal || p.run.state === "running") return;
    updateItem(item.id, (cur) => ({ ...cur, firstCheckAt: cur.firstCheckAt ?? Date.now() }));
    resolveLevel(item, "skipped", null);
  }, [resolveLevel, updateItem]);

  const check = React.useCallback(async () => {
    const r = runRef.current;
    if (!r || r.phase !== "playing") return;
    const item = r.items[r.plan[r.index]?.itemId ?? ""];
    const p = item ? r.progress[item.id] : null;
    if (!item || !p || p.reveal || p.run.state === "running" || !isAnswerComplete(item, p.answer)) return;
    const firstCheckAt = p.firstCheckAt ?? Date.now();
    updateItem(item.id, (cur) => ({ ...cur, firstCheckAt }));

    if (item.type === "explain") {
      updateItem(item.id, (cur) => ({ ...cur, selfGrading: true }));
      requestJudge(item, "main");
      return;
    }

    if (item.type === "case") {
      const stage = item.stages[(p.answer as CaseAnswer).current];
      if (!stage || p.judge[stage.id]) return;
      requestJudge(item, stage.id);
      return;
    }

    if (item.type === "ladder") {
      await checkLadderLevel(item, p);
      return;
    }

    const score = staticScore(item, p.answer);
    if (item.type === "choose-design" && item.rationale && score && (p.answer as { rationale?: string }).rationale?.trim()) {
      // The choice is graded now; the written reason is judged before the item closes.
      updateItem(item.id, (cur) => ({ ...cur, pendingScore: score, selfGrading: true }));
      requestJudge(item, "rationale");
      return;
    }
    const job = hasRunner() ? runJobFor(item, p.answer) : null;
    const mustRun = RUN_TYPES.has(item.type);
    const secondChance = !mustRun && job && score && score.q < 1;
    if (!mustRun && !secondChance) {
      if (score) finalize(item, score, "none");
      return;
    }
    if (!job) return;

    updateItem(item.id, (cur) => ({ ...cur, run: { state: "running" } }));
    const results: RunResult[] = [];
    for (const each of mustRun ? implementJobs(item, p.answer) : [job]) {
      const one = await runCode(each);
      results.push(one);
      if (one.status !== "ok") break;
    }
    const result = mergeRunResults(results);
    updateItem(item.id, (cur) => ({ ...cur, run: { state: "done", result } }));
    if (isInfrastructureFailure(result)) {
      // Not the learner's fault: nothing is scored. Static items keep their static score.
      if (!mustRun && score) finalize(item, score, "none");
      return;
    }
    const runScore = scoreFromRun(item, p.answer, result);
    if (mustRun) {
      // Code items are iterated on: run as often as needed until every test
      // passes. A pass after a failed run is graded "not first try" (Hard), so
      // retrying costs spacing, not the item. Giving up is `giveUp`.
      const runs = p.runs + 1;
      const solved = runScore.q >= 1 - 1e-9;
      if (!solved) {
        updateItem(item.id, (cur) => ({ ...cur, runs, missedOnce: true }));
        return;
      }
      updateItem(item.id, (cur) => ({ ...cur, runs }));
    }
    finalize(item, runScore, "runner");
  }, [checkLadderLevel, finalize, updateItem]);

  /** The text a judged part answers: explain's answer, the choice's rationale, or a case stage's text. */
  const partText = (item: DojoItem, answer: unknown, part: string) => {
    if (item.type === "explain") return (answer as { text: string }).text;
    if (item.type === "choose-design") return (answer as { rationale?: string }).rationale ?? "";
    if (item.type === "case") return (answer as CaseAnswer).texts[part] ?? "";
    return "";
  };

  /**
   * Opens the self-check of one part, prefilled with what is decided
   * deterministically: criteria with forbidden phrases.
   */
  const requestJudge = React.useCallback((item: DojoItem, part: string) => {
    const r = runRef.current;
    const p = r?.progress[item.id];
    const jp = judgedParts(item).find((x) => x.part === part);
    if (!r || !p || !jp) return;
    const text = partText(item, p.answer, part);
    const verdicts: Record<string, JudgedCriterion> = Object.fromEntries(
      applyForbidden(jp.rubric, text, [])
        .filter((v) => isForbiddenCriterion(jp.rubric.criteria.find((c) => c.id === v.id)!))
        .map((v) => [v.id, { id: v.id, met: v.met, ...(v.evidence ? { evidence: v.evidence } : {}) }]),
    );
    updateItem(item.id, (cur) => ({ ...cur, judge: { ...cur.judge, [part]: { verdicts, touched: false } } }));
  }, [updateItem]);

  /** The learner ticks one criterion (forbidden-phrase criteria are not theirs to tick). */
  const toggleCriterion = React.useCallback((part: string, criterionId: string, met: boolean) => {
    const r = runRef.current;
    const itemId = r?.plan[r.index]?.itemId;
    if (!itemId) return;
    updateItem(itemId, (cur) => {
      const jp = cur.judge[part];
      if (!jp || cur.reveal) return cur;
      const prev = jp.verdicts[criterionId];
      return { ...cur, judge: { ...cur.judge, [part]: { ...jp, touched: true, verdicts: { ...jp.verdicts, [criterionId]: { id: criterionId, met, ...(prev?.evidence ? { evidence: prev.evidence } : {}) } } } } };
    });
  }, [updateItem]);

  /** Case: the current stage is judged; reveal the next one. */
  const nextCaseStage = React.useCallback(() => {
    const r = runRef.current;
    const item = r ? r.items[r.plan[r.index]?.itemId ?? ""] : null;
    if (!item || item.type !== "case") return;
    updateItem(item.id, (cur) => {
      const a = cur.answer as CaseAnswer;
      const stage = item.stages[a.current];
      if (!stage || !cur.judge[stage.id] || a.current >= item.stages.length - 1) return cur;
      return { ...cur, answer: { ...a, current: a.current + 1 } };
    });
  }, [updateItem]);

  /**
   * Closes a self-checked item with the learner's grade. The score comes from
   * the ticked criteria; when nothing was ticked it falls back to the grade
   * alone.
   */
  const gradeJudged = React.useCallback((grade: Grade) => {
    const r = runRef.current;
    const item = r ? r.items[r.plan[r.index]?.itemId ?? ""] : null;
    const p = item && r ? r.progress[item.id] : null;
    if (!item || !p || p.reveal) return;
    const parts = judgedParts(item);
    const states = parts.map((jp) => p.judge[jp.part]).filter(Boolean);
    if (states.length < parts.length) return;
    const ticked = states.some((st) => st.touched);
    const list = (part: string) => Object.values(p.judge[part]?.verdicts ?? {}).map(({ id, met, evidence }) => ({ id, met, evidence }));
    const kcs = item.kcs.map((k) => k.id);
    let score: Score;
    if (item.type === "case") score = ticked ? scoreCase(item, Object.fromEntries(parts.map((jp) => [jp.part, list(jp.part)]))) : scoreSelfGrade(grade, kcs);
    else if (item.type === "choose-design" && item.rationale) {
      const rationaleQ = ticked ? scoreJudged(item.rationale, list("rationale"), kcs).q : undefined;
      score = scoreChooseDesign({ kcs, options: item.options, selected: (p.answer as { selected: string[] }).selected, ...(rationaleQ !== undefined ? { rationaleQ } : {}) });
    } else score = ticked ? scoreJudged(parts[0].rubric, list(parts[0].part), kcs) : scoreSelfGrade(grade, kcs);
    updateItem(item.id, (cur) => ({ ...cur, selfGrade: grade }));
    finalize(item, score, "none", {
      judge: { by: "self", userGrade: grade },
      // A case is timed as a whole round (checkpoints and simulations are timed exams).
      ...(item.type === "case" ? { latencyMs: Math.max(0, Date.now() - p.shownAt) } : {}),
    });
  }, [finalize, updateItem]);

  /**
   * Stop iterating on a code item and see the reference solution. Recorded
   * with the last run's score and `solutionRevealed`, which grades it Again
   * (the KC comes back soon) and earns no XP.
   */
  const giveUp = React.useCallback(() => {
    const r = runRef.current;
    const item = r ? r.items[r.plan[r.index]?.itemId ?? ""] : null;
    const p = item && r ? r.progress[item.id] : null;
    if (!item || !p || p.reveal || !RUN_TYPES.has(item.type) || p.run.state === "running") return;
    const last = p.run.state === "done" ? p.run.result : null;
    const score = last && !isInfrastructureFailure(last) ? scoreFromRun(item, p.answer, last) : { q: 0, qByKc: {} };
    finalize(item, score, last ? "runner" : "none", { solutionRevealed: true });
  }, [finalize]);

  const selfGrade = React.useCallback((grade: Grade) => {
    const r = runRef.current;
    const item = r ? r.items[r.plan[r.index]?.itemId ?? ""] : null;
    if (!item || item.type !== "explain") return;
    updateItem(item.id, (cur) => ({ ...cur, selfGrade: grade }));
    finalize(item, selfGradeScore(item, grade), "none");
  }, [finalize, updateItem]);

  const finish = React.useCallback(async () => {
    const r = runRef.current;
    if (!r) return;
    update((cur) => ({ ...cur, phase: "finishing", finishError: null }));
    const drained = await getAttemptQueue().drain();
    if (!drained) {
      update((cur) => ({ ...cur, finishError: "ATTEMPTS_PENDING" }));
      return;
    }
    try {
      const summary = await finishDojoSession({
        id: r.id,
        patch: { finishedAt: new Date().toISOString(), activeSec: Math.round(runRef.current?.activeSec ?? r.activeSec), abandoned: false },
        localDay: deviceLocalDay(),
      });
      depsRef.current.onToday(summary.today);
      update((cur) => ({ ...cur, phase: "summary", summary }));
    } catch (cause) {
      update((cur) => ({ ...cur, finishError: cause instanceof DojoApiError ? cause.code : "UNKNOWN" }));
    }
  }, [update]);

  /** Continue (after feedback) or Skip (before checking): next item, or finish. */
  const advance = React.useCallback(() => {
    const r = runRef.current;
    if (!r || r.phase !== "playing") return;
    const nextIndex = r.index + 1;
    const nextEntry = r.plan[nextIndex];
    if (!nextEntry) {
      void finish();
      return;
    }
    const nextItem = r.items[nextEntry.itemId];
    if (!nextItem) {
      // A requeued item's bundle is still loading: skip it rather than stall.
      update((cur) => ({ ...cur, plan: cur.plan.filter((entry) => entry.itemId !== nextEntry.itemId) }));
      advance();
      return;
    }
    update((cur) => ({
      ...cur,
      index: nextIndex,
      progress: { ...cur.progress, [nextItem.id]: cur.progress[nextItem.id] ?? freshProgress(nextItem) },
    }));
  }, [finish, update]);

  /** Leaves the player; the store keeps the session open, so it can be resumed. */
  const close = React.useCallback(() => {
    runRef.current = null;
    composeRef.current = null;
    setRun(null);
  }, []);

  const resetAnswer = React.useCallback(() => {
    const r = runRef.current;
    const item = r ? r.items[r.plan[r.index]?.itemId ?? ""] : null;
    if (item) updateItem(item.id, (cur) => (cur.reveal ? cur : { ...cur, answer: emptyAnswerFor(item), run: { state: "idle" } }));
  }, [updateItem]);

  return {
    run,
    current,
    progress: current && run ? run.progress[current.id] ?? null : null,
    busy,
    error,
    clearError: () => setError(null),
    start,
    setAnswer,
    toggleHint,
    nextHint,
    check,
    giveUp,
    toggleCriterion,
    nextCaseStage,
    gradeJudged,
    requestJudge,
    selfGrade,
    skipLevel,
    advance,
    finish,
    close,
    resetAnswer,
  };
}

export type DojoSessionController = ReturnType<typeof useDojoSession>;
