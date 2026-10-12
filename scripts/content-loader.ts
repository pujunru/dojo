/**
 * Shared by build-content.ts and validate-content.ts: reads the authoring
 * format in `<content>/series/<series>/units/<unit>/<item>/` (docs/CONTENT.md)
 * and turns each directory into a bundled `DojoItem`,
 * plus the validator-only extras that never ship (reference tests, wrong
 * fills, distractor targets).
 *
 * Each series directory holds `series.json`, `skill-graph.json` and `units/`.
 * Everything here works in the series' LOCAL id space; the build qualifies
 * ids with the series (`qualifyItem`) only when it writes bundles.
 *
 * Node-only. Never imported by app code.
 */
import { createHash } from "node:crypto";
import { spawn } from "node:child_process";
import { existsSync, promises as fs, readdirSync, statSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  DOJO_ITEM_TYPES,
  parseDojoItem,
  type DojoItem,
  type DojoItemType,
  type L10n,
  type Rubric,
  type PyFile,
  type SchemaError,
  type TestMeta,
} from "../src/core/content-schema.ts";
import {
  EMPTY_SKILL_GRAPH,
  indexSkillGraph,
  mergeSkillGraphs,
  validateSkillGraph,
  type SkillGraph,
} from "../src/core/skill-graph.ts";
import type { RunJob, RunResult, HarnessOptions } from "../src/core/run-protocol.ts";
import { forbiddenHits, missingMentions } from "../src/core/rubric.ts";
import {
  FIXTURE_SERIES_ID,
  parseSeriesConfig,
  qualifyItemId,
  qualifyRef,
  type SeriesConfig,
} from "../src/core/series.ts";

const here = path.dirname(fileURLToPath(import.meta.url));
export const REPO_ROOT = path.resolve(here, "..");
/**
 * Where content lives: `DOJO_CONTENT_DIR` (e.g. a checkout of a separate,
 * private content repo), else `content/` in this repo.
 */
export const CONTENT_ROOT = process.env.DOJO_CONTENT_DIR
  ? path.resolve(process.env.DOJO_CONTENT_DIR)
  : path.join(REPO_ROOT, "content");
/** Overridable so tests can validate a scratch copy of the content tree. */
export const SERIES_ROOT = process.env.DOJO_SERIES_ROOT
  ? path.resolve(process.env.DOJO_SERIES_ROOT)
  : path.join(CONTENT_ROOT, "series");
export const SERIES_FILE = "series.json";
export const SKILL_GRAPH_FILE = "skill-graph.json";
export const HARNESS_PATH = path.join(REPO_ROOT, "runner", "python", "dojo_harness.py");
export const FIXTURE_GRAPH_FILE = "graph.fixture.json";

export type Issue = { file: string; path: string; message: string; severity: "error" | "warning" };

/** Validator-only data stripped from the bundle. */
export type ItemExtras = {
  /** write-tests: the author's reference tests. */
  referenceTests?: PyFile;
  /** fill-blank: per blank, fills that must make the tests fail. */
  wrongFills?: Record<string, string[]>;
  /** parsons: distractor id → line id it replaces. */
  distractorReplaces?: Record<string, string>;
  /** predict choice: author distractors before the generated answer is merged in. */
  predictDistractors?: string[];
  /** spot-bug: the fixed version used to check `fixStage`. */
  fixFiles?: PyFile[];
};

export type LoadedItem = {
  dir: string;
  unit: string;
  fixture: boolean;
  /** Un-validated bundled shape; predict answers are still placeholders. */
  raw: Record<string, unknown>;
  extras: ItemExtras;
};

export type LoadedContent = {
  series: SeriesConfig;
  /** The series directory (`…/series/<id>`). */
  seriesDir: string;
  graph: SkillGraph;
  graphPresent: boolean;
  items: LoadedItem[];
  issues: Issue[];
};

/* ───────────────────────── files ───────────────────────── */

const IGNORED = new Set(["__pycache__", ".DS_Store", ".pytest_cache"]);

async function readText(file: string): Promise<string> {
  return (await fs.readFile(file, "utf8")).replace(/\r\n/g, "\n");
}

function walk(dir: string, prefix = ""): string[] {
  const out: string[] = [];
  for (const name of readdirSync(dir).sort()) {
    if (IGNORED.has(name) || name.startsWith(".")) continue;
    const full = path.join(dir, name);
    const rel = prefix ? `${prefix}/${name}` : name;
    if (statSync(full).isDirectory()) out.push(...walk(full, rel));
    else out.push(rel);
  }
  return out;
}

/**
 * A file-set reference: a directory (every file below it, paths relative to
 * it), a single file (path = its basename), or a list of either.
 */
export async function readFileSet(itemDir: string, ref: unknown, field: string): Promise<PyFile[]> {
  const refs = Array.isArray(ref) ? ref : [ref];
  const out: PyFile[] = [];
  for (const r of refs) {
    if (typeof r !== "string" || !r) throw new Error(`${field}: expected a path or list of paths`);
    const full = path.join(itemDir, r);
    if (!full.startsWith(itemDir + path.sep)) throw new Error(`${field}: ${r} escapes the item directory`);
    if (!existsSync(full)) throw new Error(`${field}: ${r} does not exist`);
    if (statSync(full).isDirectory()) {
      for (const rel of walk(full)) out.push({ path: rel, content: await readText(path.join(full, rel)) });
    } else {
      out.push({ path: path.basename(r), content: await readText(full) });
    }
  }
  return out;
}

async function readOne(itemDir: string, ref: unknown, field: string): Promise<PyFile> {
  const files = await readFileSet(itemDir, ref, field);
  if (files.length !== 1) throw new Error(`${field}: expected exactly one file`);
  return files[0];
}

function exists(itemDir: string, rel: string) {
  return existsSync(path.join(itemDir, rel));
}

/* ───────────────────────── test metadata ───────────────────────── */

/**
 * Reads `@kc("a", "b")` decorators above each top-level `def test_*` /
 * `async def test_*`. The validator cross-checks this against the harness's
 * own collection, so a regex miss cannot ship silently.
 */
export function extractTestMeta(source: string, hidden: boolean): TestMeta[] {
  const lines = source.split("\n");
  const out: TestMeta[] = [];
  let pending: string[] | null = null;
  for (const line of lines) {
    const deco = /^@kc\((.*)\)\s*(#.*)?$/.exec(line);
    if (deco) {
      pending = [...deco[1].matchAll(/["']([^"']+)["']/g)].map((m) => m[1]);
      continue;
    }
    if (/^@/.test(line)) continue;
    const def = /^(?:async\s+)?def\s+(test_[A-Za-z0-9_]*)\s*\(/.exec(line);
    if (def) {
      out.push({ id: def[1], kcs: pending ?? [], hidden });
      pending = null;
      continue;
    }
    if (line.trim() && !line.startsWith(" ") && !line.startsWith("#")) pending = null;
  }
  return out;
}

/* ───────────────────────── parsons ───────────────────────── */

export function parsonsLineId(itemId: string, n: number): string {
  return `p${createHash("sha256").update(`${itemId}:${n}`).digest("hex").slice(0, 6)}`;
}

/** Deterministic shuffle so bundled line order never equals the answer. */
export function stableShuffle<T>(items: T[], seed: string): T[] {
  const keyed = items.map((value, i) => ({ value, key: createHash("sha256").update(`${seed}:${i}`).digest("hex") }));
  keyed.sort((a, b) => (a.key < b.key ? -1 : 1));
  const out = keyed.map((k) => k.value);
  // A shuffle that lands on the identity would leak the answer; rotate it.
  if (out.length > 1 && out.every((v, i) => v === items[i])) out.push(out.shift() as T);
  return out;
}

export function assembleParsons(lines: { id: string; code: string; indent: number }[], order: string[]): string {
  const byId = new Map(lines.map((l) => [l.id, l]));
  return order.map((id) => {
    const l = byId.get(id);
    return l ? `${"    ".repeat(l.indent)}${l.code}` : "";
  }).join("\n") + "\n";
}

/* ───────────────────────── fill-blank ───────────────────────── */

export function fillTemplate(template: PyFile[], fills: Record<string, string>): PyFile[] {
  return template.map((f) => ({
    path: f.path,
    content: f.content.replace(/# __BLANK:([a-z0-9_-]+)__/g, (m, id: string) => (id in fills ? fills[id] : m)),
  }));
}

/* ───────────────────────── loading ───────────────────────── */

const DEFAULT_OPTIONS: HarnessOptions = { seed: 0, fakeClock: false, stepBudget: 2_000_000, wallMs: 8_000, asyncTests: false };

function withOptions(raw: unknown): HarnessOptions {
  return { ...DEFAULT_OPTIONS, ...(typeof raw === "object" && raw ? (raw as Partial<HarnessOptions>) : {}) };
}

/** Strips authoring-only keys before the schema sees the object. */
function omit(o: Record<string, unknown>, keys: string[]) {
  const copy = { ...o };
  for (const k of keys) delete copy[k];
  return copy;
}

async function testStage(itemDir: string, spec: Record<string, unknown> | undefined, field: string, defaultsTo = "tests.py") {
  const tests = await readOne(itemDir, spec?.tests ?? defaultsTo, `${field}.tests`);
  return { tests, testMeta: extractTestMeta(tests.content, true), options: withOptions(spec?.options) };
}

/** Converts one authored item directory to the bundled shape. */
export async function loadItemDir(itemDir: string, unit: string): Promise<{ raw: Record<string, unknown>; extras: ItemExtras }> {
  const authored = JSON.parse(await readText(path.join(itemDir, "item.json"))) as Record<string, unknown>;
  const type = authored.type as DojoItemType;
  if (!(DOJO_ITEM_TYPES as readonly string[]).includes(type)) throw new Error(`type: unknown item type ${String(type)}`);
  if (authored.unit !== undefined && authored.unit !== unit) {
    throw new Error(`unit: item.json says ${String(authored.unit)} but it lives in units/${unit}/`);
  }
  const base = { ...authored, unit };
  const extras: ItemExtras = {};
  const id = String(authored.id ?? "");

  switch (type) {
    case "predict": {
      const answer = (authored.answer ?? {}) as Record<string, unknown>;
      let bundledAnswer: Record<string, unknown>;
      if (answer.mode === "choice") {
        extras.predictDistractors = Array.isArray(answer.distractors) ? (answer.distractors as string[]) : [];
        bundledAnswer = { mode: "choice", options: ["", ...extras.predictDistractors], correct: 0 };
      } else if (answer.mode === "exception") bundledAnswer = { mode: "exception", excType: "Pending" };
      else bundledAnswer = { mode: "stdout", stdout: "" };
      return {
        raw: {
          ...base,
          files: await readFileSet(itemDir, authored.files ?? "code", "files"),
          entry: authored.entry ?? "main.py",
          answer: bundledAnswer,
        },
        extras,
      };
    }
    case "spot-bug": {
      const raw: Record<string, unknown> = {
        ...omit(base, ["fixStage"]),
        files: await readFileSet(itemDir, authored.files ?? "code", "files"),
        tolerance: authored.tolerance ?? 1,
      };
      const fix = authored.fixStage as Record<string, unknown> | undefined;
      if (fix) {
        raw.fixStage = await testStage(itemDir, fix, "fixStage");
        extras.fixFiles = await readFileSet(itemDir, fix.fix ?? "fix", "fixStage.fix");
      }
      return { raw, extras };
    }
    case "fill-blank": {
      const blanks = (Array.isArray(authored.blanks) ? authored.blanks : []) as Record<string, unknown>[];
      extras.wrongFills = Object.fromEntries(blanks.map((b) => [String(b.id), Array.isArray(b.wrong) ? (b.wrong as string[]) : []]));
      const raw: Record<string, unknown> = {
        ...omit(base, ["tests"]),
        template: await readFileSet(itemDir, authored.template ?? "template", "template"),
        blanks: blanks.map((b) => omit(b, ["wrong"])),
      };
      const tests = authored.tests as Record<string, unknown> | undefined;
      if (tests) raw.tests = await testStage(itemDir, tests, "tests");
      return { raw, extras };
    }
    case "parsons": {
      const solutionFile = await readOne(itemDir, authored.solution ?? "solution.py", "solution");
      const codeLines = solutionFile.content.split("\n").filter((l) => l.trim());
      const lines = codeLines.map((line, i) => {
        const spaces = line.length - line.trimStart().length;
        if (spaces % 4 !== 0) throw new Error(`solution: line ${i + 1} is not indented by a multiple of 4 spaces`);
        return { id: parsonsLineId(id, i + 1), code: line.trim(), indent: spaces / 4 };
      });
      const idOf = (n: unknown, field: string) => {
        if (typeof n !== "number" || n < 1 || n > lines.length) throw new Error(`${field}: ${String(n)} is not a line number 1..${lines.length}`);
        return lines[n - 1].id;
      };
      const alt = (Array.isArray(authored.altSolutions) ? authored.altSolutions : []) as unknown[][];
      const solutions = [lines.map((l) => l.id), ...alt.map((order, i) => order.map((n, j) => idOf(n, `altSolutions[${i}][${j}]`)))];
      const distractors = (Array.isArray(authored.distractors) ? authored.distractors : []) as Record<string, unknown>[];
      const replacesOf: Record<string, string> = {};
      extras.distractorReplaces = replacesOf;
      for (const [i, d] of distractors.entries()) {
        if (d.replaces !== undefined) replacesOf[String(d.id)] = idOf(d.replaces, `distractors[${i}].replaces`);
      }
      const raw: Record<string, unknown> = {
        ...omit(base, ["solution", "altSolutions", "tests"]),
        lines: stableShuffle(lines, id),
        solutions,
        distractors: distractors.map((d) => {
          const out = omit(d, ["replaces"]);
          return replacesOf[String(d.id)] ? { ...out, replaces: replacesOf[String(d.id)] } : out;
        }),
        requireIndent: authored.requireIndent ?? true,
        module: authored.module ?? solutionFile.path,
      };
      const tests = authored.tests as Record<string, unknown> | undefined;
      if (tests) raw.tests = await testStage(itemDir, tests, "tests");
      return { raw, extras };
    }
    case "implement":
    case "refactor": {
      const tests = await readOne(itemDir, authored.tests ?? "tests.py", "tests");
      const visibleRef = authored.visibleTests ?? (exists(itemDir, "visible_tests.py") ? "visible_tests.py" : undefined);
      const visibleTests = visibleRef ? await readOne(itemDir, visibleRef, "visibleTests") : undefined;
      const mustKill = (Array.isArray(authored.mustKill) ? authored.mustKill : []) as Record<string, unknown>[];
      const raw: Record<string, unknown> = {
        ...omit(base, ["visibleTests"]),
        starter: await readFileSet(itemDir, type === "refactor" ? authored.baseline ?? "baseline" : authored.starter ?? "starter", "starter"),
        solution: await readFileSet(itemDir, authored.solution ?? "solution", "solution"),
        tests,
        testMeta: [...extractTestMeta(tests.content, true), ...(visibleTests ? extractTestMeta(visibleTests.content, false) : [])],
        ...(visibleTests ? { visibleTests } : {}),
        mustKill: await Promise.all(mustKill.map(async (m, i) => ({
          ...m,
          files: await readFileSet(itemDir, m.files ?? `mustKill/${String(m.id)}`, `mustKill[${i}].files`),
        }))),
        options: withOptions(authored.options),
      };
      if (type === "refactor") raw.baseline = raw.starter;
      return { raw, extras };
    }
    case "write-tests": {
      extras.referenceTests = await readOne(itemDir, authored.referenceTests ?? "tests.py", "referenceTests");
      const mutants = (Array.isArray(authored.mutants) ? authored.mutants : []) as Record<string, unknown>[];
      return {
        raw: {
          ...omit(base, ["referenceTests"]),
          subject: await readFileSet(itemDir, authored.subject ?? "subject", "subject"),
          testStarter: await readOne(itemDir, authored.testStarter ?? "test_starter.py", "testStarter"),
          mutants: await Promise.all(mutants.map(async (m, i) => ({
            ...m,
            files: await readFileSet(itemDir, m.files ?? `mutants/${String(m.id)}`, `mutants[${i}].files`),
          }))),
          killTarget: authored.killTarget ?? 0.8,
          options: withOptions(authored.options),
        },
        extras,
      };
    }
    case "ladder": {
      const levels = (Array.isArray(authored.levels) ? authored.levels : []) as Record<string, unknown>[];
      return {
        raw: {
          ...base,
          starter: await readFileSet(itemDir, authored.starter ?? "starter", "starter"),
          levels: await Promise.all(levels.map(async (l, i) => {
            const tests = await readOne(itemDir, l.tests ?? `levels/${String(l.id)}/tests.py`, `levels[${i}].tests`);
            return {
              ...l,
              tests,
              testMeta: extractTestMeta(tests.content, true),
              solution: await readFileSet(itemDir, l.solution ?? `levels/${String(l.id)}/solution`, `levels[${i}].solution`),
            };
          })),
          options: withOptions(authored.options),
        },
        extras,
      };
    }
    case "explain":
    case "case": {
      const raw: Record<string, unknown> = { ...base };
      if (authored.context !== undefined) raw.context = await readFileSet(itemDir, authored.context, "context");
      return { raw, extras };
    }
    case "review":
      return {
        raw: {
          ...base,
          diff: (await readOne(itemDir, authored.diff ?? "change.diff", "diff")).content,
          context: await readFileSet(itemDir, authored.context ?? "context", "context"),
          tolerance: authored.tolerance ?? 1,
        },
        extras,
      };
    case "choose-design": {
      // The player shows options in bundle order; shuffle so the authored order never leaks the answer.
      const options = Array.isArray(authored.options) ? stableShuffle(authored.options as unknown[], `${id}:options`) : authored.options;
      return { raw: { ...base, options }, extras };
    }
  }
}

export async function loadSkillGraph(file: string): Promise<{ graph: SkillGraph; present: boolean; issues: Issue[] }> {
  if (!existsSync(file)) {
    return {
      graph: EMPTY_SKILL_GRAPH,
      present: false,
      issues: [{ file, path: "$", message: "skill-graph.json not found; KC checks use fixture graphs only", severity: "warning" }],
    };
  }
  const { graph, issues } = validateSkillGraph(JSON.parse(await readText(file)));
  return {
    graph: graph ?? EMPTY_SKILL_GRAPH,
    present: true,
    issues: issues.map((i) => ({ file, ...i })),
  };
}

export type SeriesEntry = { dir: string; fixture: boolean; config: SeriesConfig | null; issues: Issue[] };

/**
 * Every series directory, in `order`. A directory whose name starts with `_`
 * is a fixture series (validated; shipped only with `includeFixtures`).
 */
export async function listSeries({ includeFixtures }: { includeFixtures: boolean }): Promise<SeriesEntry[]> {
  if (!existsSync(SERIES_ROOT)) return [];
  const out: SeriesEntry[] = [];
  for (const name of readdirSync(SERIES_ROOT).sort()) {
    const dir = path.join(SERIES_ROOT, name);
    if (!statSync(dir).isDirectory()) continue;
    const fixture = FIXTURE_SERIES_ID.test(name);
    if (fixture && !includeFixtures) continue;
    const file = path.join(dir, SERIES_FILE);
    if (!existsSync(file)) {
      out.push({ dir, fixture, config: null, issues: [{ file: dir, path: "$", message: `series directory needs ${SERIES_FILE}`, severity: "error" }] });
      continue;
    }
    const parsed = parseSeriesConfig(JSON.parse(await readText(file)), name);
    out.push(parsed.ok
      ? { dir, fixture, config: parsed.value, issues: [] }
      : { dir, fixture, config: null, issues: parsed.errors.map((message) => ({ file, path: "$", message, severity: "error" as const })) });
  }
  return out.sort((a, b) => (a.config?.order ?? 0) - (b.config?.order ?? 0) || a.dir.localeCompare(b.dir));
}

/**
 * Loads one series' units. Units whose directory starts with `_` are
 * fixtures: they carry their own `graph.fixture.json`, are always validated,
 * and are bundled only with `includeFixtures`.
 */
export async function loadContent({ series, seriesDir, includeFixtures, onlyUnits }: {
  series: SeriesConfig;
  seriesDir: string;
  includeFixtures: boolean;
  onlyUnits?: string[];
}): Promise<LoadedContent> {
  const graphFile = process.env.DOJO_SKILL_GRAPH ? path.resolve(process.env.DOJO_SKILL_GRAPH) : path.join(seriesDir, SKILL_GRAPH_FILE);
  const { graph: baseGraph, present, issues } = await loadSkillGraph(graphFile);
  const unitsRoot = process.env.DOJO_UNITS_ROOT ? path.resolve(process.env.DOJO_UNITS_ROOT) : path.join(seriesDir, "units");
  const fixtureGraphs: SkillGraph[] = [];
  const items: LoadedItem[] = [];
  if (!existsSync(unitsRoot)) return { series, seriesDir, graph: baseGraph, graphPresent: present, items, issues };

  for (const unit of readdirSync(unitsRoot).sort()) {
    const unitDir = path.join(unitsRoot, unit);
    if (!statSync(unitDir).isDirectory()) continue;
    const fixture = unit.startsWith("_");
    if (fixture && !includeFixtures) continue;
    if (onlyUnits?.length && !onlyUnits.includes(unit)) continue;
    if (fixture) {
      const fixturePath = path.join(unitDir, FIXTURE_GRAPH_FILE);
      if (!existsSync(fixturePath)) {
        issues.push({ file: unitDir, path: "$", message: `fixture unit needs ${FIXTURE_GRAPH_FILE}`, severity: "error" });
      } else {
        const result = validateSkillGraph(JSON.parse(await readText(fixturePath)));
        issues.push(...result.issues.map((i) => ({ file: fixturePath, ...i })));
        if (result.graph) fixtureGraphs.push(result.graph);
      }
    }
    for (const slug of readdirSync(unitDir).sort()) {
      const itemDir = path.join(unitDir, slug);
      if (!statSync(itemDir).isDirectory()) continue;
      const itemJson = path.join(itemDir, "item.json");
      if (!existsSync(itemJson)) {
        issues.push({ file: itemDir, path: "$", message: "directory has no item.json", severity: "error" });
        continue;
      }
      try {
        const { raw, extras } = await loadItemDir(itemDir, unit);
        // Authors write "sandbox"; the series decides which sandbox that is.
        if (raw.runtime === "sandbox") raw.runtime = series.sandboxRuntime ?? "sandbox:python";
        items.push({ dir: itemDir, unit, fixture, raw, extras });
      } catch (error) {
        issues.push({ file: itemJson, path: "$", message: (error as Error).message, severity: "error" });
      }
    }
  }
  return { series, seriesDir, graph: fixtureGraphs.length ? mergeSkillGraphs(baseGraph, fixtureGraphs) : baseGraph, graphPresent: present, items, issues };
}

/* ───────────────────────── rubric content ───────────────────────── */

/**
 * Rubrics and their model answers agree: every `mustMention` term appears in
 * the model answer (either language), no forbidden phrase (a "没有…「x」…"
 * criterion) does, every criterion's KCs are among the item's, and staged
 * cases are well formed. `explain.followUps` are not rendered -- a staged
 * interview is a `case` item.
 */
export function rubricContentIssues(file: string, item: DojoItem): Issue[] {
  const out: Issue[] = [];
  const itemKcs = new Set(item.kcs.map((k) => k.id));
  const check = (path: string, rubric: Rubric | undefined, model: L10n | undefined) => {
    if (!rubric) return;
    const modelText = model ? Object.values(model).join("\n") : "";
    rubric.criteria.forEach((c, i) => {
      const at = `${path}.criteria[${i}]`;
      for (const kc of c.kcs) if (!itemKcs.has(kc)) out.push({ file, path: `${at}.kcs`, message: `criterion KC ${kc} is not one of the item's kcs`, severity: "error" });
      if (!model) return;
      const missing = missingMentions(c, modelText);
      if (missing.length) out.push({ file, path: `${at}.mustMention`, message: `model answer does not mention ${missing.join(", ")}`, severity: "error" });
      const hits = forbiddenHits(c, modelText);
      if (hits.length) out.push({ file, path: at, message: `model answer uses the forbidden phrase ${hits.map((h) => `「${h}」`).join(" ")}`, severity: "error" });
    });
  };
  if (item.type === "explain") {
    check("rubric", item.rubric, item.modelAnswer);
    if (item.followUps?.length) out.push({ file, path: "followUps", message: "followUps are not shown by the player; write a staged interview as a `case` item", severity: "warning" });
  }
  if (item.type === "case") {
    item.stages.forEach((st, i) => check(`stages[${i}].rubric`, st.rubric, st.modelAnswer));
    if (item.checkpointFor && item.checkpointFor !== item.unit) {
      out.push({ file, path: "checkpointFor", message: `a case can only be the checkpoint of its own unit (${item.unit})`, severity: "error" });
    }
  }
  if (item.type === "choose-design" && item.rationale) {
    const why = item.options.filter((o) => o.correct).map((o) => Object.values(o.why).join("\n")).join("\n");
    check("rationale", item.rationale, why ? { "zh-CN": why, "en-US": "" } as L10n : undefined);
  }
  return out;
}

/* ───────────────────────── series namespacing ───────────────────────── */

/**
 * Qualifies a validated item's ids with its series: the item id, its unit and
 * lesson, every KC reference (anything under a `kcs` key), its variant group
 * and checkpoint unit. Content and graphs are authored and validated in local
 * ids; bundles and the learner store only ever see qualified ones.
 */
export function qualifyItem<T extends DojoItem>(series: string, item: T): T {
  const q = (ref: string) => qualifyRef(series, ref);
  const walk = (value: unknown, key?: string): unknown => {
    if (Array.isArray(value)) {
      if (key === "kcs") return value.map((v) => (typeof v === "string" ? q(v) : v && typeof v === "object" && "id" in v ? { ...(v as object), id: q(String((v as { id: string }).id)) } : walk(v)));
      return value.map((v) => walk(v));
    }
    if (value && typeof value === "object") {
      const out: Record<string, unknown> = {};
      for (const [k, v] of Object.entries(value)) out[k] = walk(v, k);
      return out;
    }
    return value;
  };
  const out = walk(item) as Record<string, unknown>;
  out.id = qualifyItemId(series, item.id);
  out.unit = q(item.unit);
  out.lesson = q(item.lesson);
  if (item.variantGroup) out.variantGroup = q(item.variantGroup);
  if ((item.type === "ladder" || item.type === "case") && item.checkpointFor) out.checkpointFor = q(item.checkpointFor);
  return out as T;
}

/** The series graph with every id qualified (tiers, units, lessons, KCs, prereqs, coverage). */
export function qualifyGraph(series: string, graph: SkillGraph): SkillGraph {
  const q = (ref: string) => qualifyRef(series, ref);
  return {
    ...graph,
    tiers: graph.tiers.map((t) => ({ ...t, id: q(t.id) })),
    units: graph.units.map((u) => ({
      ...u,
      id: q(u.id),
      tier: q(u.tier),
      prereqUnits: u.prereqUnits.map(q),
      kcs: u.kcs.map(q),
      lessons: u.lessons.map((l) => ({ ...l, id: q(l.id), kcs: l.kcs.map(q) })),
      ...(u.checkpoint ? { checkpoint: u.checkpoint } : {}),
    })),
    kcs: graph.kcs.map((k) => ({ ...k, id: q(k.id), prereqs: k.prereqs.map(q) })),
    ...(graph.coverage ? { coverage: graph.coverage.map((c) => ({ ...c, kcs: c.kcs.map(q), units: c.units.map(q) })) } : {}),
  };
}

/* ───────────────────────── structural checks ───────────────────────── */

export function rel(file: string) {
  const relative = path.relative(REPO_ROOT, file);
  return relative.startsWith("..") ? file : relative;
}

/** Items per lesson that make a 5–10 minute lesson plus a review pool (warning outside). */
export const LESSON_ITEMS_MIN = 4;
export const LESSON_ITEMS_MAX = 10;

/** Units reachable through `prereqUnits` (excluding the unit itself). */
function ancestorUnits(unitById: Map<string, { prereqUnits: string[] }>, id: string, out = new Set<string>()): Set<string> {
  for (const p of unitById.get(id)?.prereqUnits ?? []) {
    if (out.has(p)) continue;
    out.add(p);
    ancestorUnits(unitById, p, out);
  }
  return out;
}

/** Schema + graph cross-references + cross-item uniqueness. */
export function checkStructure(content: LoadedContent): { items: { loaded: LoadedItem; item: DojoItem }[]; issues: Issue[] } {
  const issues: Issue[] = [];
  const ok: { loaded: LoadedItem; item: DojoItem }[] = [];
  const { kcById, unitById, lessonById } = indexSkillGraph(content.graph);
  const seen = new Map<string, string>();
  // A KC's home unit is the unit that lists it in `kcs`.
  const kcHome = new Map<string, string>();
  for (const u of content.graph.units) for (const k of u.kcs ?? []) if (!kcHome.has(k)) kcHome.set(k, u.id);
  const ancestors = new Map<string, Set<string>>();
  const ancestorsOf = (unit: string) => {
    if (!ancestors.has(unit)) ancestors.set(unit, ancestorUnits(unitById, unit));
    return ancestors.get(unit)!;
  };
  const perLesson = new Map<string, number>();
  const realUnits = new Set<string>();

  for (const loaded of content.items) {
    const file = path.join(loaded.dir, "item.json");
    const size = JSON.stringify(loaded.raw).length;
    if (size > 200_000) issues.push({ file, path: "$", message: `bundled item is ${size} characters (limit 200000)`, severity: "error" });
    const parsed = parseDojoItem(loaded.raw);
    if (!parsed.ok) {
      issues.push(...parsed.errors.map((e: SchemaError) => ({ file, path: e.path, message: e.message, severity: "error" as const })));
      continue;
    }
    const item = parsed.item;
    const prior = seen.get(item.id);
    if (prior) issues.push({ file, path: "id", message: `duplicate item id ${item.id} (also ${rel(prior)})`, severity: "error" });
    seen.set(item.id, file);

    // Series contract: archetype and runtime come from series.json, and ids
    // stay local (the build adds the series prefix; a prefixed id here would
    // be a reference into some series' namespace, which authors cannot make).
    if (!content.series.archetypes.includes(item.archetype)) {
      issues.push({ file, path: "archetype", message: `archetype "${item.archetype}" is not declared by series ${content.series.id} (${content.series.archetypes.join(", ")})`, severity: "error" });
    }
    if (!content.series.runtimes.includes(item.runtime)) {
      issues.push({ file, path: "runtime", message: `runtime "${item.runtime}" is not one of series ${content.series.id}'s runtimes (${content.series.runtimes.join(", ")})`, severity: "error" });
    }
    const qualified = [item.unit, item.lesson, ...item.kcs.map((kc) => kc.id)].filter((ref) => ref.includes(":"));
    if (qualified.length) {
      issues.push({ file, path: "kcs", message: `write series-local ids; the build adds the series prefix (found ${qualified.join(", ")})`, severity: "error" });
    }

    issues.push(...rubricContentIssues(file, item));

    const graphKnown = content.graphPresent || loaded.fixture;
    if (graphKnown) {
      if (!unitById.has(item.unit)) issues.push({ file, path: "unit", message: `unit ${item.unit} is not in the skill graph`, severity: "error" });
      const lesson = lessonById.get(item.lesson);
      if (!lesson) issues.push({ file, path: "lesson", message: `lesson ${item.lesson} is not in the skill graph`, severity: "error" });
      else {
        if (lesson.unit !== item.unit) issues.push({ file, path: "lesson", message: `lesson ${item.lesson} belongs to unit ${lesson.unit}, not ${item.unit}`, severity: "error" });
        if (!lesson.itemTypes.includes(item.type)) {
          issues.push({ file, path: "type", message: `lesson ${item.lesson} does not list item type ${item.type} (has ${lesson.itemTypes.join(", ")})`, severity: "error" });
        }
        // The composer teaches a lesson through the items of the KCs it lists,
        // so an item filed under a lesson that does not teach its primary KC
        // never shows up in that lesson (and pads another one).
        const primary = item.kcs.find((k) => k.weight === 1);
        if (primary && kcById.has(primary.id) && !lesson.kcs.includes(primary.id)) {
          const teaching = unitById.get(item.unit)?.lessons.filter((l) => l.kcs.includes(primary.id)).map((l) => l.id) ?? [];
          issues.push({
            file,
            path: "lesson",
            message: `lesson ${item.lesson} does not teach the primary KC ${primary.id} (teaches ${lesson.kcs.join(", ")}); ${teaching.length ? `use ${teaching.join(" or ")}` : `no lesson of ${item.unit} teaches it — move the item to the unit that does, or pick an honest primary KC`}`,
            severity: "error",
          });
        }
      }
      item.kcs.forEach((kc, i) => {
        if (!kcById.has(kc.id)) issues.push({ file, path: `kcs[${i}].id`, message: `KC ${kc.id} is not in the skill graph`, severity: "error" });
        else if (kc.weight !== 1 && !loaded.fixture) {
          // A secondary KC must already be teachable when the item's unit is: its
          // home is this unit or one of its prerequisite units.
          const home = kcHome.get(kc.id);
          if (home && home !== item.unit && !ancestorsOf(item.unit).has(home)) {
            issues.push({ file, path: `kcs[${i}].id`, message: `secondary KC ${kc.id} is taught in ${home}, which is not ${item.unit} or one of its prerequisite units`, severity: "warning" });
          }
        }
      });
      if (!loaded.fixture) {
        realUnits.add(item.unit);
        perLesson.set(item.lesson, (perLesson.get(item.lesson) ?? 0) + 1);
      }
    }

    // Tests must be tagged: grading decomposes the score per KC.
    const metas: [string, TestMeta[]][] = [];
    if ("testMeta" in item) metas.push(["testMeta", item.testMeta]);
    if (item.type === "ladder") item.levels.forEach((l, i) => metas.push([`levels[${i}].testMeta`, l.testMeta]));
    if (item.type === "spot-bug" && item.fixStage) metas.push(["fixStage.testMeta", item.fixStage.testMeta]);
    if ((item.type === "fill-blank" || item.type === "parsons") && item.tests) metas.push(["tests.testMeta", item.tests.testMeta]);
    for (const [p, list] of metas) {
      list.forEach((t, i) => {
        if (!t.kcs.length) issues.push({ file, path: `${p}[${i}]`, message: `${t.id} has no @kc(...) tag`, severity: "error" });
      });
    }
    ok.push({ loaded, item });
  }
  for (const unitId of realUnits) {
    const unit = unitById.get(unitId);
    if (!unit) continue;
    const dir = path.join(content.seriesDir, "units", unitId);
    for (const lesson of unit.lessons) {
      const n = perLesson.get(lesson.id) ?? 0;
      if (n < LESSON_ITEMS_MIN || n > LESSON_ITEMS_MAX) {
        issues.push({ file: dir, path: lesson.id, message: `lesson has ${n} item(s); want ${LESSON_ITEMS_MIN}–${LESSON_ITEMS_MAX} (move items by their primary KC, or split the lesson in the curriculum)`, severity: "warning" });
      }
    }
  }
  return { items: ok, issues };
}

/* ───────────────────────── running the harness ───────────────────────── */

export const PYTHON = process.env.DOJO_PYTHON || "python3";

export async function pythonVersion(): Promise<string> {
  const out = await new Promise<string>((resolve, reject) => {
    const child = spawn(PYTHON, ["-c", "import sys; print('%d.%d.%d' % sys.version_info[:3])"]);
    let text = "";
    child.stdout.on("data", (c) => { text += c; });
    child.on("error", reject);
    child.on("close", (code) => (code === 0 ? resolve(text.trim()) : reject(new Error(`${PYTHON} exited ${code}`))));
  });
  const [major, minor] = out.split(".").map(Number);
  if (major < 3 || (major === 3 && minor < 12)) throw new Error(`${PYTHON} is ${out}; the dojo harness needs CPython >= 3.12`);
  return out;
}

/** Runs a batch of jobs in one harness process. */
export async function runHarness(jobs: RunJob[], { hashSeed = 0 }: { hashSeed?: number } = {}): Promise<RunResult[]> {
  if (!jobs.length) return [];
  const budgetMs = jobs.reduce((sum, job) => {
    const runs = job.kind === "mutants" ? job.mutants.length + 1 : 1;
    return sum + job.options.wallMs * runs;
  }, 0) + 15_000;
  const workdir = await fs.mkdtemp(path.join(os.tmpdir(), "dojo-validate-"));
  try {
    return await new Promise<RunResult[]>((resolve, reject) => {
      const child = spawn(PYTHON, ["-s", "-B", "-X", "utf8", HARNESS_PATH, "--workdir", workdir], {
        env: { ...process.env, PYTHONHASHSEED: String(hashSeed), PYTHONDONTWRITEBYTECODE: "1" },
        detached: true,
      });
      let out = "";
      let err = "";
      const timer = setTimeout(() => {
        try { process.kill(-child.pid!, "SIGKILL"); } catch { child.kill("SIGKILL"); }
        reject(new Error(`harness exceeded ${budgetMs} ms`));
      }, budgetMs);
      child.stdout.on("data", (c) => { out += c; });
      child.stderr.on("data", (c) => { err += c; });
      child.on("error", (e) => { clearTimeout(timer); reject(e); });
      child.on("close", (code) => {
        clearTimeout(timer);
        try {
          const parsed = JSON.parse(out) as { results?: RunResult[] };
          if (!Array.isArray(parsed.results)) throw new Error("no results array");
          resolve(parsed.results);
        } catch (e) {
          reject(new Error(`harness exited ${code}: ${(e as Error).message}\n${err.slice(0, 2000)}`));
        }
      });
      child.stdin.end(JSON.stringify({ jobs }));
    });
  } finally {
    await fs.rm(workdir, { recursive: true, force: true });
  }
}

/** Runs `fn` over `items` with bounded concurrency. */
export async function pool<T, R>(items: T[], limit: number, fn: (item: T) => Promise<R>): Promise<R[]> {
  const out: R[] = new Array(items.length);
  let next = 0;
  const workers = Array.from({ length: Math.max(1, Math.min(limit, items.length)) }, async () => {
    while (next < items.length) {
      const i = next++;
      out[i] = await fn(items[i]);
    }
  });
  await Promise.all(workers);
  return out;
}

/* ───────────────────────── predict answers ───────────────────────── */

export type PredictOutcome = { stdout: string; excType: string | null; timedOut: boolean; error?: string };

export function predictJob(item: Extract<DojoItem, { type: "predict" }>): RunJob {
  return {
    kind: "script",
    files: item.files,
    entry: item.entry,
    ...(item.stdin !== undefined ? { stdin: item.stdin } : {}),
    options: { seed: 0, fakeClock: false, stepBudget: 5_000_000, wallMs: 10_000, asyncTests: false },
  };
}

export function predictOutcome(result: RunResult): PredictOutcome {
  if (result.status === "script") {
    return { stdout: result.stdout, excType: result.exception?.exc ?? null, timedOut: result.timedOut };
  }
  return { stdout: "", excType: null, timedOut: false, error: `${result.status}: ${JSON.stringify(result).slice(0, 300)}` };
}

/** Normalisation used to compare predicted output (§5.1): trailing spaces, newlines. */
export function normalizeOutput(text: string): string {
  return text.replace(/\r\n/g, "\n").split("\n").map((l) => l.replace(/\s+$/, "")).join("\n").replace(/\n+$/, "");
}

/** Writes the generated answer into the bundled predict item. Returns an error message or null. */
export function applyPredictAnswer(loaded: LoadedItem, item: Extract<DojoItem, { type: "predict" }>, outcome: PredictOutcome): string | null {
  if (outcome.error) return `could not run: ${outcome.error}`;
  if (outcome.timedOut) return "the program did not finish within its budget";
  const mode = item.answer.mode;
  if (mode === "exception") {
    if (!outcome.excType) return "answer.mode is exception but the program finished normally";
    item.answer = { mode, excType: outcome.excType };
    return null;
  }
  if (outcome.excType) return `the program raised ${outcome.excType}; use answer.mode "exception" or fix the code`;
  if (mode === "stdout") {
    item.answer = { mode, stdout: outcome.stdout };
    return null;
  }
  const distractors = loaded.extras.predictDistractors ?? [];
  const correctText = normalizeOutput(outcome.stdout);
  if (distractors.some((d) => normalizeOutput(d) === correctText)) return "a distractor equals the real output";
  const options = stableShuffle([correctText, ...distractors.map(normalizeOutput)], `${item.id}:choice`);
  item.answer = { mode: "choice", options, correct: options.indexOf(correctText) };
  return null;
}

/** Fills every predict answer by running it on CPython. Returns issues. */
export async function generatePredictAnswers(entries: { loaded: LoadedItem; item: DojoItem }[]): Promise<Issue[]> {
  const predicts = entries.filter((e): e is { loaded: LoadedItem; item: Extract<DojoItem, { type: "predict" }> } => e.item.type === "predict");
  if (!predicts.length) return [];
  const results = await runHarness(predicts.map((p) => predictJob(p.item)));
  const issues: Issue[] = [];
  predicts.forEach((p, i) => {
    const message = applyPredictAnswer(p.loaded, p.item, predictOutcome(results[i]));
    if (message) issues.push({ file: path.join(p.loaded.dir, "item.json"), path: "answer", message, severity: "error" });
  });
  return issues;
}

export function formatIssues(issues: Issue[]): string {
  return issues
    .map((i) => `${i.severity === "error" ? "✗" : "!"} ${rel(i.file)}${i.path && i.path !== "$" ? ` › ${i.path}` : ""}: ${i.message}`)
    .join("\n");
}
