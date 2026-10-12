/**
 * The app's data edge: static content (fetched from `content/`, built by
 * `npm run content:build`) and the learner store (IndexedDB, on this device).
 *
 * Nothing leaves the device. The functions keep request/response shapes
 * (`core/contract.ts`) so a synced backend could replace them later.
 */
import type {
  AttemptRequest,
  AttemptResponse,
  DojoSession,
  DojoStateResponse,
  FinishSessionRequest,
  FinishSessionResponse,
  StartSessionRequest,
} from "../core/contract";
import {
  parseDojoManifest,
  parseDojoPointer,
  type DojoContentPointer,
  type DojoItem,
  type DojoItemIndexRow,
  type DojoManifest,
  type DojoUnitBundle,
} from "../core/content-schema";
import { unitKcs } from "../core/composer";
import { localRef, schedulerParams, seriesOfRef, type SchedulerParams } from "../core/series";
import { emptyLearnerDb, exportLearnerDb, finishSession, parseLearnerExport, readState, recordAttempt, startSession } from "../store/learner-db";
import { getLearnerStore } from "../store/learner-store";

/** A failed operation, carrying a stable code the UI translates. */
export class DojoApiError extends Error {
  readonly code: string;
  readonly status: number;
  constructor(code: string, status = 0) {
    super(code);
    this.code = code;
    this.status = status;
  }
}

async function json<T>(input: string, init?: RequestInit): Promise<T> {
  let response: Response;
  try {
    response = await fetch(input, init);
  } catch {
    throw new DojoApiError("NETWORK");
  }
  if (!response.ok) throw new DojoApiError(`HTTP_${response.status}`, response.status);
  try {
    return (await response.json()) as T;
  } catch {
    throw new DojoApiError("CONTENT_INVALID");
  }
}

/* ───────────────────────── content (static files) ───────────────────────── */

const contentRoot = () => `${import.meta.env.BASE_URL.replace(/\/$/, "")}/content`;

/** The current content build: its hash and the series it ships. Never cached. */
export async function loadContentPointer(): Promise<DojoContentPointer> {
  const parsed = parseDojoPointer(await json<unknown>(`${contentRoot()}/current.json`, { cache: "no-store" }));
  if (!parsed.ok) throw new DojoApiError("CONTENT_INVALID");
  if (!parsed.value.series.length) throw new DojoApiError("CONTENT_EMPTY");
  return parsed.value;
}

/** What the store needs to grade an attempt, per item: registered when a manifest loads. */
type ItemContext = { row: DojoItemIndexRow; unitKcIds: readonly string[]; params: SchedulerParams };
const itemContext = new Map<string, ItemContext>();

function registerManifest(manifest: DojoManifest) {
  const params = schedulerParams(manifest.series.scheduler);
  const kcsByUnit = new Map(manifest.graph.units.map((unit) => [unit.id, unitKcs(unit)]));
  for (const row of manifest.items) itemContext.set(row.id, { row, unitKcIds: kcsByUnit.get(row.unit) ?? [], params });
}

/** One series' manifest; content-hashed paths, so the browser may cache it. */
export async function loadSeriesManifest(hash: string, series: string): Promise<DojoManifest> {
  const raw = await json<unknown>(`${contentRoot()}/${hash}/series/${encodeURIComponent(series)}/manifest.json`, { cache: "force-cache" });
  const parsed = parseDojoManifest(raw);
  if (!parsed.ok || parsed.value.series.id !== series) throw new DojoApiError("CONTENT_INVALID");
  registerManifest(parsed.value);
  return parsed.value;
}

const unitCache = new Map<string, Promise<DojoItem[]>>();

/** Items of one unit bundle; shared and cached per content hash. */
export function loadUnit(contentHash: string, unitId: string): Promise<DojoItem[]> {
  const key = `${contentHash}/${unitId}`;
  let pending = unitCache.get(key);
  if (!pending) {
    const series = seriesOfRef(unitId) ?? "";
    pending = json<DojoUnitBundle>(
      `${contentRoot()}/${contentHash}/series/${encodeURIComponent(series)}/units/${encodeURIComponent(localRef(unitId))}.json`,
      { cache: "force-cache" },
    ).then((bundle) => {
      if (!bundle || bundle.contentHash !== contentHash || bundle.unit !== unitId || !Array.isArray(bundle.items)) throw new DojoApiError("CONTENT_INVALID");
      return bundle.items;
    });
    pending.catch(() => unitCache.delete(key));
    unitCache.set(key, pending);
  }
  return pending;
}

/* ───────────────────────── learner state ───────────────────────── */

export async function fetchDojoState(localDay: string, contentHash: string | null = null): Promise<DojoStateResponse> {
  return readState(await getLearnerStore().read(), localDay, contentHash, new Date());
}

export function startDojoSession(body: StartSessionRequest): Promise<{ session: DojoSession }> {
  return getLearnerStore().write((db) => {
    const out = startSession(db, body, new Date());
    return { db: out.db, result: { session: out.session } };
  });
}

export async function finishDojoSession(body: FinishSessionRequest): Promise<FinishSessionResponse> {
  const out = await getLearnerStore().write((db) => {
    const r = finishSession(db, body, new Date());
    return { db: r.ok ? r.db : db, result: r };
  });
  if (!out.ok) throw new DojoApiError(out.code, 404);
  return out.value;
}

/* ───────────────────────── attempts ───────────────────────── */

export type AttemptBody = Omit<AttemptRequest, "locale"> & { locale: string };

export type AttemptOutcome = { ok: true; response: AttemptResponse } | { ok: false; code: string };

/** Writes not yet saved, and whether the last save failed. */
export type QueueStatus = { pending: number; failing: boolean };

/**
 * Records attempts in the local store. Kept as a queue (the interface the
 * session hook uses) so a future synced backend can batch and retry here.
 */
export class AttemptQueue {
  private pending = 0;
  private failing = false;
  private inflight = new Set<Promise<AttemptOutcome>>();
  private listeners = new Set<(status: QueueStatus) => void>();

  get status(): QueueStatus {
    return { pending: this.pending, failing: this.failing };
  }

  subscribe(listener: (status: QueueStatus) => void) {
    this.listeners.add(listener);
    listener(this.status);
    return () => {
      this.listeners.delete(listener);
    };
  }

  enqueue(body: AttemptBody): Promise<AttemptOutcome> {
    const ctx = itemContext.get(body.itemId);
    if (!ctx) return Promise.resolve({ ok: false, code: "NOT_FOUND" });
    this.pending += 1;
    this.emit();
    const run: Promise<AttemptOutcome> = getLearnerStore()
      .write((db) => {
        const r = recordAttempt(db, { ...body, locale: body.locale as AttemptRequest["locale"] }, { ...ctx, now: new Date() });
        const outcome: AttemptOutcome = r.ok ? { ok: true, response: r.value } : { ok: false, code: r.code };
        return { db: r.ok ? r.db : db, result: outcome };
      })
      .then((outcome) => {
        this.failing = false;
        return outcome;
      })
      .catch((): AttemptOutcome => {
        // Storage refused the write (quota, private mode): say so, keep playing.
        this.failing = true;
        return { ok: false, code: "STORAGE" };
      })
      .finally(() => {
        this.pending -= 1;
        this.inflight.delete(run);
        this.emit();
      });
    this.inflight.add(run);
    return run;
  }

  /** Resolves once every recorded attempt is saved; false if a save failed. */
  async drain(): Promise<boolean> {
    await Promise.all([...this.inflight]);
    return !this.failing;
  }

  private emit() {
    const status = this.status;
    for (const listener of this.listeners) listener(status);
  }
}

let queue: AttemptQueue | null = null;

export function getAttemptQueue() {
  queue ??= new AttemptQueue();
  return queue;
}

/** `dja-` / `djs-` ids: the store's idempotency keys. */
export function newDojoId(prefix: "dja" | "djs") {
  const uuid = typeof crypto !== "undefined" && "randomUUID" in crypto
    ? crypto.randomUUID()
    : `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 12)}`;
  return `${prefix}-${uuid}`;
}

/* ───────────────────────── learner data ───────────────────────── */

export async function learnerSummary() {
  const db = await getLearnerStore().read();
  return { totalXp: db.profile.totalXp, attempts: db.attempts.length, kcs: Object.keys(db.kcs).length };
}

export function learnerStorageDurable() {
  return getLearnerStore().backend.durable;
}

/** The learner document as a downloadable JSON file. */
export async function exportLearnerFile(): Promise<Blob> {
  const db = await getLearnerStore().read();
  return new Blob([JSON.stringify(exportLearnerDb(db, new Date()), null, 2)], { type: "application/json" });
}

/** Replaces this device's progress with an exported file; null on success. */
export async function importLearnerFile(text: string): Promise<"format" | "version" | null> {
  let value: unknown;
  try {
    value = JSON.parse(text);
  } catch {
    return "format";
  }
  const parsed = parseLearnerExport(value);
  if (!parsed.ok) return parsed.reason;
  await getLearnerStore().write(() => ({ db: parsed.db, result: null }));
  return null;
}

export async function resetLearner(): Promise<void> {
  await getLearnerStore().write(() => ({ db: emptyLearnerDb(), result: null }));
}
