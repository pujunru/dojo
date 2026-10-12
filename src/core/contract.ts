/**
 * The learner store's contract: what the app asks the store for and what it
 * gets back. The store is local (IndexedDB, `src/store/`), but the shapes are
 * kept request/response-like so a synced backend can implement them later.
 */
import type { Locale } from "../i18n/config";
import type { ItemState, PlanReason } from "./composer";
import type { Grade, KcState, Mastery } from "./learner-model";
import type { OutcomeSignal } from "./grading";
import type { StreakChange } from "./gamification";

export const DOJO_SESSION_KINDS = ["lesson", "daily", "practice", "review", "checkpoint", "remedial", "simulation"] as const;
export type DojoSessionKind = (typeof DOJO_SESSION_KINDS)[number];
export const DOJO_ATTEMPT_RUNTIMES = ["none", "runner"] as const;
export type DojoAttemptRuntime = (typeof DOJO_ATTEMPT_RUNTIMES)[number];
export const PLAN_REASONS = ["new", "review", "remedial", "requeue"] as const satisfies readonly PlanReason[];

export const MAX_PLANNED_ITEMS = 60;

export type DojoProfile = {
  dailyGoalXp: number;
  totalXp: number;
  streakCurrent: number;
  streakBest: number;
  lastActiveDay: string | null;
  freezes: number;
  sessionMinutes: number;
  /** Display-only: the streak needs a session today. */
  atRisk: boolean;
  updatedAt: string;
};

export type DojoToday = { localDay: string; xp: number; goalXp: number; goalMet: boolean; sessions: number; items: number };

export type PlannedEntry = { itemId: string; reason: PlanReason; kcId: string };

export type DojoSession = {
  id: string;
  kind: DojoSessionKind;
  unitId: string | null;
  lessonId: string | null;
  planned: PlannedEntry[];
  contentHash: string;
  startedAt: string;
  finishedAt: string | null;
  abandoned: boolean;
  itemsDone: number;
  itemsPassed: number;
  accuracy: number | null;
  xp: number;
  activeSec: number;
  localDay: string;
  /** The series the session belongs to (one open session per series). */
  series: string;
};

export type DojoUnitCrown = { unitId: string; crowns: number; checkpointPassedAt: string | null };

export type DojoStateResponse = {
  profile: DojoProfile;
  today: DojoToday;
  kcs: KcState[];
  items: ItemState[];
  units: DojoUnitCrown[];
  /** The newest open session of each series. */
  openSessions: DojoSession[];
  /** Accuracy of the last finished, non-abandoned session (composer ZPD gate). */
  lastSessionAccuracy: number | null;
  week: { localDay: string; xp: number; freezeUsed: boolean }[];
  dueCount: number;
  contentHash: string | null;
};

export type StartSessionRequest = {
  id: string;
  kind: DojoSessionKind;
  unitId?: string;
  lessonId?: string;
  planned: PlannedEntry[];
  contentHash: string;
  localDay: string;
  /** The series; derived from the first planned item when omitted. */
  series?: string;
};

export type FinishSessionRequest = {
  id: string;
  patch: { finishedAt: string; activeSec: number; abandoned?: boolean };
  localDay: string;
};

export type FinishSessionResponse = {
  session: DojoSession;
  profile: DojoProfile;
  today: DojoToday;
  streakChange: StreakChange;
  freezeEarned: boolean;
  bonusXp: number;
};

export type AttemptRequest = {
  id: string;
  sessionId: string | null;
  itemId: string;
  itemVersion: number;
  levelId?: string;
  contentHash: string;
  runtime: DojoAttemptRuntime;
  startedAt: string;
  answeredAt: string;
  localDay: string;
  locale: Locale | null;
  /** Sanitised by the store against the item's index row. */
  signal: unknown;
  answer: unknown;
};

export type KcUpdateView = {
  kcId: string;
  grade: Grade;
  pBefore: number;
  hBefore: number;
  hAfter: number;
  masteryBefore: Mastery;
  masteryAfter: Mastery;
};

export type AttemptResponse = {
  attempt: { id: string; xp: number; passed: boolean };
  kcUpdates: KcUpdateView[];
  today: DojoToday;
  unitCrowns?: { unitId: string; before: number; after: number };
  /** The attempt was a timed pass of its unit's checkpoint ladder. */
  checkpointPassed?: boolean;
  duplicate: boolean;
};

export type ProfilePatch = { dailyGoalXp?: number; sessionMinutes?: number };

export type { OutcomeSignal };
