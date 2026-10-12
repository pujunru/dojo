/**
 * Dojo content schema (docs/CONTENT.md).
 *
 * One discriminated union, `DojoItem`, describes every bundled item. This file
 * holds the types and the runtime normalisers that the build script, the
 * validator and the app all share, so it must stay free of browser-only and
 * Node-only imports.
 *
 * Execution model: an item either needs no execution (`runtime: "none"`) or
 * is graded by running code (`runtime: "sandbox:python"`) through a code
 * runner the build registers (`runner.ts`). Authoring files say `"sandbox"`;
 * the build resolves it to the series' sandbox runtime.
 */
import { defaultLocale, locales, type Locale } from "../i18n/config";
import type { HarnessOptions, PyFile } from "./run-protocol";
import { FAULTS, PY_PACKAGES } from "./run-protocol";
import { DEFAULT_SCHEDULER, isSandboxRuntime, isSeriesId, parseSeriesConfig, RUNTIME_IDS, type RuntimeId, type SeriesConfig, type SeriesSummary } from "./series";
import type { SkillGraph } from "./skill-graph";

export type { PyFile, HarnessOptions } from "./run-protocol";

/** The locales every L10n must carry, in fallback order. */
export const CONTENT_LOCALES: readonly Locale[] = locales;

/** One Markdown string per supported locale. Code, identifiers and data stay out. */
export type L10n = Record<Locale, string>;

export const DOJO_ITEM_TYPES = [
  "predict", "spot-bug", "fill-blank", "parsons", "choose-design",
  "implement", "refactor", "write-tests", "ladder", "explain", "review", "case",
] as const;
export type DojoItemType = (typeof DOJO_ITEM_TYPES)[number];

/** Item types the MVP player renders. */
export const MVP_ITEM_TYPES = [
  "predict", "spot-bug", "fill-blank", "parsons", "choose-design", "implement", "explain",
] as const satisfies readonly DojoItemType[];

/**
 * Accepted Parsons orders listed in an item. Items with tests are graded by
 * running the assembled program (any order that passes is full credit, see
 * grading.ts scoreParsons), so the list only has to be exhaustive for items
 * without tests; it is capped to bound the bundle, not the set of valid orders.
 */
export const PARSONS_MAX_SOLUTIONS = 64;

/**
 * Types that may stand in for a harder type in a lesson's coverage: the
 * validator's coverage report counts them towards that type's bar.
 */
export const PHASE2_STAND_INS: Partial<Record<DojoItemType, readonly DojoItemType[]>> = {
  refactor: ["implement"],
  "write-tests": ["implement", "spot-bug", "predict"],
  review: ["spot-bug"],
  ladder: ["implement"],
};

/** Any archetype a series declares; the content build checks it against `series.json`. */
export type Archetype = string;

/**
 * Production-strength ladder of item types under the default scheduler. A
 * series may re-rank types (`series.json` → `scheduler.rungOf`); code that
 * schedules uses that series' `SchedulerParams.rungOf`.
 */
export const RUNG_OF: Record<DojoItemType, 0 | 1 | 2 | 3 | 4 | 5> = DEFAULT_SCHEDULER.rungOf;

/** How an item's answer is checked; see `series.ts`. */
export const RUNTIMES = RUNTIME_IDS;
export type Runtime = RuntimeId;

/** Types whose answer is checked by executing code, hence a sandbox runtime. */
export const EXECUTING_ITEM_TYPES = [
  "implement", "refactor", "write-tests", "ladder",
] as const satisfies readonly DojoItemType[];

export type KcRef = { id: string; weight: 1 | 0.5 };          // 1 = primary KC, 0.5 = secondary
export type TestMeta = { id: string; kcs: string[]; hidden: boolean; title?: L10n };
export type RubricCriterion = {
  id: string;
  kcs: string[];
  weight: number;
  description: L10n;
  /** Terms a good answer names (any language); the model answer must contain them. */
  mustMention?: string[];
  /**
   * Phrases that fail this criterion when the answer contains them (case- and
   * space-insensitive), e.g. ["BLEU", "perplexity"] for "does not use a
   * proxy metric". Decided by the phrase check, not by the learner.
   */
  forbidden?: string[];
};
export type Rubric = { criteria: RubricCriterion[]; passAt: number /* 0..1 */ };

type ItemBase = {
  id: string;               // /^dj-[a-z0-9][a-z0-9-]{2,79}$/
  version: number;          // bumped on semantic change; attempts record it
  unit: string;
  lesson: string;
  kcs: KcRef[];             // exactly one weight=1
  archetype: Archetype;
  skin: string;             // e.g. "bank" | "gpu-ledger" | "crawler"
  variantGroup?: string;    // equivalent variants, mutually exclusive in a session
  difficulty: 1 | 2 | 3 | 4 | 5;
  estSeconds: number;       // fluent completion time, for fluency and time budgets
  runtime: Runtime;
  prompt: L10n;
  explanation: L10n;        // always shown after answering
  hints: L10n[];            // ordered static hints; AI hints only once exhausted
  followUps?: { question: L10n; rubric: Rubric }[];
};

export type PredictItem = ItemBase & {
  type: "predict";
  files: PyFile[]; entry: string; stdin?: string;
  answer:
    | { mode: "stdout"; stdout: string }                      // generated at build time on CPython
    | { mode: "choice"; options: string[]; correct: number }  // author distractors + generated correct option
    | { mode: "exception"; excType: string };
  schedule?: L10n;          // thread items: the author-fixed interleaving
};

export type SpotBugItem = ItemBase & {
  type: "spot-bug";
  files: PyFile[];
  bugs: { path: string; lines: number[]; kcs: string[] }[];
  tolerance: number;
  fixStage?: { tests: PyFile; testMeta: TestMeta[]; options: HarnessOptions };
};

export type FillBlankItem = ItemBase & {
  type: "fill-blank";
  template: PyFile[];                                 // contains `# __BLANK:<id>__` markers
  blanks: { id: string; accept: string[]; kcs: string[] }[];
  tests?: { tests: PyFile; testMeta: TestMeta[]; options: HarnessOptions };
};

export type ParsonsItem = ItemBase & {
  type: "parsons";
  lines: { id: string; code: string; indent: number }[];
  solutions: string[][];
  /** `replaces`: the solution line id this distractor imitates (shown on reveal). */
  distractors: { id: string; code: string; replaces?: string }[];
  requireIndent: boolean;
  /** Path the assembled program is written to when `tests` run (e.g. "solution.py"). */
  module?: string;
  tests?: { tests: PyFile; testMeta: TestMeta[]; options: HarnessOptions };
};

export type ChooseDesignItem = ItemBase & {
  type: "choose-design";
  scenario: L10n;
  options: { id: string; text: L10n; correct: boolean; why: L10n }[];
  multi: boolean;
  rationale?: Rubric;
};

type CodeTask = {
  starter: PyFile[];
  solution: PyFile[];
  tests: PyFile;
  testMeta: TestMeta[];
  visibleTests?: PyFile;
  mustKill: { id: string; files: PyFile[]; description: L10n }[];
  options: HarnessOptions;
};

export type ImplementItem = ItemBase & { type: "implement" } & CodeTask;

export type RefactorItem = ItemBase & {
  type: "refactor";
  baseline: PyFile[];
  newRequirement: L10n;
  constraints: { publicApi: string[]; maxChangedLinesHint?: number };
  qualityRubric?: Rubric;
} & CodeTask;

export type WriteTestsItem = ItemBase & {
  type: "write-tests";
  subject: PyFile[];
  spec: L10n;
  testStarter: PyFile;
  mutants: { id: string; files: PyFile[]; kcs: string[]; description: L10n }[];
  killTarget: number;
  options: HarnessOptions;
};

export type LadderLevel = {
  id: string; title: L10n; prompt: L10n; timeboxMin: number;
  kcs: string[]; tests: PyFile; testMeta: TestMeta[]; solution: PyFile[];
};
export type LadderItem = ItemBase & {
  type: "ladder";
  starter: PyFile[];
  levels: LadderLevel[];
  options: HarnessOptions;
  checkpointFor?: string;
};

export type ExplainItem = ItemBase & {
  type: "explain";
  question: L10n;
  context?: PyFile[];
  rubric: Rubric;
  modelAnswer: L10n;
};

/**
 * A staged case: the interview shape of a discussion round. Stage 1 asks for
 * an approach to the scenario; each later stage reveals a new constraint (the
 * twist) and asks again. Stages are shown one at a time -- a stage appears
 * only after the previous one has been answered and judged -- and each has its
 * own rubric, whose criteria carry KCs back to the learner model. The item's
 * q is the weight-averaged stage q.
 *
 * Doubles as a unit checkpoint (`checkpointFor`, like a ladder) and as a
 * simulation (`simulation`: a timed full round in the Simulation tab, with
 * no sandbox needed).
 */
export type CaseStage = {
  id: string;
  /** What this stage reveals or asks ("模型升级后升级率一夜翻倍，你怎么查？"). */
  question: L10n;
  rubric: Rubric;
  modelAnswer: L10n;
  /** Stage weight in the item score; default 1. */
  weight?: number;
};

export type CaseItem = ItemBase & {
  type: "case";
  /** The opening scenario, shown above every stage. */
  scenario: L10n;
  stages: CaseStage[];
  context?: PyFile[];
  /** Unit id: passing this case (within 1.25x its time) is the unit's checkpoint. */
  checkpointFor?: string;
  /** Listed in the Simulation tab as a full timed round. */
  simulation?: { minutes: number };
};

export type ReviewItem = ItemBase & {
  type: "review";
  diff: string;
  context: PyFile[];
  issues: { id: string; path: string; line: number; kcs: string[];
            severity: "blocker" | "major" | "minor"; category: string; description: L10n }[];
  tolerance: number;
};

export type DojoItem =
  | PredictItem | SpotBugItem | FillBlankItem | ParsonsItem | ChooseDesignItem
  | ImplementItem | RefactorItem | WriteTestsItem | LadderItem
  | ExplainItem | ReviewItem | CaseItem;

export type DojoItemOf<T extends DojoItemType> = Extract<DojoItem, { type: T }>;

/** Lightweight manifest row: all session composition needs. */
export type DojoItemIndexRow = Pick<DojoItem,
  "id" | "version" | "type" | "unit" | "lesson" | "kcs" | "archetype" | "skin" |
  "variantGroup" | "difficulty" | "estSeconds" | "runtime"> & {
  /** Ladders and cases: the unit this item is the checkpoint of. */
  checkpointFor?: string;
  /** Cases: listed as a timed simulation of this many minutes. */
  simulationMinutes?: number;
};

/** `public/content/<hash>/series/<series>/manifest.json`: one series. */
export type DojoManifest = {
  contentHash: string;
  schemaVersion: 2;
  series: SeriesConfig;
  graph: SkillGraph;
  items: DojoItemIndexRow[];
};

/** `public/content/<hash>/series/<series>/units/<series-local unit id>.json`. */
export type DojoUnitBundle = {
  contentHash: string;
  schemaVersion: 2;
  series: string;
  unit: string;
  items: DojoItem[];
};

/** `public/content/current.json`: the build and the series it ships. */
export type DojoContentPointer = { hash: string; schemaVersion: 2; series: SeriesSummary[] };

export const DOJO_SCHEMA_VERSION = 2 as const;
export const DOJO_ITEM_ID = /^dj-[a-z0-9_][a-z0-9-]{2,95}$/;
/**
 * KC / unit / lesson / generic ids: lowercase, dots, dashes, underscores,
 * optionally qualified with the series (`python:py-dict-idioms`).
 */
export const DOJO_REF_ID = /^(?:_?[a-z][a-z0-9]{1,15}:)?[a-z0-9_][a-z0-9._-]{0,99}$/;
export const BLANK_MARKER = /# __BLANK:([a-z0-9_-]+)__/g;

/** Hard size limits enforced by the validator (characters). */
export const LIMITS = {
  l10n: 6_000,
  shortL10n: 600,
  pyFile: 24_000,
  itemJson: 200_000,
  hints: 5,
  files: 12,
} as const;

export function primaryKc(item: Pick<DojoItem, "kcs">): string {
  return item.kcs.find((kc) => kc.weight === 1)?.id ?? item.kcs[0]?.id ?? "";
}

export function toIndexRow(item: DojoItem): DojoItemIndexRow {
  return {
    id: item.id,
    version: item.version,
    type: item.type,
    unit: item.unit,
    lesson: item.lesson,
    kcs: item.kcs.map((kc) => ({ id: kc.id, weight: kc.weight })),
    archetype: item.archetype,
    skin: item.skin,
    ...(item.variantGroup ? { variantGroup: item.variantGroup } : {}),
    difficulty: item.difficulty,
    estSeconds: item.estSeconds,
    runtime: item.runtime,
    ...((item.type === "ladder" || item.type === "case") && item.checkpointFor ? { checkpointFor: item.checkpointFor } : {}),
    ...(item.type === "case" && item.simulation ? { simulationMinutes: item.simulation.minutes } : {}),
  };
}

/** Picks the locale's text, falling back to the default locale, then any non-empty value. */
export function pickL10n(text: L10n | undefined, locale: Locale): string {
  if (!text) return "";
  return text[locale] || text[defaultLocale] || Object.values(text).find(Boolean) || "";
}

/* ───────────────────────── runtime validation ───────────────────────── */

export type SchemaError = { path: string; message: string };
export type ParseResult<T> = { ok: true; value: T } | { ok: false; errors: SchemaError[] };
export type ParseItemResult = { ok: true; item: DojoItem } | { ok: false; errors: SchemaError[] };

type Obj = Record<string, unknown>;

/** Collects errors with JSON-ish paths while walking an untrusted value. */
class Checker {
  errors: SchemaError[] = [];
  err(path: string, message: string) {
    this.errors.push({ path, message });
  }
  obj(v: unknown, path: string): Obj | null {
    if (typeof v === "object" && v !== null && !Array.isArray(v)) return v as Obj;
    this.err(path, "expected an object");
    return null;
  }
  arr(v: unknown, path: string, { min = 0, max = Infinity } = {}): unknown[] | null {
    if (!Array.isArray(v)) {
      this.err(path, "expected an array");
      return null;
    }
    if (v.length < min) this.err(path, `expected at least ${min} entries`);
    if (v.length > max) this.err(path, `expected at most ${max} entries`);
    return v;
  }
  str(v: unknown, path: string, { min = 1, max = 100_000, pattern }: { min?: number; max?: number; pattern?: RegExp } = {}): string {
    if (typeof v !== "string") {
      this.err(path, "expected a string");
      return "";
    }
    if (v.length < min) this.err(path, min === 1 ? "must not be empty" : `shorter than ${min}`);
    if (v.length > max) this.err(path, `longer than ${max} characters`);
    if (pattern && !pattern.test(v)) this.err(path, `does not match ${pattern}`);
    return v;
  }
  optStr(v: unknown, path: string, opts?: { min?: number; max?: number; pattern?: RegExp }): string | undefined {
    return v === undefined ? undefined : this.str(v, path, opts);
  }
  num(v: unknown, path: string, { min = -Infinity, max = Infinity, int = false } = {}): number {
    if (typeof v !== "number" || !Number.isFinite(v)) {
      this.err(path, "expected a finite number");
      return 0;
    }
    if (int && !Number.isInteger(v)) this.err(path, "expected an integer");
    if (v < min || v > max) this.err(path, `expected ${min}..${max}`);
    return v;
  }
  bool(v: unknown, path: string): boolean {
    if (typeof v !== "boolean") {
      this.err(path, "expected a boolean");
      return false;
    }
    return v;
  }
  oneOf<T extends string>(v: unknown, path: string, allowed: readonly T[]): T {
    if (typeof v !== "string" || !allowed.includes(v as T)) {
      this.err(path, `expected one of ${allowed.join(" | ")}`);
      return allowed[0];
    }
    return v as T;
  }
  l10n(v: unknown, path: string, max: number = LIMITS.l10n): L10n {
    const o = this.obj(v, path);
    const out = {} as L10n;
    if (!o) return out;
    for (const locale of CONTENT_LOCALES) {
      const text = o[locale];
      if (typeof text !== "string" || !text.trim()) this.err(`${path}.${locale}`, "missing translation");
      else if (text.length > max) this.err(`${path}.${locale}`, `longer than ${max} characters`);
      out[locale] = typeof text === "string" ? text : "";
    }
    for (const key of Object.keys(o)) {
      if (!(CONTENT_LOCALES as readonly string[]).includes(key)) this.err(`${path}.${key}`, "unsupported locale");
    }
    return out;
  }
  optL10n(v: unknown, path: string, max?: number): L10n | undefined {
    return v === undefined ? undefined : this.l10n(v, path, max);
  }
  id(v: unknown, path: string): string {
    return this.str(v, path, { max: 100, pattern: DOJO_REF_ID });
  }
  ids(v: unknown, path: string, { min = 0 } = {}): string[] {
    const a = this.arr(v, path, { min });
    return a ? a.map((x, i) => this.id(x, `${path}[${i}]`)) : [];
  }
  pyFile(v: unknown, path: string): PyFile {
    const o = this.obj(v, path);
    if (!o) return { path: "", content: "" };
    const p = this.str(o.path, `${path}.path`, { max: 200, pattern: /^(?!\/)(?!.*\.\.)[A-Za-z0-9_./-]+$/ });
    const content = typeof o.content === "string" ? o.content : (this.err(`${path}.content`, "expected a string"), "");
    if (content.length > LIMITS.pyFile) this.err(`${path}.content`, `longer than ${LIMITS.pyFile} characters`);
    return { path: p, content };
  }
  pyFiles(v: unknown, path: string, { min = 1 } = {}): PyFile[] {
    const a = this.arr(v, path, { min, max: LIMITS.files });
    if (!a) return [];
    const files = a.map((x, i) => this.pyFile(x, `${path}[${i}]`));
    const seen = new Set<string>();
    files.forEach((f, i) => {
      if (seen.has(f.path)) this.err(`${path}[${i}].path`, `duplicate path ${f.path}`);
      seen.add(f.path);
    });
    return files;
  }
  options(v: unknown, path: string): HarnessOptions {
    const o = this.obj(v, path);
    if (!o) return { seed: 0, fakeClock: false, stepBudget: 2_000_000, wallMs: 8_000, asyncTests: false };
    const out: HarnessOptions = {
      seed: this.num(o.seed, `${path}.seed`, { int: true, min: 0, max: 2 ** 31 }),
      fakeClock: this.bool(o.fakeClock, `${path}.fakeClock`),
      stepBudget: this.num(o.stepBudget, `${path}.stepBudget`, { int: true, min: 1_000, max: 50_000_000 }),
      wallMs: this.num(o.wallMs, `${path}.wallMs`, { int: true, min: 500, max: 120_000 }),
      asyncTests: this.bool(o.asyncTests, `${path}.asyncTests`),
    };
    if (o.faults !== undefined) {
      const a = this.arr(o.faults, `${path}.faults`);
      out.faults = (a ?? []).map((f, i) => this.oneOf(f, `${path}.faults[${i}]`, FAULTS));
    }
    if (o.packages !== undefined) {
      const a = this.arr(o.packages, `${path}.packages`);
      out.packages = (a ?? []).map((p, i) => this.oneOf(p, `${path}.packages[${i}]`, PY_PACKAGES));
    }
    if (o.memoryHintMb !== undefined) out.memoryHintMb = this.num(o.memoryHintMb, `${path}.memoryHintMb`, { min: 16, max: 4096 });
    if (o.memoryMb !== undefined) out.memoryMb = this.num(o.memoryMb, `${path}.memoryMb`, { int: true, min: 0, max: 4096 });
    if (o.testWallMs !== undefined) out.testWallMs = this.num(o.testWallMs, `${path}.testWallMs`, { int: true, min: 100, max: 120_000 });
    return out;
  }
  testMeta(v: unknown, path: string): TestMeta[] {
    const a = this.arr(v, path, { min: 1 });
    if (!a) return [];
    const seen = new Set<string>();
    return a.map((x, i) => {
      const o = this.obj(x, `${path}[${i}]`);
      if (!o) return { id: "", kcs: [], hidden: true };
      const id = this.str(o.id, `${path}[${i}].id`, { max: 120, pattern: /^test_[A-Za-z0-9_]+$/ });
      if (seen.has(id)) this.err(`${path}[${i}].id`, `duplicate test id ${id}`);
      seen.add(id);
      const meta: TestMeta = { id, kcs: this.ids(o.kcs, `${path}[${i}].kcs`, { min: 1 }), hidden: this.bool(o.hidden, `${path}[${i}].hidden`) };
      const title = this.optL10n(o.title, `${path}[${i}].title`, LIMITS.shortL10n);
      if (title) meta.title = title;
      return meta;
    });
  }
  testStage(v: unknown, path: string): { tests: PyFile; testMeta: TestMeta[]; options: HarnessOptions } {
    const o = this.obj(v, path) ?? {};
    return {
      tests: this.pyFile(o.tests, `${path}.tests`),
      testMeta: this.testMeta(o.testMeta, `${path}.testMeta`),
      options: this.options(o.options, `${path}.options`),
    };
  }
  rubric(v: unknown, path: string): Rubric {
    const o = this.obj(v, path);
    if (!o) return { criteria: [], passAt: 0 };
    const a = this.arr(o.criteria, `${path}.criteria`, { min: 1, max: 12 }) ?? [];
    const seen = new Set<string>();
    const criteria = a.map((x, i) => {
      const c = this.obj(x, `${path}.criteria[${i}]`) ?? {};
      const id = this.id(c.id, `${path}.criteria[${i}].id`);
      if (seen.has(id)) this.err(`${path}.criteria[${i}].id`, `duplicate criterion ${id}`);
      seen.add(id);
      const crit: RubricCriterion = {
        id,
        kcs: this.ids(c.kcs, `${path}.criteria[${i}].kcs`, { min: 1 }),
        weight: this.num(c.weight, `${path}.criteria[${i}].weight`, { min: 0.01, max: 100 }),
        description: this.l10n(c.description, `${path}.criteria[${i}].description`, LIMITS.shortL10n * 2),
      };
      if (c.mustMention !== undefined) {
        const m = this.arr(c.mustMention, `${path}.criteria[${i}].mustMention`) ?? [];
        crit.mustMention = m.map((s, j) => this.str(s, `${path}.criteria[${i}].mustMention[${j}]`, { max: 80 }));
      }
      if (c.forbidden !== undefined) {
        const f = this.arr(c.forbidden, `${path}.criteria[${i}].forbidden`, { min: 1, max: 12 }) ?? [];
        crit.forbidden = f.map((s, j) => this.str(s, `${path}.criteria[${i}].forbidden[${j}]`, { max: 80 }));
      }
      return crit;
    });
    return { criteria, passAt: this.num(o.passAt, `${path}.passAt`, { min: 0, max: 1 }) };
  }
  mutants(v: unknown, path: string, { withKcs }: { withKcs: boolean }) {
    const a = this.arr(v, path) ?? [];
    const seen = new Set<string>();
    return a.map((x, i) => {
      const o = this.obj(x, `${path}[${i}]`) ?? {};
      const id = this.id(o.id, `${path}[${i}].id`);
      if (seen.has(id)) this.err(`${path}[${i}].id`, `duplicate mutant ${id}`);
      seen.add(id);
      return {
        id,
        files: this.pyFiles(o.files, `${path}[${i}].files`),
        ...(withKcs ? { kcs: this.ids(o.kcs, `${path}[${i}].kcs`, { min: 1 }) } : {}),
        description: this.l10n(o.description, `${path}[${i}].description`, LIMITS.shortL10n),
      };
    });
  }
}

function parseBase(c: Checker, o: Obj): ItemBase {
  const kcsRaw = c.arr(o.kcs, "kcs", { min: 1, max: 4 }) ?? [];
  const kcs: KcRef[] = kcsRaw.map((x, i) => {
    const k = c.obj(x, `kcs[${i}]`) ?? {};
    const weight = k.weight === 1 || k.weight === 0.5 ? k.weight : (c.err(`kcs[${i}].weight`, "expected 1 or 0.5"), 0.5 as const);
    return { id: c.id(k.id, `kcs[${i}].id`), weight };
  });
  if (kcs.filter((kc) => kc.weight === 1).length !== 1) c.err("kcs", "exactly one KC must have weight 1");
  if (new Set(kcs.map((kc) => kc.id)).size !== kcs.length) c.err("kcs", "duplicate KC id");

  const hintsRaw = c.arr(o.hints, "hints", { max: LIMITS.hints }) ?? [];
  const base: ItemBase = {
    id: c.str(o.id, "id", { pattern: DOJO_ITEM_ID }),
    version: c.num(o.version, "version", { int: true, min: 1 }),
    unit: c.id(o.unit, "unit"),
    lesson: c.id(o.lesson, "lesson"),
    kcs,
    archetype: c.str(o.archetype, "archetype", { max: 41, pattern: /^[a-z0-9][a-z0-9-]{0,40}$/ }),
    skin: c.str(o.skin, "skin", { max: 40, pattern: /^[a-z0-9][a-z0-9-]*$/ }),
    difficulty: c.num(o.difficulty, "difficulty", { int: true, min: 1, max: 5 }) as ItemBase["difficulty"],
    estSeconds: c.num(o.estSeconds, "estSeconds", { int: true, min: 5, max: 3 * 3600 }),
    runtime: c.oneOf(o.runtime, "runtime", RUNTIMES),
    prompt: c.l10n(o.prompt, "prompt"),
    explanation: c.l10n(o.explanation, "explanation"),
    hints: hintsRaw.map((h, i) => c.l10n(h, `hints[${i}]`, LIMITS.shortL10n * 2)),
  };
  const vg = c.optStr(o.variantGroup, "variantGroup", { max: 80, pattern: DOJO_REF_ID });
  if (vg) base.variantGroup = vg;
  if (o.followUps !== undefined) {
    const f = c.arr(o.followUps, "followUps", { max: 5 }) ?? [];
    base.followUps = f.map((x, i) => {
      const fu = c.obj(x, `followUps[${i}]`) ?? {};
      return { question: c.l10n(fu.question, `followUps[${i}].question`, LIMITS.shortL10n * 2), rubric: c.rubric(fu.rubric, `followUps[${i}].rubric`) };
    });
  }
  return base;
}

function parseCodeTask(c: Checker, o: Obj): CodeTask {
  const task: CodeTask = {
    starter: c.pyFiles(o.starter, "starter"),
    solution: c.pyFiles(o.solution, "solution"),
    tests: c.pyFile(o.tests, "tests"),
    testMeta: c.testMeta(o.testMeta, "testMeta"),
    mustKill: c.mutants(o.mustKill, "mustKill", { withKcs: false }) as CodeTask["mustKill"],
    options: c.options(o.options, "options"),
  };
  if (o.visibleTests !== undefined) task.visibleTests = c.pyFile(o.visibleTests, "visibleTests");
  return task;
}

function parseByType(c: Checker, o: Obj, base: ItemBase): DojoItem {
  const type = c.oneOf(o.type, "type", DOJO_ITEM_TYPES);
  switch (type) {
    case "predict": {
      const a = c.obj(o.answer, "answer") ?? {};
      const mode = c.oneOf(a.mode, "answer.mode", ["stdout", "choice", "exception"] as const);
      let answer: PredictItem["answer"];
      if (mode === "stdout") answer = { mode, stdout: typeof a.stdout === "string" ? a.stdout : (c.err("answer.stdout", "expected a string"), "") };
      else if (mode === "choice") {
        const options = (c.arr(a.options, "answer.options", { min: 2, max: 6 }) ?? []).map((s, i) => c.str(s, `answer.options[${i}]`, { min: 0, max: 2_000 }));
        const correct = c.num(a.correct, "answer.correct", { int: true, min: 0, max: Math.max(0, options.length - 1) });
        if (new Set(options).size !== options.length) c.err("answer.options", "options must be distinct");
        answer = { mode, options, correct };
      } else answer = { mode, excType: c.str(a.excType, "answer.excType", { max: 80, pattern: /^[A-Za-z_][A-Za-z0-9_.]*$/ }) };
      const item: PredictItem = { ...base, type, files: c.pyFiles(o.files, "files"), entry: c.str(o.entry, "entry", { max: 200 }), answer };
      if (o.stdin !== undefined) item.stdin = c.str(o.stdin, "stdin", { min: 0, max: 10_000 });
      const schedule = c.optL10n(o.schedule, "schedule");
      if (schedule) item.schedule = schedule;
      if (item.files.length && !item.files.some((f) => f.path === item.entry)) c.err("entry", `entry ${item.entry} is not one of files`);
      return item;
    }
    case "spot-bug": {
      const files = c.pyFiles(o.files, "files");
      const bugs = (c.arr(o.bugs, "bugs", { min: 1, max: 6 }) ?? []).map((x, i) => {
        const b = c.obj(x, `bugs[${i}]`) ?? {};
        const lines = (c.arr(b.lines, `bugs[${i}].lines`, { min: 1 }) ?? []).map((n, j) => c.num(n, `bugs[${i}].lines[${j}]`, { int: true, min: 1 }));
        const path = c.str(b.path, `bugs[${i}].path`, { max: 200 });
        const file = files.find((f) => f.path === path);
        if (!file) c.err(`bugs[${i}].path`, `${path} is not one of files`);
        else {
          const count = file.content.split("\n").length;
          lines.forEach((n, j) => { if (n > count) c.err(`bugs[${i}].lines[${j}]`, `line ${n} beyond end of ${path} (${count} lines)`); });
        }
        return { path, lines, kcs: c.ids(b.kcs, `bugs[${i}].kcs`, { min: 1 }) };
      });
      const item: SpotBugItem = { ...base, type, files, bugs, tolerance: c.num(o.tolerance, "tolerance", { int: true, min: 0, max: 3 }) };
      if (o.fixStage !== undefined) item.fixStage = c.testStage(o.fixStage, "fixStage");
      return item;
    }
    case "fill-blank": {
      const template = c.pyFiles(o.template, "template");
      const blanks = (c.arr(o.blanks, "blanks", { min: 1, max: 8 }) ?? []).map((x, i) => {
        const b = c.obj(x, `blanks[${i}]`) ?? {};
        return {
          id: c.str(b.id, `blanks[${i}].id`, { max: 40, pattern: /^[a-z0-9_-]+$/ }),
          accept: (c.arr(b.accept, `blanks[${i}].accept`, { min: 1, max: 12 }) ?? []).map((s, j) => c.str(s, `blanks[${i}].accept[${j}]`, { max: 300 })),
          kcs: c.ids(b.kcs, `blanks[${i}].kcs`, { min: 1 }),
        };
      });
      const markers = new Set<string>();
      for (const f of template) for (const m of f.content.matchAll(BLANK_MARKER)) markers.add(m[1]);
      const declared = new Set(blanks.map((b) => b.id));
      if (declared.size !== blanks.length) c.err("blanks", "duplicate blank id");
      for (const id of declared) if (!markers.has(id)) c.err("blanks", `blank ${id} has no # __BLANK:${id}__ marker in template`);
      for (const id of markers) if (!declared.has(id)) c.err("template", `marker ${id} is not declared in blanks`);
      const item: FillBlankItem = { ...base, type, template, blanks };
      if (o.tests !== undefined) item.tests = c.testStage(o.tests, "tests");
      return item;
    }
    case "parsons": {
      const lines = (c.arr(o.lines, "lines", { min: 2, max: 40 }) ?? []).map((x, i) => {
        const l = c.obj(x, `lines[${i}]`) ?? {};
        return {
          id: c.str(l.id, `lines[${i}].id`, { max: 20, pattern: /^[a-z0-9_-]+$/ }),
          code: c.str(l.code, `lines[${i}].code`, { max: 300 }),
          indent: c.num(l.indent, `lines[${i}].indent`, { int: true, min: 0, max: 8 }),
        };
      });
      const distractors = (c.arr(o.distractors, "distractors", { max: 8 }) ?? []).map((x, i) => {
        const d = c.obj(x, `distractors[${i}]`) ?? {};
        const replaces = d.replaces === undefined ? undefined : c.str(d.replaces, `distractors[${i}].replaces`, { max: 80 });
        return { id: c.str(d.id, `distractors[${i}].id`, { max: 20, pattern: /^[a-z0-9_-]+$/ }), code: c.str(d.code, `distractors[${i}].code`, { max: 300 }), ...(replaces ? { replaces } : {}) };
      });
      const ids = new Set([...lines.map((l) => l.id), ...distractors.map((d) => d.id)]);
      if (ids.size !== lines.length + distractors.length) c.err("lines", "line and distractor ids must be unique");
      const lineIds = new Set(lines.map((l) => l.id));
      const solutions = (c.arr(o.solutions, "solutions", { min: 1, max: PARSONS_MAX_SOLUTIONS }) ?? []).map((x, i) => {
        const s = (c.arr(x, `solutions[${i}]`, { min: 1 }) ?? []).map((v, j) => c.str(v, `solutions[${i}][${j}]`, { max: 20 }));
        if (s.length !== lines.length || new Set(s).size !== s.length || s.some((id) => !lineIds.has(id))) {
          c.err(`solutions[${i}]`, "must be a permutation of every line id");
        }
        return s;
      });
      const item: ParsonsItem = { ...base, type, lines, solutions, distractors, requireIndent: c.bool(o.requireIndent, "requireIndent") };
      const module = c.optStr(o.module, "module", { max: 200 });
      if (module) item.module = module;
      if (o.tests !== undefined) {
        item.tests = c.testStage(o.tests, "tests");
        if (!item.module) c.err("module", "required when tests are present");
      }
      return item;
    }
    case "choose-design": {
      const options = (c.arr(o.options, "options", { min: 2, max: 6 }) ?? []).map((x, i) => {
        const opt = c.obj(x, `options[${i}]`) ?? {};
        return {
          id: c.str(opt.id, `options[${i}].id`, { max: 20, pattern: /^[a-z0-9_-]+$/ }),
          text: c.l10n(opt.text, `options[${i}].text`, LIMITS.shortL10n * 2),
          correct: c.bool(opt.correct, `options[${i}].correct`),
          why: c.l10n(opt.why, `options[${i}].why`, LIMITS.shortL10n * 2),
        };
      });
      const multi = c.bool(o.multi, "multi");
      const correct = options.filter((x) => x.correct).length;
      if (correct === 0) c.err("options", "at least one option must be correct");
      if (!multi && correct !== 1) c.err("options", "single-choice items need exactly one correct option");
      if (new Set(options.map((x) => x.id)).size !== options.length) c.err("options", "duplicate option id");
      const item: ChooseDesignItem = { ...base, type, scenario: c.l10n(o.scenario, "scenario"), options, multi };
      if (o.rationale !== undefined) item.rationale = c.rubric(o.rationale, "rationale");
      return item;
    }
    case "implement":
      return { ...base, type, ...parseCodeTask(c, o) };
    case "refactor": {
      const cons = c.obj(o.constraints, "constraints") ?? {};
      const constraints: RefactorItem["constraints"] = { publicApi: (c.arr(cons.publicApi, "constraints.publicApi") ?? []).map((s, i) => c.str(s, `constraints.publicApi[${i}]`, { max: 120 })) };
      if (cons.maxChangedLinesHint !== undefined) constraints.maxChangedLinesHint = c.num(cons.maxChangedLinesHint, "constraints.maxChangedLinesHint", { int: true, min: 1 });
      const item: RefactorItem = {
        ...base, type, ...parseCodeTask(c, o),
        baseline: c.pyFiles(o.baseline, "baseline"),
        newRequirement: c.l10n(o.newRequirement, "newRequirement"),
        constraints,
      };
      if (o.qualityRubric !== undefined) item.qualityRubric = c.rubric(o.qualityRubric, "qualityRubric");
      return item;
    }
    case "write-tests":
      return {
        ...base, type,
        subject: c.pyFiles(o.subject, "subject"),
        spec: c.l10n(o.spec, "spec"),
        testStarter: c.pyFile(o.testStarter, "testStarter"),
        mutants: c.mutants(o.mutants, "mutants", { withKcs: true }) as WriteTestsItem["mutants"],
        killTarget: c.num(o.killTarget, "killTarget", { min: 0.1, max: 1 }),
        options: c.options(o.options, "options"),
      };
    case "ladder": {
      const levels = (c.arr(o.levels, "levels", { min: 2, max: 6 }) ?? []).map((x, i): LadderLevel => {
        const l = c.obj(x, `levels[${i}]`) ?? {};
        return {
          id: c.id(l.id, `levels[${i}].id`),
          title: c.l10n(l.title, `levels[${i}].title`, LIMITS.shortL10n),
          prompt: c.l10n(l.prompt, `levels[${i}].prompt`),
          timeboxMin: c.num(l.timeboxMin, `levels[${i}].timeboxMin`, { min: 1, max: 60 }),
          kcs: c.ids(l.kcs, `levels[${i}].kcs`, { min: 1 }),
          tests: c.pyFile(l.tests, `levels[${i}].tests`),
          testMeta: c.testMeta(l.testMeta, `levels[${i}].testMeta`),
          solution: c.pyFiles(l.solution, `levels[${i}].solution`),
        };
      });
      const item: LadderItem = { ...base, type, starter: c.pyFiles(o.starter, "starter"), levels, options: c.options(o.options, "options") };
      const cp = c.optStr(o.checkpointFor, "checkpointFor", { max: 100, pattern: DOJO_REF_ID });
      if (cp) item.checkpointFor = cp;
      return item;
    }
    case "explain": {
      const item: ExplainItem = {
        ...base, type,
        question: c.l10n(o.question, "question"),
        rubric: c.rubric(o.rubric, "rubric"),
        modelAnswer: c.l10n(o.modelAnswer, "modelAnswer"),
      };
      if (o.context !== undefined) item.context = c.pyFiles(o.context, "context");
      return item;
    }
    case "case": {
      const stages = (c.arr(o.stages, "stages", { min: 2, max: 8 }) ?? []).map((x, i) => {
        const st = c.obj(x, `stages[${i}]`) ?? {};
        const stage: CaseStage = {
          id: c.id(st.id, `stages[${i}].id`),
          question: c.l10n(st.question, `stages[${i}].question`),
          rubric: c.rubric(st.rubric, `stages[${i}].rubric`),
          modelAnswer: c.l10n(st.modelAnswer, `stages[${i}].modelAnswer`),
        };
        if (st.weight !== undefined) stage.weight = c.num(st.weight, `stages[${i}].weight`, { min: 0.1, max: 10 });
        return stage;
      });
      if (new Set(stages.map((st) => st.id)).size !== stages.length) c.err("stages", "stage ids must be unique");
      const item: CaseItem = { ...base, type, scenario: c.l10n(o.scenario, "scenario"), stages };
      if (o.context !== undefined) item.context = c.pyFiles(o.context, "context");
      const cp = c.optStr(o.checkpointFor, "checkpointFor", { max: 100, pattern: DOJO_REF_ID });
      if (cp) item.checkpointFor = cp;
      if (o.simulation !== undefined) {
        const sim = c.obj(o.simulation, "simulation") ?? {};
        item.simulation = { minutes: c.num(sim.minutes, "simulation.minutes", { int: true, min: 10, max: 120 }) };
      }
      return item;
    }
    case "review": {
      const issues = (c.arr(o.issues, "issues", { min: 1, max: 12 }) ?? []).map((x, i) => {
        const r = c.obj(x, `issues[${i}]`) ?? {};
        return {
          id: c.id(r.id, `issues[${i}].id`),
          path: c.str(r.path, `issues[${i}].path`, { max: 200 }),
          line: c.num(r.line, `issues[${i}].line`, { int: true, min: 1 }),
          kcs: c.ids(r.kcs, `issues[${i}].kcs`, { min: 1 }),
          severity: c.oneOf(r.severity, `issues[${i}].severity`, ["blocker", "major", "minor"] as const),
          category: c.str(r.category, `issues[${i}].category`, { max: 40 }),
          description: c.l10n(r.description, `issues[${i}].description`, LIMITS.shortL10n * 2),
        };
      });
      return {
        ...base, type,
        diff: c.str(o.diff, "diff", { max: 60_000 }),
        context: c.pyFiles(o.context, "context", { min: 0 }),
        issues,
        tolerance: c.num(o.tolerance, "tolerance", { int: true, min: 0, max: 3 }),
      };
    }
  }
}

/**
 * Parses an untrusted bundled item. Checks the structure and every intra-item
 * invariant that needs no outside knowledge (the skill graph and execution are
 * the validator's job).
 */
export function parseDojoItem(value: unknown): ParseItemResult {
  const c = new Checker();
  const o = c.obj(value, "$");
  if (!o) return { ok: false, errors: c.errors };
  const base = parseBase(c, o);
  const item = parseByType(c, o, base);

  const needsSandbox = (EXECUTING_ITEM_TYPES as readonly string[]).includes(item.type);
  if (needsSandbox && !isSandboxRuntime(item.runtime)) c.err("runtime", `${item.type} items execute code: runtime must be a sandbox runtime`);
  if (!needsSandbox && isSandboxRuntime(item.runtime) && !hasOptionalExecution(item)) {
    c.err("runtime", `${item.type} item has nothing to execute: runtime must be "none"`);
  }

  // Every KC mentioned anywhere inside the item must be declared on the item.
  const declared = new Set(item.kcs.map((kc) => kc.id));
  for (const [path, id] of nestedKcs(item)) {
    if (!declared.has(id)) c.err(path, `KC ${id} is not listed in the item's kcs`);
  }
  return c.errors.length ? { ok: false, errors: c.errors } : { ok: true, item };
}

/** spot-bug/fill-blank/parsons may carry tests the client can run in the sandbox. */
function hasOptionalExecution(item: DojoItem): boolean {
  return (item.type === "spot-bug" && !!item.fixStage)
    || (item.type === "fill-blank" && !!item.tests)
    || (item.type === "parsons" && !!item.tests);
}

/** [path, kcId] for every KC reference below the item's own `kcs`. */
export function nestedKcs(item: DojoItem): [string, string][] {
  const out: [string, string][] = [];
  const meta = (path: string, list: TestMeta[]) => list.forEach((t, i) => t.kcs.forEach((k) => out.push([`${path}[${i}].kcs`, k])));
  const rubric = (path: string, r?: Rubric) => r?.criteria.forEach((cr, i) => cr.kcs.forEach((k) => out.push([`${path}.criteria[${i}].kcs`, k])));
  item.followUps?.forEach((f, i) => rubric(`followUps[${i}].rubric`, f.rubric));
  switch (item.type) {
    case "spot-bug":
      item.bugs.forEach((b, i) => b.kcs.forEach((k) => out.push([`bugs[${i}].kcs`, k])));
      if (item.fixStage) meta("fixStage.testMeta", item.fixStage.testMeta);
      break;
    case "fill-blank":
      item.blanks.forEach((b, i) => b.kcs.forEach((k) => out.push([`blanks[${i}].kcs`, k])));
      if (item.tests) meta("tests.testMeta", item.tests.testMeta);
      break;
    case "parsons":
      if (item.tests) meta("tests.testMeta", item.tests.testMeta);
      break;
    case "choose-design":
      rubric("rationale", item.rationale);
      break;
    case "implement":
      meta("testMeta", item.testMeta);
      break;
    case "refactor":
      meta("testMeta", item.testMeta);
      rubric("qualityRubric", item.qualityRubric);
      break;
    case "write-tests":
      item.mutants.forEach((m, i) => m.kcs.forEach((k) => out.push([`mutants[${i}].kcs`, k])));
      break;
    case "ladder":
      item.levels.forEach((l, i) => {
        l.kcs.forEach((k) => out.push([`levels[${i}].kcs`, k]));
        meta(`levels[${i}].testMeta`, l.testMeta);
      });
      break;
    case "explain":
      rubric("rubric", item.rubric);
      break;
    case "review":
      item.issues.forEach((r, i) => r.kcs.forEach((k) => out.push([`issues[${i}].kcs`, k])));
      break;
    default:
      break;
  }
  return out;
}

/** Every KC id the item touches (own + nested), deduplicated. */
export function allKcIds(item: DojoItem): string[] {
  return [...new Set([...item.kcs.map((kc) => kc.id), ...nestedKcs(item).map(([, id]) => id)])];
}

export function formatSchemaErrors(errors: SchemaError[], prefix = ""): string {
  return errors.map((e) => `${prefix}${e.path}: ${e.message}`).join("\n");
}

/** Parses a manifest fetched from static assets (graph is trusted as built). */
export function parseDojoManifest(value: unknown): ParseResult<DojoManifest> {
  const c = new Checker();
  const o = c.obj(value, "$");
  if (!o) return { ok: false, errors: c.errors };
  c.str(o.contentHash, "contentHash", { pattern: /^[0-9a-f]{12}$/ });
  if (o.schemaVersion !== DOJO_SCHEMA_VERSION) c.err("schemaVersion", `expected ${DOJO_SCHEMA_VERSION}`);
  c.obj(o.graph, "graph");
  c.arr(o.items, "items");
  const series = parseSeriesConfig(o.series);
  if (!series.ok) c.err("series", series.errors.join("; "));
  return c.errors.length ? { ok: false, errors: c.errors } : { ok: true, value: o as unknown as DojoManifest };
}

/** `current.json`: the build hash and the series it ships, in order. */
export function parseDojoPointer(value: unknown): ParseResult<DojoContentPointer> {
  const c = new Checker();
  const o = c.obj(value, "$");
  if (!o) return { ok: false, errors: c.errors };
  c.str(o.hash, "hash", { pattern: /^[0-9a-f]{12}$/ });
  if (o.schemaVersion !== DOJO_SCHEMA_VERSION) c.err("schemaVersion", `expected ${DOJO_SCHEMA_VERSION}`);
  const list = c.arr(o.series, "series") ?? [];
  list.forEach((entry, i) => {
    const e = c.obj(entry, `series[${i}]`);
    if (e && !isSeriesId(e.id)) c.err(`series[${i}].id`, "not a series id");
  });
  return c.errors.length ? { ok: false, errors: c.errors } : { ok: true, value: o as unknown as DojoContentPointer };
}
