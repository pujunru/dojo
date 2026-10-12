/**
 * A series' curriculum graph (`content/series/<id>/skill-graph.json`):
 * tiers → units → lessons → knowledge components (KCs).
 *
 * Types plus a runtime validator shared by the content build, the validator
 * and the client. No browser-only or Node-only imports.
 */
import { DOJO_ITEM_TYPES, type DojoItemType } from "./content-schema";

export type SkillTier = { id: string; title_zh: string; title_en: string; order: number };

export type SkillLesson = {
  id: string;
  title_zh: string;
  title_en: string;
  minutes: number;
  kcs: string[];
  itemTypes: DojoItemType[];
};

export type SkillUnit = {
  id: string;
  tier: string;
  order: number;
  title_zh: string;
  title_en: string;
  goal_zh: string;
  goal_en?: string;
  prereqUnits: string[];
  kcs: string[];
  lessons: SkillLesson[];
  checkpoint: { type: string; ref: string; minutes: number } | null;
  exit: unknown[];
};

export type SkillKc = {
  id: string;
  title_zh: string;
  title_en: string;
  area: string;
  prereqs: string[];
  itemTypes: DojoItemType[];
  payoff: unknown;
};

export type SkillCoverage = { question: string; title: string; kcs: string[]; units: string[] };

export type SkillGraph = {
  version: string | number;
  tiers: SkillTier[];
  units: SkillUnit[];
  kcs: SkillKc[];
  coverage: SkillCoverage[];
};

export type GraphIssue = { path: string; message: string; severity: "error" | "warning" };

type Obj = Record<string, unknown>;
const isObj = (v: unknown): v is Obj => typeof v === "object" && v !== null && !Array.isArray(v);
const strs = (v: unknown): string[] => (Array.isArray(v) ? v.filter((x): x is string => typeof x === "string") : []);

/**
 * Validates a parsed skill-graph.json. Unknown extra fields are kept (the
 * curriculum file may carry authoring notes); missing required ones, dangling
 * references, duplicate ids and prerequisite cycles are errors.
 */
export function validateSkillGraph(value: unknown): { graph: SkillGraph | null; issues: GraphIssue[] } {
  const issues: GraphIssue[] = [];
  const error = (path: string, message: string) => issues.push({ path, message, severity: "error" });
  const warn = (path: string, message: string) => issues.push({ path, message, severity: "warning" });
  if (!isObj(value)) return { graph: null, issues: [{ path: "$", message: "expected an object", severity: "error" }] };

  const needStr = (o: Obj, key: string, path: string) => {
    if (typeof o[key] !== "string" || !(o[key] as string).trim()) error(`${path}.${key}`, "expected a non-empty string");
  };
  const needArr = (o: Obj, key: string, path: string) => {
    if (!Array.isArray(o[key])) error(`${path}.${key}`, "expected an array");
    return Array.isArray(o[key]) ? (o[key] as unknown[]) : [];
  };
  const typeList = (v: unknown, path: string): DojoItemType[] => {
    const out: DojoItemType[] = [];
    strs(v).forEach((t, i) => {
      if ((DOJO_ITEM_TYPES as readonly string[]).includes(t)) out.push(t as DojoItemType);
      else error(`${path}[${i}]`, `unknown item type ${t}`);
    });
    return out;
  };

  const tiers = needArr(value, "tiers", "$");
  const units = needArr(value, "units", "$");
  const kcs = needArr(value, "kcs", "$");
  const coverage = Array.isArray(value.coverage) ? value.coverage : [];

  const tierIds = new Set<string>();
  tiers.forEach((t, i) => {
    if (!isObj(t)) { error(`tiers[${i}]`, "expected an object"); return; }
    needStr(t, "id", `tiers[${i}]`);
    if (tierIds.has(String(t.id))) error(`tiers[${i}].id`, `duplicate tier ${t.id}`);
    tierIds.add(String(t.id));
  });

  const kcIds = new Set<string>();
  kcs.forEach((k, i) => {
    if (!isObj(k)) return error(`kcs[${i}]`, "expected an object");
    needStr(k, "id", `kcs[${i}]`);
    needStr(k, "title_zh", `kcs[${i}]`);
    needStr(k, "title_en", `kcs[${i}]`);
    if (kcIds.has(String(k.id))) error(`kcs[${i}].id`, `duplicate KC ${k.id}`);
    kcIds.add(String(k.id));
    typeList(k.itemTypes, `kcs[${i}].itemTypes`);
  });
  kcs.forEach((k, i) => {
    if (!isObj(k)) return;
    strs(k.prereqs).forEach((p, j) => { if (!kcIds.has(p)) error(`kcs[${i}].prereqs[${j}]`, `unknown KC ${p}`); });
  });

  const unitIds = new Set<string>();
  const lessonIds = new Set<string>();
  units.forEach((u, i) => {
    if (!isObj(u)) return error(`units[${i}]`, "expected an object");
    const path = `units[${i}]`;
    needStr(u, "id", path);
    needStr(u, "title_zh", path);
    needStr(u, "title_en", path);
    if (unitIds.has(String(u.id))) error(`${path}.id`, `duplicate unit ${u.id}`);
    unitIds.add(String(u.id));
    if (!tierIds.has(String(u.tier))) error(`${path}.tier`, `unknown tier ${u.tier}`);
    strs(u.kcs).forEach((k, j) => { if (!kcIds.has(k)) error(`${path}.kcs[${j}]`, `unknown KC ${k}`); });
    needArr(u, "lessons", path).forEach((l, j) => {
      const lp = `${path}.lessons[${j}]`;
      if (!isObj(l)) return error(lp, "expected an object");
      needStr(l, "id", lp);
      if (lessonIds.has(String(l.id))) error(`${lp}.id`, `duplicate lesson ${l.id}`);
      lessonIds.add(String(l.id));
      strs(l.kcs).forEach((k, n) => { if (!kcIds.has(k)) error(`${lp}.kcs[${n}]`, `unknown KC ${k}`); });
      typeList(l.itemTypes, `${lp}.itemTypes`);
    });
  });
  units.forEach((u, i) => {
    if (!isObj(u)) return;
    strs(u.prereqUnits).forEach((p, j) => { if (!unitIds.has(p)) error(`units[${i}].prereqUnits[${j}]`, `unknown unit ${p}`); });
  });

  coverage.forEach((c, i) => {
    if (!isObj(c)) return warn(`coverage[${i}]`, "expected an object");
    strs(c.kcs).forEach((k, j) => { if (!kcIds.has(k)) warn(`coverage[${i}].kcs[${j}]`, `unknown KC ${k}`); });
    strs(c.units).forEach((u, j) => { if (!unitIds.has(u)) warn(`coverage[${i}].units[${j}]`, `unknown unit ${u}`); });
  });

  // KC prerequisite cycles make mastery gating impossible.
  const prereqOf = new Map<string, string[]>();
  kcs.forEach((k) => {
    // First definition wins; a duplicate is already reported above.
    if (isObj(k) && !prereqOf.has(String(k.id))) prereqOf.set(String(k.id), strs(k.prereqs));
  });
  const state = new Map<string, 1 | 2>();
  const visit = (id: string, trail: string[]): void => {
    if (state.get(id) === 2) return;
    if (state.get(id) === 1) {
      error("kcs", `prerequisite cycle: ${[...trail, id].join(" → ")}`);
      return;
    }
    state.set(id, 1);
    for (const p of prereqOf.get(id) ?? []) visit(p, [...trail, id]);
    state.set(id, 2);
  };
  for (const id of prereqOf.keys()) visit(id, []);

  const ok = !issues.some((x) => x.severity === "error");
  return { graph: ok ? (value as unknown as SkillGraph) : null, issues };
}

/** Lookup tables used by the validator and the composer. */
export function indexSkillGraph(graph: SkillGraph) {
  const kcById = new Map(graph.kcs.map((k) => [k.id, k]));
  const unitById = new Map(graph.units.map((u) => [u.id, u]));
  const lessonById = new Map<string, SkillLesson & { unit: string }>();
  for (const u of graph.units) for (const l of u.lessons) lessonById.set(l.id, { ...l, unit: u.id });
  return { kcById, unitById, lessonById };
}

/** Merges fixture graphs (from `_`-prefixed units) into the real one. */
export function mergeSkillGraphs(base: SkillGraph, extra: SkillGraph[]): SkillGraph {
  return {
    ...base,
    tiers: [...base.tiers, ...extra.flatMap((g) => g.tiers.filter((t) => !base.tiers.some((b) => b.id === t.id)))],
    units: [...base.units, ...extra.flatMap((g) => g.units)],
    kcs: [...base.kcs, ...extra.flatMap((g) => g.kcs)],
    coverage: [...base.coverage, ...extra.flatMap((g) => g.coverage ?? [])],
  };
}

export const EMPTY_SKILL_GRAPH: SkillGraph = { version: 0, tiers: [], units: [], kcs: [], coverage: [] };
