/**
 * Dojo app model: pure functions that turn the content manifest and
 * the learner state into what the compositions render (path, heatmap, review
 * queue) and what the composer needs (the playable graph for this build).
 *
 * No React, no fetch: everything here is deterministic for its inputs so the
 * page can recompute it on every state change.
 */
import { primaryKc, type DojoItemIndexRow, type DojoItemType, type DojoManifest } from "../core/content-schema";
import { isRunnable, orderedUnits, unitKcs, type ComposerGraph, type RuntimeAvailability } from "../core/composer";
import { DEFAULT_SCHEDULER, isSandboxRuntime, localRef, runtimeAvailable, schedulerParams, type SchedulerParams, type SeriesConfig } from "../core/series";
import { isUnitCracked } from "../core/gamification";
import { isDue, isRemedial, recallProbability, type KcState, type Mastery } from "../core/learner-model";
import type { SkillGraph, SkillKc, SkillUnit } from "../core/skill-graph";
import { isEnglishLocale, type Locale } from "../i18n/config";
import type { DojoUnitCrown } from "../core/contract";
import type {
  KcHeatmapRow,
  PathNodeView,
  ReviewQueueEntry,
  UnitPathView,
} from "../features";

/**
 * Types whose sandbox run only confirms an answer that is also graded without
 * executing anything: spot-bug by line F1, fill-blank by accepted strings,
 * parsons by accepted orders. Their tests are an optional second chance, so on
 * a build without the sandbox they are still playable.
 */
export const STATICALLY_GRADED_TYPES: ReadonlySet<DojoItemType> = new Set(["spot-bug", "fill-blank", "parsons"]);

/** Manifest rows as this build can play them (see `STATICALLY_GRADED_TYPES`). */
export function rowsForBuild(rows: readonly DojoItemIndexRow[], avail: RuntimeAvailability): DojoItemIndexRow[] {
  return rows.map((row) => (
    isSandboxRuntime(row.runtime) && !runtimeAvailable(row.runtime, avail) && STATICALLY_GRADED_TYPES.has(row.type)
      ? { ...row, runtime: "none" as const }
      : row
  ));
}

/** Items the composer may schedule at all (ladders and mocks have their own flows). */
export function isComposable(row: Pick<DojoItemIndexRow, "type" | "checkpointFor" | "simulationMinutes">, params: SchedulerParams = DEFAULT_SCHEDULER) {
  return row.type !== "ladder" && !row.checkpointFor && !row.simulationMinutes && params.rungOf[row.type] <= params.maxComposedRung;
}

/**
 * The skill graph restricted to KCs that have at least one item matching
 * `keep`. Content is authored unit by unit, so a graph KC without items would
 * otherwise never reach mastery 1 and would lock every unit after it forever.
 */
export function pruneGraph(graph: SkillGraph, rows: readonly DojoItemIndexRow[], keep: (row: DojoItemIndexRow) => boolean, params: SchedulerParams = DEFAULT_SCHEDULER): SkillGraph {
  const kcsWithItems = new Set(rows.filter((row) => isComposable(row, params) && keep(row)).map((row) => primaryKc(row)));
  const units: SkillUnit[] = [];
  for (const unit of graph.units) {
    const lessons = unit.lessons
      .map((lesson) => ({ ...lesson, kcs: lesson.kcs.filter((id) => kcsWithItems.has(id)) }))
      .filter((lesson) => lesson.kcs.length > 0);
    if (!lessons.length) continue;
    units.push({ ...unit, lessons, kcs: unit.kcs.filter((id) => kcsWithItems.has(id)) });
  }
  const unitIds = new Set(units.map((unit) => unit.id));
  return {
    ...graph,
    units: units.map((unit) => ({ ...unit, prereqUnits: unit.prereqUnits.filter((id) => unitIds.has(id)) })),
    kcs: graph.kcs
      .filter((kc) => kcsWithItems.has(kc.id))
      .map((kc) => ({ ...kc, prereqs: kc.prereqs.filter((id) => kcsWithItems.has(id)) })),
  };
}

export type DojoGraphs = {
  /** The series these graphs belong to, and its scheduler. */
  series: SeriesConfig;
  scheduler: SchedulerParams;
  /** Everything with content, whatever this build can run: what the path shows. */
  display: SkillGraph;
  /** Only what this build can run: what the composer and unlocks use. */
  compose: SkillGraph;
  rows: DojoItemIndexRow[];
};

export function buildGraphs(manifest: Pick<DojoManifest, "graph" | "items" | "series">, avail: RuntimeAvailability): DojoGraphs {
  const rows = rowsForBuild(manifest.items, avail);
  const scheduler = schedulerParams(manifest.series.scheduler);
  return {
    series: manifest.series,
    scheduler,
    display: pruneGraph(manifest.graph, rows, () => true, scheduler),
    compose: pruneGraph(manifest.graph, rows, (row) => isRunnable(row, avail), scheduler),
    rows,
  };
}

/** Curriculum titles are bilingual data fields; pick the one for the locale. */
export function pickTitle(entry: { title_zh: string; title_en: string } | undefined, locale: Locale) {
  if (!entry) return "";
  return isEnglishLocale(locale) ? entry.title_en || entry.title_zh : entry.title_zh || entry.title_en;
}

export function pickGoal(unit: SkillUnit, locale: Locale) {
  return isEnglishLocale(locale) ? unit.goal_en || unit.goal_zh || "" : unit.goal_zh || unit.goal_en || "";
}

const masteryOfKc = (kc: ReadonlyMap<string, KcState>, id: string) => kc.get(id)?.mastery ?? 0;

/** Same rule as `isUnitUnlocked`, but the prereqs are judged on the compose graph. */
function unitUnlocked(displayUnit: SkillUnit, compose: ComposerGraph, kc: ReadonlyMap<string, KcState>) {
  return displayUnit.prereqUnits.every((pid) => {
    const pre = compose.units.find((unit) => unit.id === pid);
    return !pre || unitKcs(pre).every((id) => masteryOfKc(kc, id) >= 1);
  });
}

function kcLearnable(compose: ComposerGraph, id: string, kc: ReadonlyMap<string, KcState>) {
  const node = compose.kcs.find((k) => k.id === id);
  return Boolean(node) && (node?.prereqs ?? []).every((pre) => masteryOfKc(kc, pre) >= 1);
}

/** Path node ids for a unit's checkpoint: `checkpoint:<unitId>`. */
export const CHECKPOINT_NODE_PREFIX = "checkpoint:";

export type PathTierView = {
  id: string;
  code: string;
  title: string;
  unitsComplete: number;
  unitsTotal: number;
  units: UnitPathView[];
};

/**
 * The learner's path: tiers → units → lesson nodes, with lock state, crowns,
 * cracks, the "you are here" marker and lessons that need a code runner.
 */
export function buildPath(input: {
  graphs: DojoGraphs;
  kc: ReadonlyMap<string, KcState>;
  units: readonly DojoUnitCrown[];
  now: Date;
  locale: Locale;
  /** A code runner is registered (code checkpoints need it). */
  sandbox?: boolean;
}): PathTierView[] {
  const { graphs, kc, now, locale } = input;
  const crownById = new Map(input.units.map((unit) => [unit.unitId, unit.crowns]));
  const checkpointById = new Map(input.units.map((unit) => [unit.unitId, unit.checkpointPassedAt]));
  // Checkpoint candidates per unit: a case marked `checkpointFor` wins over the unit's ladders.
  const casesByUnit = new Map<string, DojoItemIndexRow[]>();
  const laddersByUnit = new Map<string, DojoItemIndexRow[]>();
  for (const row of graphs.rows) {
    if (row.type === "case" && row.checkpointFor) casesByUnit.set(row.checkpointFor, [...(casesByUnit.get(row.checkpointFor) ?? []), row]);
    if (row.type === "ladder") laddersByUnit.set(row.unit, [...(laddersByUnit.get(row.unit) ?? []), row]);
  }
  const composeLessons = new Set(graphs.compose.units.flatMap((unit) => unit.lessons.map((lesson) => lesson.id)));
  const unitTitle = new Map(graphs.display.units.map((unit) => [unit.id, pickTitle(unit, locale)]));
  const views = new Map<string, UnitPathView>();
  let ordinal = 0;
  let currentSet = false;

  for (const unit of orderedUnits(graphs.display) as SkillUnit[]) {
    ordinal += 1;
    const unlocked = unitUnlocked(unit, graphs.compose, kc);
    const nodes: PathNodeView[] = unit.lessons.map((lesson) => {
      const mastered = lesson.kcs.filter((id) => masteryOfKc(kc, id) >= 1).length;
      const seen = lesson.kcs.filter((id) => (kc.get(id)?.seen ?? 0) > 0).length;
      const localOnly = !composeLessons.has(lesson.id);
      const reachable = lesson.kcs.some((id) => (kc.get(id)?.seen ?? 0) > 0 || kcLearnable(graphs.compose, id, kc));
      let state: PathNodeView["state"];
      if (!unlocked) state = "locked";
      else if (mastered === lesson.kcs.length) state = "complete";
      else if (seen > 0) state = "in-progress";
      else if (localOnly || reachable) state = "available";
      else state = "locked";
      const crowns = Math.min(5, ...lesson.kcs.map((id) => masteryOfKc(kc, id))) as Mastery;
      const node: PathNodeView = {
        id: lesson.id,
        kind: "lesson",
        title: pickTitle(lesson, locale),
        minutes: lesson.minutes,
        state,
        crowns,
        cracked: isUnitCracked(lesson.kcs, kc, now),
        localOnly,
        progress: { done: mastered, total: lesson.kcs.length },
      };
      return node;
    });
    // The unit's boss: its checkpoint case or ladder. It gates crowns 4–5.
    const longest = (rows: DojoItemIndexRow[] | undefined) => [...(rows ?? [])].sort((x, y) => y.estSeconds - x.estSeconds)[0];
    const ladder = longest(casesByUnit.get(unit.id)) ?? longest(laddersByUnit.get(unit.id));
    if (ladder) {
      const passedAt = checkpointById.get(unit.id) ?? null;
      nodes.push({
        id: `${CHECKPOINT_NODE_PREFIX}${unit.id}`,
        kind: "checkpoint",
        title: pickTitle(unit, locale),
        minutes: unit.checkpoint?.minutes ?? Math.round(ladder.estSeconds / 60),
        state: !unlocked ? "locked" : passedAt ? "complete" : "available",
        crowns: (crownById.get(unit.id) ?? 0) as Mastery,
        localOnly: !isRunnable(ladder, { "sandbox:python": input.sandbox ?? false }),
      });
    }
    for (const node of nodes) {
      if (currentSet) break;
      if ((node.state === "available" || node.state === "in-progress") && !node.localOnly) {
        node.current = true;
        currentSet = true;
      }
    }
    const playable = nodes.filter((node) => !node.localOnly && node.kind === "lesson");
    const complete = playable.length > 0 && playable.every((node) => node.state === "complete");
    const lockedAfter = unit.prereqUnits.find((pid) => {
      const pre = graphs.compose.units.find((u) => u.id === pid);
      return pre && !unitKcs(pre).every((id) => masteryOfKc(kc, id) >= 1);
    });
    views.set(unit.id, {
      id: unit.id,
      ordinal,
      title: pickTitle(unit, locale),
      goal: pickGoal(unit, locale) || undefined,
      state: !unlocked ? "locked" : complete ? "complete" : "active",
      crowns: (crownById.get(unit.id) ?? 0) as Mastery,
      cracked: isUnitCracked(unitKcs(unit), kc, now),
      lockedAfter: lockedAfter ? unitTitle.get(lockedAfter) : undefined,
      nodes,
    });
  }

  const tiers = [...graphs.display.tiers].sort((a, b) => a.order - b.order);
  return tiers
    .map((tier) => {
      const units = graphs.display.units.filter((unit) => unit.tier === tier.id).map((unit) => views.get(unit.id)).filter((v): v is UnitPathView => Boolean(v))
        .sort((a, b) => a.ordinal - b.ordinal);
      return {
        id: tier.id,
        code: localRef(tier.id).replace(/^_/, "").toUpperCase(),
        title: pickTitle(tier, locale),
        unitsComplete: units.filter((unit) => unit.state === "complete").length,
        unitsTotal: units.length,
        units,
      };
    })
    .filter((tier) => tier.units.length > 0);
}

/** The lesson (and its unit) a path node id names. */
export function findLesson(graph: SkillGraph, lessonId: string) {
  for (const unit of graph.units) {
    const lesson = unit.lessons.find((l) => l.id === lessonId);
    if (lesson) return { unit, lesson };
  }
  return null;
}

export function kcTitleMap(graph: SkillGraph, locale: Locale) {
  return new Map(graph.kcs.map((kc: SkillKc) => [kc.id, pickTitle(kc, locale)]));
}

/** Units × KCs with content: recall band, mastery and the due flag. */
export function buildHeatmap(graph: SkillGraph, kc: ReadonlyMap<string, KcState>, now: Date, locale: Locale): KcHeatmapRow[] {
  const titles = kcTitleMap(graph, locale);
  return (orderedUnits(graph) as SkillUnit[]).map((unit) => ({
    unitId: unit.id,
    title: pickTitle(unit, locale),
    cells: unitKcs(unit).map((id) => {
      const st = kc.get(id);
      const seen = Boolean(st && st.seen > 0);
      return {
        id,
        title: titles.get(id) ?? id,
        p: seen && st ? recallProbability(st, now) : null,
        mastery: (st?.mastery ?? 0) as Mastery,
        due: seen && st ? isDue(st, now) : false,
      };
    }),
  }));
}

/** Upcoming = due within this many days. */
export const UPCOMING_DAYS = 3;

/** Remediation windows, due KCs and those falling due soon. */
export function buildReviewQueue(graph: SkillGraph, kcs: readonly KcState[], now: Date, locale: Locale): ReviewQueueEntry[] {
  const titles = kcTitleMap(graph, locale);
  const unitOf = new Map<string, string>();
  for (const unit of graph.units) for (const id of unitKcs(unit)) if (!unitOf.has(id)) unitOf.set(id, pickTitle(unit, locale));
  const horizon = now.getTime() + UPCOMING_DAYS * 86_400_000;
  const out: ReviewQueueEntry[] = [];
  for (const st of kcs) {
    if (st.seen === 0 || !titles.has(st.kcId)) continue;
    const p = recallProbability(st, now);
    const base = { kcId: st.kcId, title: titles.get(st.kcId) ?? st.kcId, unitTitle: unitOf.get(st.kcId) ?? "", p };
    if (isRemedial(st, now) && st.remedialUntil) out.push({ ...base, at: st.remedialUntil, state: "remedial" });
    else if (isDue(st, now)) out.push({ ...base, at: st.nextDueAt ?? st.lastSeenAt ?? now.toISOString(), state: "due" });
    else if (st.nextDueAt && Date.parse(st.nextDueAt) <= horizon) out.push({ ...base, at: st.nextDueAt, state: "upcoming" });
  }
  return out;
}

/** Recall a day from now under a half-life: what the summary shows as "after". */
export function recallTomorrow(halfLifeDays: number) {
  return Math.pow(2, -1 / Math.max(0.1, halfLifeDays));
}
