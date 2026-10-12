/**
 * The learner store: sessions, attempts, finishing, idempotency, streak
 * freezes, checkpoints, export / import, and the serialised writer.
 */
import assert from "node:assert/strict";
import { test } from "node:test";
import type { DojoItemIndexRow, DojoItemType } from "../src/core/content-schema.ts";
import type { AttemptRequest } from "../src/core/contract.ts";
import { addDays } from "../src/core/learner-model.ts";
import { DEFAULT_SCHEDULER } from "../src/core/series.ts";
import {
  emptyLearnerDb,
  exportLearnerDb,
  finishSession,
  parseLearnerExport,
  readState,
  recordAttempt,
  startSession,
  updateProfile,
  type LearnerDb,
} from "../src/store/learner-db.ts";
import { LearnerStore, MemoryBackend } from "../src/store/learner-store.ts";

const T0 = new Date("2026-10-05T08:00:00.000Z");
const at = (days: number) => new Date(T0.getTime() + days * 86_400_000);
const fixedRand = () => 0.5;
const DAY = "2026-10-05";

function row(id: string, type: DojoItemType, kc: string, extra: Partial<DojoItemIndexRow> = {}): DojoItemIndexRow {
  return {
    id, version: 1, type, unit: extra.unit ?? "u1", lesson: "l1",
    kcs: extra.kcs ?? [{ id: kc, weight: 1 }], archetype: "core", skin: "bank",
    difficulty: 1, estSeconds: extra.estSeconds ?? 60, runtime: "none",
    ...(extra.checkpointFor ? { checkpointFor: extra.checkpointFor } : {}),
  };
}

function attempt(over: Partial<AttemptRequest> = {}): AttemptRequest {
  return {
    id: "dja-1", sessionId: "djs-1", itemId: "dj-a", itemVersion: 1, contentHash: "h", runtime: "none",
    startedAt: T0.toISOString(), answeredAt: T0.toISOString(), localDay: DAY, locale: "en-US",
    signal: { q: 1, latencyMs: 30_000 }, answer: { choice: 0 }, ...over,
  };
}

function ok<T extends { ok: boolean }>(r: T): Extract<T, { ok: true }> {
  assert.ok(r.ok, JSON.stringify(r));
  return r as Extract<T, { ok: true }>;
}

test("session → attempts → idempotent retry → finish → state", () => {
  const item = row("dj-a", "explain", "a", { kcs: [{ id: "a", weight: 1 }, { id: "b", weight: 0.5 }], estSeconds: 120 });
  const ctx = { row: item, unitKcIds: ["a", "b"], params: DEFAULT_SCHEDULER, now: T0, rand: fixedRand };
  let db: LearnerDb = emptyLearnerDb();

  const s1 = startSession(db, { id: "djs-1", kind: "daily", planned: [{ itemId: "dj-a", kcId: "a", reason: "new" }], contentHash: "h", localDay: DAY, series: "demo" }, T0);
  assert.equal(s1.created, true);
  db = s1.db;
  assert.equal(startSession(db, { id: "djs-1", kind: "daily", planned: [], contentHash: "h", localDay: DAY }, T0).created, false);

  const r1 = ok(recordAttempt(db, attempt({ signal: { q: 0.5, qByKc: { a: 1, b: 0 }, latencyMs: 60_000 } }), ctx));
  db = r1.db;
  assert.equal(r1.value.duplicate, false);
  assert.deepEqual(r1.value.kcUpdates.map((k) => [k.kcId, k.grade]), [["a", 4], ["b", 1]], "60 s on a 120 s item: Easy for a, Again for b");
  const xp1 = r1.value.attempt.xp;
  assert.equal(db.profile.totalXp, xp1);
  assert.equal(db.sessions["djs-1"].itemsDone, 1);
  assert.equal(db.kcs.a.seen, 1);

  // A retry of the same attempt is a duplicate and changes nothing.
  const again = ok(recordAttempt(db, attempt(), ctx));
  assert.equal(again.value.duplicate, true);
  assert.equal(again.db, db);

  const r2 = ok(recordAttempt(db, attempt({ id: "dja-2" }), { ...ctx, now: at(0.01) }));
  db = r2.db;
  assert.ok(r2.value.attempt.passed);

  assert.deepEqual(recordAttempt(db, attempt({ id: "dja-3", sessionId: "djs-ghost" }), ctx), { ok: false, code: "NOT_FOUND" });
  assert.deepEqual(recordAttempt(db, attempt({ id: "dja-4", signal: { q: "x" } }), ctx), { ok: false, code: "INVALID_SIGNAL" });

  const finishReq = { id: "djs-1", patch: { finishedAt: at(0.02).toISOString(), activeSec: 300 }, localDay: DAY };
  const fin = ok(finishSession(db, finishReq, at(0.02)));
  db = fin.db;
  assert.equal(fin.value.streakChange, "extended");
  assert.equal(fin.value.profile.streakCurrent, 1);
  assert.equal(fin.value.session.accuracy, 0.5);
  assert.ok(fin.value.bonusXp > 0);
  const refinish = ok(finishSession(db, finishReq, at(0.03)));
  assert.equal(refinish.value.streakChange, "unchanged");
  assert.equal(refinish.value.bonusXp, 0);
  assert.equal(refinish.db, db);

  assert.deepEqual(recordAttempt(db, attempt({ id: "dja-5" }), ctx), { ok: false, code: "SESSION_CLOSED" });

  // One open session per series: a new one in the same series abandons the old.
  db = startSession(db, { id: "djs-2", kind: "daily", planned: [], contentHash: "h", localDay: DAY, series: "demo" }, T0).db;
  db = startSession(db, { id: "djs-3", kind: "lesson", lessonId: "l1", planned: [], contentHash: "h", localDay: DAY, series: "demo" }, T0).db;
  db = startSession(db, { id: "djs-4", kind: "daily", planned: [], contentHash: "h", localDay: DAY, series: "other" }, T0).db;
  assert.equal(db.sessions["djs-2"].abandoned, true);
  assert.equal(db.sessions["djs-3"].finishedAt, null);

  db = updateProfile(db, { dailyGoalXp: 10 }, DAY, T0).db;
  const state = readState(db, DAY, "h", at(0.05));
  assert.equal(state.profile.dailyGoalXp, 10);
  assert.equal(state.kcs.length, 2);
  assert.equal(state.items[0].seen, 2);
  assert.equal(state.today.goalMet, true);
  assert.deepEqual(state.openSessions.map((s) => s.id).sort(), ["djs-3", "djs-4"]);
  assert.equal(state.lastSessionAccuracy, 0.5);
  assert.equal(state.dueCount, 0, "both KCs were just practised");

  const tomorrow = readState(db, "2026-10-06", "h", at(1));
  assert.equal(tomorrow.profile.atRisk, true);
  assert.ok(tomorrow.dueCount >= 1, "short first-week half-lives are due by tomorrow");
  assert.equal(readState(db, "2026-10-07", "h", at(2)).profile.streakCurrent, 0);
});

test("a freeze bridges a missed day and records it; an abandoned session does not count", () => {
  const item = row("dj-a", "predict", "a");
  let db = emptyLearnerDb();
  db = { ...db, profile: { ...db.profile, streakCurrent: 7, streakBest: 7, lastActiveDay: "2026-10-03", freezes: 1 } };
  db = startSession(db, { id: "djs-1", kind: "daily", planned: [], contentHash: "h", localDay: DAY }, T0).db;
  db = ok(recordAttempt(db, attempt(), { row: item, unitKcIds: ["a"], params: DEFAULT_SCHEDULER, now: T0 })).db;
  const fin = ok(finishSession(db, { id: "djs-1", patch: { finishedAt: T0.toISOString(), activeSec: 60 }, localDay: DAY }, T0));
  assert.equal(fin.value.streakChange, "kept-by-freeze");
  assert.equal(fin.value.profile.streakCurrent, 8);
  assert.equal(fin.value.profile.freezes, 0);
  assert.equal(fin.db.days["2026-10-04"].freezeUsed, true);

  let db2 = startSession(emptyLearnerDb(), { id: "djs-9", kind: "daily", planned: [], contentHash: "h", localDay: DAY }, T0).db;
  const ab = ok(finishSession(db2, { id: "djs-9", patch: { finishedAt: T0.toISOString(), activeSec: 5, abandoned: true }, localDay: DAY }, T0));
  db2 = ab.db;
  assert.equal(ab.value.streakChange, "unchanged");
  assert.equal(ab.value.session.abandoned, true);
  assert.deepEqual(finishSession(db2, { id: "djs-x", patch: { finishedAt: T0.toISOString(), activeSec: 5 }, localDay: DAY }, T0), { ok: false, code: "NOT_FOUND" });
});

test("a timed pass of a checkpoint case records the checkpoint and lifts the crown gate", () => {
  const cp = row("dj-cp", "case", "a", { unit: "u", estSeconds: 900, checkpointFor: "u" });
  let db = emptyLearnerDb();
  db = {
    ...db,
    kcs: {
      a: { kcId: "a", halfLifeDays: 30, lastSeenAt: T0.toISOString(), nextDueAt: addDays(T0, 10).toISOString(), seen: 5, correct: 5, lapses: 0, streak: 5, mastery: 4, bestRung: 4, bestRungAt: T0.toISOString(), remedialUntil: null },
    },
  };
  const out = ok(recordAttempt(db, attempt({ sessionId: null, itemId: cp.id, signal: { q: 1, qByKc: { a: 1 }, latencyMs: 600_000 } }), { row: cp, unitKcIds: ["a"], params: DEFAULT_SCHEDULER, now: T0, rand: fixedRand }));
  assert.equal(out.value.checkpointPassed, true);
  assert.equal(out.db.units.u.checkpointPassedAt, T0.toISOString());
  assert.ok(out.db.units.u.crowns >= 4, `crown above the gate, got ${out.db.units.u.crowns}`);
});

test("export / import round-trips; foreign or newer files are refused", () => {
  let db = startSession(emptyLearnerDb(), { id: "djs-1", kind: "daily", planned: [], contentHash: "h", localDay: DAY }, T0).db;
  db = ok(recordAttempt(db, attempt(), { row: row("dj-a", "predict", "a"), unitKcIds: ["a"], params: DEFAULT_SCHEDULER, now: T0 })).db;
  const file = JSON.parse(JSON.stringify(exportLearnerDb(db, T0)));
  const back = parseLearnerExport(file);
  assert.ok(back.ok);
  if (back.ok) assert.deepEqual(back.db, db);
  assert.deepEqual(parseLearnerExport({ hello: 1 }), { ok: false, reason: "format" });
  assert.deepEqual(parseLearnerExport({ ...file, db: { ...file.db, version: 99 } }), { ok: false, reason: "version" });
});

test("the store serialises writes, saves each result, and survives a failing op", async () => {
  const backend = new MemoryBackend();
  const store = new LearnerStore(backend);
  const item = row("dj-a", "predict", "a");
  await store.write((db) => ({ db: startSession(db, { id: "djs-1", kind: "daily", planned: [], contentHash: "h", localDay: DAY }, T0).db, result: null }));
  // Two answers in the same tick: both land, in order.
  const [a, b] = await Promise.all(["dja-1", "dja-2"].map((id) => store.write((db) => {
    const r = ok(recordAttempt(db, attempt({ id }), { row: item, unitKcIds: ["a"], params: DEFAULT_SCHEDULER, now: T0 }));
    return { db: r.db, result: r.value.attempt.id };
  })));
  assert.deepEqual([a, b], ["dja-1", "dja-2"]);
  await assert.rejects(store.write(() => { throw new Error("boom"); }));
  const db = await store.read();
  assert.equal(db.sessions["djs-1"].itemsDone, 2);
  assert.deepEqual((await backend.load())?.attempts.map((x) => x.id), ["dja-1", "dja-2"]);
});
