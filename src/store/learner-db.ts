/**
 * The learner's records as one document, and the pure operations on it.
 *
 * Everything the scheduler knows about the learner lives here: per-KC
 * half-lives, per-item history, unit crowns, sessions, days and the profile.
 * Each operation takes the current document and returns the next one plus a
 * response, so the rules are testable without a browser and any backend
 * (IndexedDB today, a sync server later) only has to store a JSON value.
 *
 * Operations are idempotent on their ids: replaying an attempt or a finish
 * returns the stored result instead of applying it twice.
 */
import type {
  AttemptRequest,
  AttemptResponse,
  DojoProfile,
  DojoSession,
  DojoStateResponse,
  DojoToday,
  FinishSessionRequest,
  FinishSessionResponse,
  KcUpdateView,
  ProfilePatch,
  StartSessionRequest,
} from "../core/contract";
import type { DojoItemIndexRow } from "../core/content-schema";
import type { ItemState } from "../core/composer";
import {
  addLocalDays,
  checkpointUnitOf,
  DEFAULT_DAILY_GOAL_XP,
  itemXp,
  passesCheckpoint,
  recordActivity,
  sessionBonusXp,
  settleStreak,
  unitCrown,
  type StreakState,
} from "../core/gamification";
import { gradesForItem, sanitizeSignal } from "../core/grading";
import { addDays, applyRemediation, emptyKcState, LADDER_RETRY_DAYS, updateKc, type KcOutcomeLog, type KcState } from "../core/learner-model";
import type { SchedulerParams } from "../core/series";

export const LEARNER_DB_VERSION = 1;

/** Attempts kept for history and export; older ones are dropped (their effect stays in the KC state). */
export const MAX_STORED_ATTEMPTS = 5_000;
/** Finished sessions kept; open sessions are always kept. */
export const MAX_STORED_SESSIONS = 500;
const ITEM_STATE_WINDOW_DAYS = 60;
const WEEK_WINDOW_DAYS = 35;

export type ProfileRecord = {
  dailyGoalXp: number;
  totalXp: number;
  streakCurrent: number;
  streakBest: number;
  lastActiveDay: string | null;
  freezes: number;
  sessionMinutes: number;
  updatedAt: string;
};

export type DayRecord = { xp: number; items: number; sessions: number; activeSec: number; goalMet: boolean; freezeUsed: boolean };

export type UnitRecord = { crowns: number; checkpointPassedAt: string | null; updatedAt: string };

export type AttemptRecord = {
  id: string;
  sessionId: string | null;
  itemId: string;
  itemVersion: number;
  itemType: string;
  levelId?: string;
  contentHash: string;
  runtime: AttemptRequest["runtime"];
  startedAt: string;
  answeredAt: string;
  localDay: string;
  locale: string | null;
  q: number;
  passed: boolean;
  xp: number;
  kcOutcomes: KcOutcomeLog[];
  answer: unknown;
};

export type LearnerDb = {
  version: typeof LEARNER_DB_VERSION;
  profile: ProfileRecord;
  days: Record<string, DayRecord>;
  kcs: Record<string, KcState>;
  items: Record<string, ItemState>;
  units: Record<string, UnitRecord>;
  sessions: Record<string, DojoSession>;
  attempts: AttemptRecord[];
};

export function emptyLearnerDb(): LearnerDb {
  return {
    version: LEARNER_DB_VERSION,
    profile: {
      dailyGoalXp: DEFAULT_DAILY_GOAL_XP,
      totalXp: 0,
      streakCurrent: 0,
      streakBest: 0,
      lastActiveDay: null,
      freezes: 0,
      sessionMinutes: 10,
      updatedAt: "1970-01-01T00:00:00.000Z",
    },
    days: {},
    kcs: {},
    items: {},
    units: {},
    sessions: {},
    attempts: [],
  };
}

const emptyDay = (): DayRecord => ({ xp: 0, items: 0, sessions: 0, activeSec: 0, goalMet: false, freezeUsed: false });

function streakOf(p: ProfileRecord): StreakState {
  return { streakCurrent: p.streakCurrent, streakBest: p.streakBest, lastActiveDay: p.lastActiveDay, freezes: p.freezes };
}

/** The profile as displayed on `localDay`: the streak is settled lazily, read-only. */
function profileView(p: ProfileRecord, localDay: string): DojoProfile {
  const v = settleStreak(streakOf(p), localDay);
  return { ...p, streakCurrent: v.streakCurrent, atRisk: v.atRisk };
}

function todayOf(localDay: string, day: DayRecord | undefined, goal: number): DojoToday {
  const xp = day?.xp ?? 0;
  return { localDay, xp, goalXp: goal, goalMet: xp >= goal, sessions: day?.sessions ?? 0, items: day?.items ?? 0 };
}

/* ───────────────────────── state ───────────────────────── */

export function readState(db: LearnerDb, localDay: string, contentHash: string | null, now: Date): DojoStateResponse {
  const since = addDays(now, -ITEM_STATE_WINDOW_DAYS).toISOString();
  const weekFrom = addLocalDays(localDay, -(WEEK_WINDOW_DAYS - 1)) ?? localDay;
  const sessions = Object.values(db.sessions);
  const openBySeries = new Map<string, DojoSession>();
  for (const s of sessions) {
    if (s.finishedAt) continue;
    const cur = openBySeries.get(s.series);
    if (!cur || s.startedAt > cur.startedAt) openBySeries.set(s.series, s);
  }
  const last = sessions
    .filter((s) => s.finishedAt && !s.abandoned && s.itemsDone > 0)
    .sort((a, b) => (b.finishedAt! > a.finishedAt! ? 1 : -1))[0];
  const nowIso = now.toISOString();
  return {
    profile: profileView(db.profile, localDay),
    today: todayOf(localDay, db.days[localDay], db.profile.dailyGoalXp),
    kcs: Object.values(db.kcs).sort((a, b) => a.kcId.localeCompare(b.kcId)),
    items: Object.values(db.items).filter((i) => i.lastSeenAt >= since).sort((a, b) => a.itemId.localeCompare(b.itemId)),
    units: Object.entries(db.units).map(([unitId, u]) => ({ unitId, crowns: u.crowns, checkpointPassedAt: u.checkpointPassedAt })),
    openSessions: [...openBySeries.values()].sort((a, b) => (b.startedAt > a.startedAt ? 1 : -1)),
    lastSessionAccuracy: last?.accuracy ?? null,
    week: Object.entries(db.days)
      .filter(([day]) => day >= weekFrom && day <= localDay)
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([day, d]) => ({ localDay: day, xp: d.xp, freezeUsed: d.freezeUsed })),
    dueCount: Object.values(db.kcs).filter((k) => k.nextDueAt !== null && k.nextDueAt <= nowIso).length,
    contentHash,
  };
}

/* ───────────────────────── sessions ───────────────────────── */

/**
 * Starts a session (idempotent on id). The series' previous open session is
 * closed as abandoned: one open session per series.
 */
export function startSession(db: LearnerDb, req: StartSessionRequest, now: Date): { db: LearnerDb; session: DojoSession; created: boolean } {
  const existing = db.sessions[req.id];
  if (existing) return { db, session: existing, created: false };
  const nowIso = now.toISOString();
  const series = req.series ?? "default";
  const sessions = { ...db.sessions };
  for (const s of Object.values(sessions)) {
    if (!s.finishedAt && s.series === series) sessions[s.id] = { ...s, finishedAt: nowIso, abandoned: true };
  }
  const session: DojoSession = {
    id: req.id,
    kind: req.kind,
    unitId: req.unitId ?? null,
    lessonId: req.lessonId ?? null,
    planned: req.planned,
    contentHash: req.contentHash,
    startedAt: nowIso,
    finishedAt: null,
    abandoned: false,
    itemsDone: 0,
    itemsPassed: 0,
    accuracy: null,
    xp: 0,
    activeSec: 0,
    localDay: req.localDay,
    series,
  };
  sessions[req.id] = session;
  return { db: { ...db, sessions: pruneSessions(sessions) }, session, created: true };
}

function pruneSessions(sessions: Record<string, DojoSession>): Record<string, DojoSession> {
  const finished = Object.values(sessions).filter((s) => s.finishedAt).sort((a, b) => (b.finishedAt! > a.finishedAt! ? 1 : -1));
  if (finished.length <= MAX_STORED_SESSIONS) return sessions;
  const next = { ...sessions };
  for (const s of finished.slice(MAX_STORED_SESSIONS)) delete next[s.id];
  return next;
}

export type FinishResult = { ok: true; db: LearnerDb; value: FinishSessionResponse } | { ok: false; code: "NOT_FOUND" };

export function finishSession(db: LearnerDb, req: FinishSessionRequest, now: Date): FinishResult {
  const s = db.sessions[req.id];
  if (!s) return { ok: false, code: "NOT_FOUND" };
  const p = db.profile;
  if (s.finishedAt) {
    return {
      ok: true,
      db,
      value: {
        session: s,
        profile: profileView(p, req.localDay),
        today: todayOf(req.localDay, db.days[req.localDay], p.dailyGoalXp),
        streakChange: "unchanged",
        freezeEarned: false,
        bonusXp: 0,
      },
    };
  }
  const counts = !req.patch.abandoned && s.itemsDone > 0;
  const accuracy = s.itemsDone > 0 ? s.itemsPassed / s.itemsDone : null;
  const bonus = counts ? sessionBonusXp(s.itemsDone, accuracy) : 0;
  const activity = counts ? recordActivity(streakOf(p), req.localDay) : null;
  const streak = activity?.state ?? streakOf(p);
  const goal = p.dailyGoalXp;

  const days = { ...db.days };
  const day = { ...(days[req.localDay] ?? emptyDay()) };
  day.xp += bonus;
  day.sessions += counts ? 1 : 0;
  day.activeSec += req.patch.activeSec;
  day.goalMet = day.goalMet || day.xp >= goal;
  days[req.localDay] = day;
  for (const frozen of activity?.frozenDays ?? []) days[frozen] = { ...(days[frozen] ?? emptyDay()), freezeUsed: true };

  const session: DojoSession = {
    ...s,
    finishedAt: req.patch.finishedAt,
    abandoned: Boolean(req.patch.abandoned),
    accuracy,
    xp: s.xp + bonus,
    activeSec: req.patch.activeSec,
  };
  const profile: ProfileRecord = {
    ...p,
    totalXp: p.totalXp + bonus,
    streakCurrent: streak.streakCurrent,
    streakBest: streak.streakBest,
    lastActiveDay: streak.lastActiveDay,
    freezes: streak.freezes,
    updatedAt: now.toISOString(),
  };
  const next: LearnerDb = { ...db, profile, days, sessions: pruneSessions({ ...db.sessions, [s.id]: session }) };
  return {
    ok: true,
    db: next,
    value: {
      session,
      profile: profileView(profile, req.localDay),
      today: todayOf(req.localDay, day, goal),
      streakChange: activity?.change ?? "unchanged",
      freezeEarned: activity?.freezeEarned ?? false,
      bonusXp: bonus,
    },
  };
}

/* ───────────────────────── attempts ───────────────────────── */

export type AttemptContext = {
  /** The item's index row: grading never trusts the client's view of the item. */
  row: DojoItemIndexRow;
  /** Every KC of the item's unit (the crown is computed over them). */
  unitKcIds: readonly string[];
  params: SchedulerParams;
  now: Date;
  rand?: () => number;
};

export type AttemptResult =
  | { ok: true; db: LearnerDb; value: AttemptResponse }
  | { ok: false; code: "NOT_FOUND" | "SESSION_CLOSED" | "INVALID_SIGNAL" };

/**
 * Records one answered item: grades every KC the item exercises, updates the
 * learner model, XP, the day, the session and the unit crown.
 */
export function recordAttempt(db: LearnerDb, req: AttemptRequest, ctx: AttemptContext): AttemptResult {
  const { row: item, unitKcIds, params, now } = ctx;
  const nowIso = now.toISOString();
  const goal = db.profile.dailyGoalXp;

  const existing = db.attempts.find((a) => a.id === req.id);
  if (existing) {
    return {
      ok: true,
      db,
      value: {
        attempt: { id: existing.id, xp: existing.xp, passed: existing.passed },
        kcUpdates: existing.kcOutcomes.map(logToView),
        today: todayOf(req.localDay, db.days[req.localDay], goal),
        duplicate: true,
      },
    };
  }
  const session = req.sessionId ? db.sessions[req.sessionId] : null;
  if (req.sessionId) {
    if (!session) return { ok: false, code: "NOT_FOUND" };
    if (session.finishedAt) return { ok: false, code: "SESSION_CLOSED" };
  }
  const sanitized = sanitizeSignal(req.signal, item);
  if (!sanitized.ok) return { ok: false, code: "INVALID_SIGNAL" };
  const signal = sanitized.signal;

  const kcs = { ...db.kcs };
  const remediate = item.type === "ladder" || item.type === "case";
  const logs: KcOutcomeLog[] = [];
  for (const g of gradesForItem(signal, item)) {
    const before = kcs[g.kcId] ?? emptyKcState(g.kcId);
    const { state, log } = updateKc(before, g.grade, { qKc: g.qKc, itemType: item.type, weight: g.weight, now, rand: ctx.rand, params });
    const next = remediate && g.grade === 1 ? applyRemediation(state, now) : state;
    logs.push(next === state ? log : { ...log, hAfter: Math.round(next.halfLifeDays * 10_000) / 10_000, masteryAfter: next.mastery });
    kcs[next.kcId] = next;
  }

  // Gamification.
  const xp = itemXp(item.type, signal.q, signal.solutionRevealed);
  const unit = db.units[item.unit];
  const crownBefore = unit?.crowns ?? 0;
  // A timed pass of the unit's checkpoint opens crowns 4–5.
  const checkpointHit = checkpointUnitOf(item) === item.unit && passesCheckpoint(signal, item.estSeconds);
  const checkpointAt = checkpointHit ? nowIso : unit?.checkpointPassedAt ?? null;
  const crownNow = unitCrown(unitKcIds, new Map(Object.entries(kcs)), checkpointAt, undefined, now);
  const crownAfter = Math.max(crownBefore, crownNow);

  const days = { ...db.days };
  const day = { ...(days[req.localDay] ?? emptyDay()) };
  day.xp += xp;
  day.items += 1;
  day.goalMet = day.goalMet || day.xp >= goal;
  days[req.localDay] = day;

  const prevItem = db.items[item.id];
  const nextRetryAt = item.type === "ladder" && !signal.passed ? addDays(now, LADDER_RETRY_DAYS).toISOString() : prevItem?.nextRetryAt ?? null;
  const items = {
    ...db.items,
    [item.id]: {
      itemId: item.id,
      lastSeenAt: nowIso,
      seen: (prevItem?.seen ?? 0) + 1,
      lastQ: signal.q,
      bestLevel: prevItem?.bestLevel ?? null,
      nextRetryAt,
    },
  };

  const units = crownAfter !== crownBefore || !unit || checkpointHit
    ? {
        ...db.units,
        [item.unit]: {
          crowns: crownAfter,
          checkpointPassedAt: unit?.checkpointPassedAt ?? (checkpointHit ? nowIso : null),
          updatedAt: nowIso,
        },
      }
    : db.units;

  const sessions = session
    ? { ...db.sessions, [session.id]: { ...session, itemsDone: session.itemsDone + 1, itemsPassed: session.itemsPassed + (signal.passed ? 1 : 0), xp: session.xp + xp } }
    : db.sessions;

  const record: AttemptRecord = {
    id: req.id,
    sessionId: req.sessionId,
    itemId: item.id,
    itemVersion: req.itemVersion,
    itemType: item.type,
    ...(req.levelId ? { levelId: req.levelId } : {}),
    contentHash: req.contentHash,
    runtime: req.runtime,
    startedAt: req.startedAt,
    answeredAt: req.answeredAt,
    localDay: req.localDay,
    locale: req.locale,
    q: signal.q,
    passed: signal.passed,
    xp,
    kcOutcomes: logs,
    answer: req.answer,
  };
  const attempts = [...db.attempts, record];
  if (attempts.length > MAX_STORED_ATTEMPTS) attempts.splice(0, attempts.length - MAX_STORED_ATTEMPTS);

  const next: LearnerDb = {
    ...db,
    profile: { ...db.profile, totalXp: db.profile.totalXp + xp, updatedAt: nowIso },
    days,
    kcs,
    items,
    units,
    sessions,
    attempts,
  };
  return {
    ok: true,
    db: next,
    value: {
      attempt: { id: req.id, xp, passed: signal.passed },
      kcUpdates: logs.map(logToView),
      today: todayOf(req.localDay, day, goal),
      ...(crownAfter !== crownBefore ? { unitCrowns: { unitId: item.unit, before: crownBefore, after: crownAfter } } : {}),
      ...(checkpointHit ? { checkpointPassed: true } : {}),
      duplicate: false,
    },
  };
}

function logToView(l: KcOutcomeLog): KcUpdateView {
  return {
    kcId: l.kc,
    grade: l.grade,
    pBefore: l.pPred,
    hBefore: l.hBefore,
    hAfter: l.hAfter,
    masteryBefore: l.masteryBefore,
    masteryAfter: l.masteryAfter,
  };
}

/* ───────────────────────── profile ───────────────────────── */

export function updateProfile(db: LearnerDb, patch: ProfilePatch, localDay: string, now: Date): { db: LearnerDb; profile: DojoProfile } {
  const profile = {
    ...db.profile,
    ...(patch.dailyGoalXp !== undefined ? { dailyGoalXp: patch.dailyGoalXp } : {}),
    ...(patch.sessionMinutes !== undefined ? { sessionMinutes: patch.sessionMinutes } : {}),
    updatedAt: now.toISOString(),
  };
  return { db: { ...db, profile }, profile: profileView(profile, localDay) };
}

/* ───────────────────────── export / import ───────────────────────── */

/** The JSON a learner downloads to move their progress to another device. */
export type LearnerExport = { format: "dojo-learner"; exportedAt: string; db: LearnerDb };

export function exportLearnerDb(db: LearnerDb, now: Date): LearnerExport {
  return { format: "dojo-learner", exportedAt: now.toISOString(), db };
}

/** Validates an export file; returns the document to replace the current one with. */
export function parseLearnerExport(value: unknown): { ok: true; db: LearnerDb } | { ok: false; reason: "format" | "version" } {
  const v = value as Partial<LearnerExport> | null;
  if (!v || v.format !== "dojo-learner" || !v.db || typeof v.db !== "object") return { ok: false, reason: "format" };
  const db = v.db as Partial<LearnerDb>;
  if (db.version !== LEARNER_DB_VERSION) return { ok: false, reason: "version" };
  const obj = (x: unknown) => x !== null && typeof x === "object" && !Array.isArray(x);
  if (!obj(db.profile) || !obj(db.days) || !obj(db.kcs) || !obj(db.items) || !obj(db.units) || !obj(db.sessions) || !Array.isArray(db.attempts)) {
    return { ok: false, reason: "format" };
  }
  return { ok: true, db: db as LearnerDb };
}
