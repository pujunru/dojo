/**
 * Series: independent curricula (say, Python coding drills and ML eval design)
 * that share one engine, one learner profile and one daily streak.
 *
 * IDS ARE NAMESPACED AT BUILD TIME. Authors write series-local ids
 * (`dj-flu-predict-x`, `py-dict-idioms`, `u-py-fluency`); the content build
 * qualifies every one of them with the series it lives in:
 *
 *   item          dj-<local>          ->  dj-<series>-<local>
 *   KC/unit/lesson/tier/variant group
 *                 <local>             ->  <series>:<local>
 *
 * so ids are unique across series by construction and an item can never
 * reference another series' KC (it has no way to spell one). Everything at
 * runtime -- bundles and the learner store -- sees qualified ids.
 *
 * A series id is lowercase alphanumerics with no hyphen, so the series of an
 * item id is the segment between `dj-` and the next `-`.
 */
import type { DojoItemType } from "./content-schema";

export const SERIES_ID = /^[a-z][a-z0-9]{1,15}$/;
/** Series directories starting with `_` are fixtures: validated, never shipped to production. */
export const FIXTURE_SERIES_ID = /^_[a-z][a-z0-9]{1,15}$/;

export function isSeriesId(value: unknown): value is string {
  return typeof value === "string" && (SERIES_ID.test(value) || FIXTURE_SERIES_ID.test(value));
}

/* ───────────────────────── namespacing ───────────────────────── */

export function qualifyItemId(series: string, localId: string): string {
  return `dj-${series}-${localId.replace(/^dj-/, "")}`;
}

export function qualifyRef(series: string, localId: string): string {
  return `${series}:${localId}`;
}

/** `python:py-dict-idioms` → `python`; an unqualified ref → null. */
export function seriesOfRef(ref: string): string | null {
  const at = ref.indexOf(":");
  return at > 0 ? ref.slice(0, at) : null;
}

/** `dj-python-flu-x` → `python`. */
export function seriesOfItemId(id: string): string | null {
  const match = /^dj-(_?[a-z][a-z0-9]{1,15})-/.exec(id);
  return match ? match[1] : null;
}

/** The part an author wrote: `python:py-dict-idioms` → `py-dict-idioms`. */
export function localRef(ref: string): string {
  const at = ref.indexOf(":");
  return at > 0 ? ref.slice(at + 1) : ref;
}

/* ───────────────────────── runtimes ───────────────────────── */

/**
 * How an item's answer is checked. Pluggable: each runtime names the item
 * types it can grade, and a build of the app says which runtimes it has.
 *
 * - `none`            graded in the browser: choices, lines, blanks, order, and
 *                     rubric self-checks for written answers.
 * - `sandbox:python`  executed by a registered code runner (hidden tests,
 *                     mutants; `core/runner.ts`). Without one, such items are
 *                     filtered out and their KCs substituted.
 */
export const RUNTIME_IDS = ["none", "sandbox:python"] as const;
export type RuntimeId = (typeof RUNTIME_IDS)[number];

export const RUNTIME_ITEM_TYPES: Record<RuntimeId, readonly DojoItemType[]> = {
  none: ["predict", "spot-bug", "fill-blank", "parsons", "choose-design", "explain", "review", "case"],
  "sandbox:python": ["predict", "spot-bug", "fill-blank", "parsons", "implement", "refactor", "write-tests", "ladder"],
};

/** Which runtimes this build of the app can serve. */
export type RuntimeAvailability = Partial<Record<RuntimeId, boolean>>;

export function isRuntimeId(value: unknown): value is RuntimeId {
  return typeof value === "string" && (RUNTIME_IDS as readonly string[]).includes(value);
}

export function runtimeAvailable(runtime: string, avail: RuntimeAvailability): boolean {
  if (runtime === "none") return true;
  return isRuntimeId(runtime) && avail[runtime] === true;
}

/** True for runtimes that execute code (through a registered runner). */
export function isSandboxRuntime(runtime: string): boolean {
  return runtime.startsWith("sandbox:");
}

/* ───────────────────────── scheduler parameters ───────────────────────── */

export type Rung = 0 | 1 | 2 | 3 | 4 | 5;

/**
 * The parts of the learner model a series may tune. Rungs are the
 * "production strength" ladder: what counts as recognising (0), partially
 * producing (1), producing (2), extending (3), and timed / full simulations
 * (4, 5). A code series and a discussion series place item types on it
 * differently.
 */
export type SchedulerParams = {
  rungOf: Record<DojoItemType, Rung>;
  /** Half-life growth weight per item type. */
  gainOf: Record<DojoItemType, number>;
  /** Half-life ceiling (days) while the KC's best rung is below 2 / below 3. */
  capBelowProductionDays: number;
  capBelowExtensionDays: number;
  /** Highest rung the session composer may pick; ladders and cases above it are launched explicitly. */
  maxComposedRung: Rung;
};

export const DEFAULT_SCHEDULER: SchedulerParams = {
  rungOf: {
    predict: 0, parsons: 0, "choose-design": 0,
    "fill-blank": 1, "spot-bug": 1, explain: 1,
    implement: 2, review: 2,
    refactor: 3, "write-tests": 3,
    ladder: 4,
    // A staged case is a timed multi-part round, like a ladder.
    case: 4,
  },
  gainOf: {
    predict: 0.6, parsons: 0.6, "choose-design": 0.6,
    "fill-blank": 0.8, "spot-bug": 0.9, explain: 0.9,
    review: 1.0, implement: 1.2, "write-tests": 1.2,
    refactor: 1.3, ladder: 1.5, case: 1.5,
  },
  capBelowProductionDays: 7,
  capBelowExtensionDays: 30,
  maxComposedRung: 3,
};

/** What `series.json` may override; everything else comes from the defaults. */
export type SchedulerOverrides = {
  rungOf?: Partial<Record<DojoItemType, Rung>>;
  gainOf?: Partial<Record<DojoItemType, number>>;
  capBelowProductionDays?: number;
  capBelowExtensionDays?: number;
  maxComposedRung?: Rung;
};

export function schedulerParams(overrides?: SchedulerOverrides | null): SchedulerParams {
  if (!overrides) return DEFAULT_SCHEDULER;
  return {
    rungOf: { ...DEFAULT_SCHEDULER.rungOf, ...overrides.rungOf },
    gainOf: { ...DEFAULT_SCHEDULER.gainOf, ...overrides.gainOf },
    capBelowProductionDays: overrides.capBelowProductionDays ?? DEFAULT_SCHEDULER.capBelowProductionDays,
    capBelowExtensionDays: overrides.capBelowExtensionDays ?? DEFAULT_SCHEDULER.capBelowExtensionDays,
    maxComposedRung: overrides.maxComposedRung ?? DEFAULT_SCHEDULER.maxComposedRung,
  };
}

/* ───────────────────────── series config ───────────────────────── */

/** `content/series/<id>/series.json`, shipped in the manifest as-is. */
export type SeriesConfig = {
  id: string;
  order: number;
  title_zh: string;
  title_en: string;
  description_zh?: string;
  description_en?: string;
  /** The archetypes items in this series may declare. */
  archetypes: string[];
  /** Runtimes items in this series may use. */
  runtimes: RuntimeId[];
  /** What an item's `"runtime": "sandbox"` means in this series. */
  sandboxRuntime?: RuntimeId;
  scheduler?: SchedulerOverrides;
};

/** The short entry the top-level content pointer lists. */
export type SeriesSummary = Pick<SeriesConfig, "id" | "order" | "title_zh" | "title_en" | "description_zh" | "description_en">;

export type SeriesConfigResult = { ok: true; value: SeriesConfig } | { ok: false; errors: string[] };

export function parseSeriesConfig(value: unknown, expectedId?: string): SeriesConfigResult {
  const errors: string[] = [];
  const o = (value && typeof value === "object" ? value : {}) as Record<string, unknown>;
  const str = (k: string, required = true) => {
    const v = o[k];
    if (typeof v === "string" && v.trim()) return v;
    if (required) errors.push(`${k}: required string`);
    return undefined;
  };
  const id = str("id");
  if (id && !isSeriesId(id)) errors.push(`id: must match ${SERIES_ID} (or _<id> for a fixture series)`);
  if (id && expectedId && id !== expectedId) errors.push(`id: "${id}" does not match its directory "${expectedId}"`);
  const order = typeof o.order === "number" && Number.isFinite(o.order) ? o.order : (errors.push("order: required number"), 0);
  const archetypes = Array.isArray(o.archetypes) && o.archetypes.every((a) => typeof a === "string" && /^[a-z0-9][a-z0-9-]{0,40}$/.test(a))
    ? (o.archetypes as string[])
    : (errors.push("archetypes: required list of kebab-case ids"), []);
  if (!archetypes.length) errors.push("archetypes: at least one");
  const runtimes = Array.isArray(o.runtimes) && o.runtimes.every(isRuntimeId)
    ? (o.runtimes as RuntimeId[])
    : (errors.push(`runtimes: list of ${RUNTIME_IDS.join(" | ")}`), []);
  if (!runtimes.includes("none")) errors.push('runtimes: must include "none"');
  const sandboxRuntime = o.sandboxRuntime === undefined ? undefined : isRuntimeId(o.sandboxRuntime) ? o.sandboxRuntime : (errors.push("sandboxRuntime: unknown runtime"), undefined);
  if (sandboxRuntime && !runtimes.includes(sandboxRuntime)) errors.push("sandboxRuntime: must be one of runtimes");
  const scheduler = o.scheduler === undefined ? undefined : (o.scheduler as SchedulerOverrides);
  if (scheduler) {
    for (const [type, rung] of Object.entries(scheduler.rungOf ?? {})) {
      if (!(type in DEFAULT_SCHEDULER.rungOf) || !Number.isInteger(rung) || (rung as number) < 0 || (rung as number) > 5) errors.push(`scheduler.rungOf.${type}: rung 0..5 for a known item type`);
    }
    for (const [type, gain] of Object.entries(scheduler.gainOf ?? {})) {
      if (!(type in DEFAULT_SCHEDULER.gainOf) || typeof gain !== "number" || gain <= 0 || gain > 3) errors.push(`scheduler.gainOf.${type}: 0 < gain <= 3 for a known item type`);
    }
    for (const k of ["capBelowProductionDays", "capBelowExtensionDays"] as const) {
      const v = scheduler[k];
      if (v !== undefined && (typeof v !== "number" || v <= 0 || v > 365)) errors.push(`scheduler.${k}: 0 < days <= 365`);
    }
  }
  if (errors.length) return { ok: false, errors };
  return {
    ok: true,
    value: {
      id: id!,
      order,
      title_zh: str("title_zh")!,
      title_en: str("title_en")!,
      ...(str("description_zh", false) ? { description_zh: o.description_zh as string } : {}),
      ...(str("description_en", false) ? { description_en: o.description_en as string } : {}),
      archetypes,
      runtimes,
      ...(sandboxRuntime ? { sandboxRuntime } : {}),
      ...(scheduler ? { scheduler } : {}),
    },
  };
}

export function seriesSummary(config: SeriesConfig): SeriesSummary {
  return {
    id: config.id,
    order: config.order,
    title_zh: config.title_zh,
    title_en: config.title_en,
    ...(config.description_zh ? { description_zh: config.description_zh } : {}),
    ...(config.description_en ? { description_en: config.description_en } : {}),
  };
}
