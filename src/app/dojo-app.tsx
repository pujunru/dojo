"use client";

/**
 * Dojo: the daily spaced-repetition loop (docs/ARCHITECTURE.md).
 *
 * Screens, addressed by the URL hash: `#path` (home: stats + the curriculum
 * path), `#session` (the lesson player and its summary), `#skills` (KC
 * heatmap), `#review` (the review queue) and `#simulation` (timed cases).
 *
 * Data: the content manifest and unit bundles are static files (content-
 * hashed, built by `npm run content:build`); the learner state lives on this
 * device (`src/store/`). Sessions are composed here, in the browser. Items
 * that must run code play only when a code runner is registered
 * (`core/runner.ts`); otherwise the composer leaves them out.
 *
 * Every visual is a Storybook-registered composition; this file only wires
 * data and intent.
 */
import * as React from "react";
import { useLocale, useTranslations } from "use-intl";
import { isEnglishLocale, type Locale } from "../i18n/config";
import { Alert, AlertDescription, AlertTitle } from "../ui/alert";
import { Button } from "../ui/button";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "../ui/tabs";
import {
  DojoHeaderStats,
  DojoPathLayout,
  FeedbackSheet,
  HintPanel,
  ItemFrame,
  ItemMetaChips,
  KcHeatmap,
  LessonPlayerLayout,
  LessonProgressBar,
  ReviewQueueList,
  SeriesSwitcher,
  SessionSummary,
  TierSection,
  UnitPath,
  type DojoPlatform,
  type ItemPhase,
  type SessionKcChange,
} from "../features";
import type { MasteryLevel } from "../ui/mastery-crown";
import type { StreakStatus } from "../ui/streak-badge";
import { pickL10n, type DojoContentPointer, type DojoManifest } from "../core/content-schema";
import { composeSession } from "../core/composer";
import type { DojoStateResponse } from "../core/contract";
import { deviceLocalDay } from "../core/gamification";
import type { KcState } from "../core/learner-model";
import { fetchDojoState, getAttemptQueue, loadContentPointer, loadSeriesManifest, type QueueStatus } from "./api";
import { openSessionFor } from "./resume";
import { useSelectedSeries } from "./use-selected-series";
import { isSandboxRuntime } from "../core/series";
import { isAnswerComplete, RUN_TYPES } from "./grade";
import { ItemSurface } from "./item-surface";
import { SimulationPanel } from "./simulation";
import {
  buildGraphs,
  buildHeatmap,
  buildPath,
  buildReviewQueue,
  CHECKPOINT_NODE_PREFIX,
  findLesson,
  kcTitleMap,
  recallTomorrow,
} from "./model";
import { composeInputFor, useDojoSession, type StartOptions } from "./use-dojo-session";
import { buildRuntimes, hasRunner, useRunnerStatus } from "./runtimes";

type Screen = "path" | "session" | "skills" | "review" | "simulation";
type HomeScreen = Exclude<Screen, "session">;
const HOME_SCREENS: readonly HomeScreen[] = ["path", "skills", "review", "simulation"];
const TONES = ["amber", "blue", "magenta", "indigo"] as const;

function readHash(): Screen {
  if (typeof window === "undefined") return "path";
  const hash = window.location.hash.replace(/^#/, "");
  return hash === "session" || (HOME_SCREENS as readonly string[]).includes(hash) ? hash as Screen : "path";
}

/** The screen lives in the URL hash, so tabs are linkable and survive a reload. */
function useHashScreen() {
  const [screen, setScreen] = React.useState<Screen>(readHash);
  React.useEffect(() => {
    const onHash = () => setScreen(readHash());
    window.addEventListener("hashchange", onHash);
    return () => window.removeEventListener("hashchange", onHash);
  }, []);
  const go = React.useCallback((next: Screen) => {
    setScreen(next);
    if (window.location.hash !== `#${next}`) {
      window.history.replaceState(window.history.state, "", `${window.location.pathname}${window.location.search}#${next}`);
    }
  }, []);
  return [screen, go] as const;
}

function useQueueStatus() {
  const [status, setStatus] = React.useState<QueueStatus>({ pending: 0, failing: false });
  React.useEffect(() => {
    const queue = getAttemptQueue();
    return queue.subscribe(setStatus);
  }, []);
  return status;
}

/** The nearest ancestor that scrolls vertically (the shell's content pane), or null for the window. */
function scrollParent(el: HTMLElement | null): HTMLElement | null {
  for (let p = el?.parentElement ?? null; p; p = p.parentElement) {
    if (/(auto|scroll)/.test(getComputedStyle(p).overflowY)) return p;
  }
  return null;
}

/**
 * Height left for the player below the app chrome, so its sticky action dock
 * (Check / Continue) is always on screen. Entering the player scrolls its
 * container back to the top: the path may have been scrolled far down.
 */
function usePlayerHeight(active: boolean) {
  const ref = React.useRef<HTMLDivElement | null>(null);
  const [height, setHeight] = React.useState<number | null>(null);
  React.useLayoutEffect(() => {
    if (!active) return undefined;
    const container = scrollParent(ref.current);
    if (container) container.scrollTop = 0;
    else window.scrollTo(0, 0);
    const measure = () => {
      const el = ref.current;
      if (!el) return;
      const top = el.getBoundingClientRect().top;
      // Ancestors' bottom padding (the content track's gutter) still takes room below the player.
      let inset = 0;
      for (let p = el.parentElement; p && p !== container?.parentElement; p = p.parentElement) {
        inset += Number.parseFloat(getComputedStyle(p).paddingBottom) || 0;
      }
      const bottom = (container ? container.getBoundingClientRect().bottom : window.innerHeight) - inset;
      setHeight(Math.max(320, Math.floor(bottom - Math.max(0, top))));
    };
    measure();
    window.addEventListener("resize", measure);
    return () => window.removeEventListener("resize", measure);
  }, [active]);
  return { ref, style: height ? ({ "--dj-dojo-player-height": `${height}px` } as React.CSSProperties) : undefined };
}

/** One-second tick while a ladder level's timer is on screen. */
function useLadderClock(active: boolean) {
  const [now, setNow] = React.useState(() => Date.now());
  React.useEffect(() => {
    if (!active) return undefined;
    const id = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(id);
  }, [active]);
  return now;
}

function streakStatus(state: DojoStateResponse): StreakStatus {
  if (state.profile.atRisk) return "at-risk";
  if (state.profile.streakCurrent === 0 && state.profile.lastActiveDay) return "broken";
  return "active";
}

export default function DojoApp() {
  const t = useTranslations("app");
  const locale = useLocale() as Locale;
  const sandbox = useRunnerStatus();
  const platform: DojoPlatform = sandbox.state === "no-runner" ? "no-runner" : "runner";
  /** A stable error code as a sentence; unknown codes fall back to `fallback`. */
  const errorText = (code: string | null, fallback: string) => (code && t.has(`errors.${code}` as "errors.NETWORK") ? t(`errors.${code}` as "errors.NETWORK") : fallback);
  const queue = useQueueStatus();
  const [screen, go] = useHashScreen();

  const [pointer, setPointer] = React.useState<DojoContentPointer | null>(null);
  const [seriesId, selectSeries] = useSelectedSeries(pointer);
  const [manifest, setManifest] = React.useState<DojoManifest | null>(null);
  const [state, setState] = React.useState<DojoStateResponse | null>(null);
  const [loadError, setLoadError] = React.useState<"content" | "state" | null>(null);
  const [now, setNow] = React.useState(() => new Date());
  const [selectedKc, setSelectedKc] = React.useState<string | null>(null);
  const [notice, setNotice] = React.useState<string | null>(null);

  const reloadState = React.useCallback(async () => {
    try {
      const next = await fetchDojoState(deviceLocalDay());
      setState(next);
      setNow(new Date());
      return next;
    } catch {
      setLoadError((current) => current ?? "state");
      return null;
    }
  }, []);

  const load = React.useCallback(async () => {
    setLoadError(null);
    const [p] = await Promise.all([
      loadContentPointer().catch(() => {
        setLoadError("content");
        return null;
      }),
      reloadState(),
    ]);
    if (p) setPointer(p);
  }, [reloadState]);

  React.useEffect(() => {
    void load();
  }, [load]);

  // The active series' manifest: loaded on first use and whenever the learner switches.
  React.useEffect(() => {
    if (!pointer || !seriesId) return undefined;
    let alive = true;
    loadSeriesManifest(pointer.hash, seriesId)
      .then((m) => { if (alive) setManifest(m); })
      .catch(() => { if (alive) setLoadError("content"); });
    return () => { alive = false; };
  }, [pointer, seriesId]);

  const graphs = React.useMemo(
    () => (manifest && manifest.series.id === seriesId ? buildGraphs(manifest, buildRuntimes()) : null),
    [manifest, seriesId],
  );
  const openSession = openSessionFor(state, seriesId ?? "");
  const kcMap = React.useMemo(() => new Map<string, KcState>((state?.kcs ?? []).map((kc) => [kc.kcId, kc])), [state]);

  const session = useDojoSession({
    manifest,
    graphs,
    state,
    locale,
    onToday: (today) => setState((current) => (current ? { ...current, today } : current)),
    // Drop the closed session from the cached state, then refetch the rest.
    onSessionClosed: () => {
      setState((current) => (current ? {
        ...current,
        openSessions: current.openSessions.filter((s) => s.series !== seriesId),
      } : current));
      void reloadState();
    },
  });
  const run = session.run;
  const player = usePlayerHeight(Boolean(run));
  const clock = useLadderClock((session.current?.type === "ladder" || (session.current?.type === "case" && Boolean(session.current.simulation))) && !session.progress?.reveal);

  // The player owns `#session`; leaving it (or reloading on it) lands on the path.
  React.useEffect(() => {
    if (run && screen !== "session") go("session");
    if (!run && screen === "session" && !session.busy) go("path");
  }, [run, screen, go, session.busy]);

  // A finished session changed the learner state: refetch it for the summary and the path.
  const summaryShown = run?.phase === "summary";
  React.useEffect(() => {
    if (summaryShown) void reloadState();
  }, [summaryShown, reloadState]);

  const noticeRef = React.useRef<HTMLDivElement | null>(null);
  const startSession = React.useCallback(async (options: StartOptions) => {
    setNotice(null);
    const outcome = await session.start(options);
    if (outcome === "empty") setNotice(t("session.empty"));
    if (outcome === "started") go("session");
    // The lesson may have been started far down the path; bring the reason into view.
    else window.requestAnimationFrame(() => noticeRef.current?.scrollIntoView({ block: "center", behavior: "smooth" }));
  }, [go, session, t]);

  const leaveSession = React.useCallback(() => {
    session.close();
    go("path");
    void reloadState();
  }, [go, reloadState, session]);

  /* ───────── keyboard: Enter = check / continue, 1–9 = pick a choice ───────── */
  const current = session.current;
  const progress = session.progress;
  React.useEffect(() => {
    if (!run || run.phase !== "playing" || !current || !progress) return undefined;
    const onKey = (event: KeyboardEvent) => {
      if (event.defaultPrevented || event.metaKey || event.ctrlKey || event.altKey || event.isComposing) return;
      const target = event.target instanceof HTMLElement ? event.target : null;
      const typing = Boolean(target?.closest('textarea, input:not([type="radio"]):not([type="checkbox"]), select, [contenteditable="true"], .cm-editor'));
      if (event.key === "Enter") {
        if (typing || target?.closest("button, a[href], summary")) return;
        if (progress.reveal) {
          event.preventDefault();
          session.advance();
        } else if (!progress.selfGrading && isAnswerComplete(current, progress.answer) && !(isSandboxRuntime(current.runtime) && (RUN_TYPES.has(current.type) || current.type === "ladder") && !hasRunner())) {
          event.preventDefault();
          void session.check();
        }
        return;
      }
      if (typing || progress.reveal || !/^[1-9]$/.test(event.key)) return;
      const index = Number(event.key) - 1;
      if (current.type === "predict" && current.answer.mode === "choice" && index < current.answer.options.length) {
        event.preventDefault();
        session.setAnswer({ ...(progress.answer as object), choice: index });
      } else if (current.type === "choose-design" && index < current.options.length) {
        event.preventDefault();
        const answer = progress.answer as { selected: string[]; rationale: string };
        const id = current.options[index].id;
        const selected = current.multi
          ? answer.selected.includes(id) ? answer.selected.filter((entry) => entry !== id) : [...answer.selected, id]
          : [id];
        session.setAnswer({ ...answer, selected });
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [run, current, progress, session]);

  /* ───────── loading / errors ───────── */

  if (loadError && (!manifest || !state)) {
    return (
      <DojoPathLayout header={null}>
        <Alert variant="destructive">
          <AlertTitle>{t("loadError.title")}</AlertTitle>
          <AlertDescription>{loadError === "content" ? t("loadError.content") : t("loadError.state")}</AlertDescription>
          <div><Button variant="outline" size="sm" onClick={() => void load()}>{t("loadError.retry")}</Button></div>
        </Alert>
      </DojoPathLayout>
    );
  }
  if (!manifest || !state || !graphs) {
    return (
      <DojoPathLayout header={null}>
        <Alert aria-busy="true"><AlertDescription>{t("loading")}</AlertDescription></Alert>
      </DojoPathLayout>
    );
  }

  const syncNotice = queue.pending > 0 ? (
    <Alert variant={queue.failing ? "warning" : "default"}>
      <AlertDescription>{queue.failing ? t("sync.failing") : t("sync.pending", { count: queue.pending })}</AlertDescription>
    </Alert>
  ) : null;

  /* ───────── player ───────── */

  if (run) {
    const total = run.plan.length;
    // Position in the plan: skipped items count as passed by, answered ones once revealed.
    const done = run.phase === "playing" ? run.index + (progress?.reveal ? 1 : 0) : run.plan.length;
    const requeued = run.plan.filter((entry) => entry.reason === "requeue").length;
    const progressBar = <LessonProgressBar done={done} total={total} requeued={requeued} onClose={leaveSession} />;

    if (run.phase === "summary" && run.summary) {
      const s = run.summary;
      const titles = kcTitleMap(graphs.display, locale);
      const kcs: SessionKcChange[] = Object.values(run.kcUpdates).map(({ first, last }) => ({
        kcId: first.kcId,
        title: titles.get(first.kcId) ?? first.kcId,
        // Both sides are "recall tomorrow": without this session, and with it.
        pBefore: first.pBefore * recallTomorrow(first.hBefore),
        pAfter: recallTomorrow(last.hAfter),
        masteryBefore: first.masteryBefore as MasteryLevel,
        masteryAfter: last.masteryAfter as MasteryLevel,
      }));
      // Failed ladder levels, surviving mutants and missed review issues name their KCs.
      const missed = [...new Set(run.results.flatMap((r) => [...r.weakKcs, ...(r.passed ? [] : [r.kcId])]))];
      const remedialInput = missed.length ? composeInputFor({ graphs, state }, "remedial", { kcIds: missed }) : null;
      const remedialCount = remedialInput ? composeSession(remedialInput).length : 0;
      return (
        <div ref={player.ref} style={player.style}>
          <LessonPlayerLayout progress={progressBar}>
            <SessionSummary
              xp={run.results.reduce((sum, r) => sum + r.xp, 0)}
              bonusXp={s.bonusXp}
              itemsDone={s.session.itemsDone}
              itemsPassed={s.session.itemsPassed}
              accuracy={s.session.accuracy}
              activeSec={s.session.activeSec}
              today={{ xp: s.today.xp, goalXp: s.today.goalXp }}
              kcs={kcs}
              streak={{ change: s.streakChange, count: s.profile.streakCurrent, freezeEarned: s.freezeEarned, freezesLeft: s.profile.freezes }}
              remedial={remedialCount > 0 ? { itemCount: remedialCount, onStart: () => void startSession({ kind: "remedial", kcIds: missed }) } : undefined}
              onContinue={leaveSession}
            />
          </LessonPlayerLayout>
        </div>
      );
    }

    if (run.phase === "finishing" || !current || !progress) {
      return (
        <div ref={player.ref} style={player.style}>
          <LessonPlayerLayout progress={progressBar}>
            <div>
              {run.finishError ? (
                <Alert variant="warning">
                  <AlertDescription>{run.finishError === "ATTEMPTS_PENDING" ? t("session.finishError") : errorText(run.finishError, t("session.finishError"))}</AlertDescription>
                  <div><Button variant="outline" size="sm" onClick={() => void session.finish()}>{t("session.finishRetry")}</Button></div>
                </Alert>
              ) : (
                <Alert aria-busy="true"><AlertDescription>{t("session.finishing")}</AlertDescription></Alert>
              )}
            </div>
          </LessonPlayerLayout>
        </div>
      );
    }

    const entry = run.plan[run.index];
    const running = progress.run.state === "running";
    const codeItem = RUN_TYPES.has(current.type) || current.type === "ladder";
    // A case stage is checked once; the next stage unlocks from the verdict panel.
    const caseStageSent = current.type === "case" && Boolean(progress.judge[current.stages[(progress.answer as { current: number }).current]?.id ?? ""]);
    const blocked = (codeItem && !hasRunner()) || caseStageSent;
    const phase: ItemPhase = progress.reveal
      ? "revealed"
      : running
        ? "checking"
        : isAnswerComplete(current, progress.answer) ? "answered" : "unanswered";
    const hints = current.hints.map((hint) => pickL10n(hint, locale));
    const runCount = RUN_TYPES.has(current.type) && !progress.reveal ? progress.runs : 0;
    const canGiveUp = RUN_TYPES.has(current.type) && progress.runs > 0 && !progress.reveal;

    return (
      <div ref={player.ref} style={player.style}>
        <LessonPlayerLayout progress={progressBar}>
          <ItemFrame
            key={current.id}
            itemType={current.type}
            prompt={pickL10n(current.prompt, locale)}
            phase={phase}
            checkKind={codeItem ? "run" : "check"}
            blocked={blocked || progress.selfGrading}
            meta={<ItemMetaChips reason={entry?.reason} runCount={runCount} />}
            canHint={hints.length > 0}
            hintOpen={progress.hintOpen}
            hint={<HintPanel hints={hints} shown={progress.hintsShown} onNextHint={session.nextHint} />}
            onHint={session.toggleHint}
            onGiveUp={canGiveUp ? session.giveUp : undefined}
            onCheck={() => void session.check()}
            onSkip={session.advance}
            onContinue={session.advance}
            feedback={progress.reveal ? (
              <FeedbackSheet
                verdict={progress.reveal.verdict}
                xp={progress.xp}
                explanation={pickL10n(current.explanation, locale)}
              />
            ) : undefined}
          >
            <ItemSurface
              item={current}
              progress={progress}
              platform={platform}
              sandbox={sandbox}
              onAnswerChange={session.setAnswer}
              onReset={session.resetAnswer}
              onSelfGrade={session.selfGrade}
              onSkipLevel={session.skipLevel}
              judge={{
                onToggle: session.toggleCriterion,
                onNext: session.nextCaseStage,
                onGrade: session.gradeJudged,
              }}
              now={clock}
            />
          </ItemFrame>
        </LessonPlayerLayout>
      </div>
    );
  }

  /* ───────── home: path / skills / review ───────── */

  const header = (
    <DojoHeaderStats
      streak={{ count: state.profile.streakCurrent, status: streakStatus(state) }}
      today={{ xp: state.today.xp, goalXp: state.today.goalXp }}
      freezes={state.profile.freezes}
      dueCount={state.dueCount}
      isNewUser={state.profile.totalXp === 0 && !state.profile.lastActiveDay}
      hasOpenSession={Boolean(openSession)}
      startDisabled={session.busy}
      onStartDaily={() => void startSession(openSession ? { kind: "daily", resume: openSession } : { kind: "daily" })}
    />
  );

  const homeScreen: HomeScreen = screen === "session" ? "path" : screen;
  const tiers = homeScreen === "path" ? buildPath({ graphs, kc: kcMap, units: state.units, now, locale, sandbox: hasRunner() }) : [];
  const startLesson = (lessonId: string) => {
    if (lessonId.startsWith(CHECKPOINT_NODE_PREFIX)) {
      void startSession({ kind: "checkpoint", unitId: lessonId.slice(CHECKPOINT_NODE_PREFIX.length) });
      return;
    }
    const found = findLesson(graphs.compose, lessonId);
    if (found) void startSession({ kind: "lesson", lessonId, unitId: found.unit.id });
  };

  return (
    <DojoPathLayout header={header}>
      {syncNotice}
      {notice || session.error ? (
        <Alert variant="warning" ref={noticeRef}>
          <AlertDescription>{notice ?? errorText(session.error, t("session.startError"))}</AlertDescription>
          <div><Button variant="ghost" size="sm" onClick={() => { setNotice(null); session.clearError(); }}>{t("session.dismiss")}</Button></div>
        </Alert>
      ) : null}
      {session.busy ? <Alert aria-busy="true"><AlertDescription>{t("session.starting")}</AlertDescription></Alert> : null}
      <Tabs value={homeScreen} onValueChange={(value) => go(value as HomeScreen)}>
        <TabsList variant="view-switch" aria-label={t("tabs.label")}>
          {HOME_SCREENS.map((id) => <TabsTrigger key={id} value={id}>{t(`tabs.${id}`)}</TabsTrigger>)}
        </TabsList>
        <SeriesSwitcher
          className="mt-[var(--space-4)]"
          series={(pointer?.series ?? []).map((entry) => ({
            id: entry.id,
            title: isEnglishLocale(locale) ? entry.title_en : entry.title_zh,
            description: (isEnglishLocale(locale) ? entry.description_en : entry.description_zh) ?? undefined,
          }))}
          activeId={seriesId ?? ""}
          disabled={session.busy}
          onSelect={selectSeries}
        />
        <TabsContent value="path">
          {manifest.items.length === 0 ? (
            <Alert>
              <AlertTitle>{t("emptyContent.title")}</AlertTitle>
              <AlertDescription>{t("emptyContent.body")}</AlertDescription>
            </Alert>
          ) : (
            <div className="grid gap-[var(--space-6)]">
              {tiers.map((tier) => (
                <TierSection key={tier.id} code={tier.code} title={tier.title} unitsComplete={tier.unitsComplete} unitsTotal={tier.unitsTotal}>
                  {tier.units.map((unit) => (
                    <UnitPath key={unit.id} unit={unit} platform={platform} onStartNode={session.busy ? undefined : startLesson} tone={TONES[(unit.ordinal - 1) % TONES.length]} />
                  ))}
                </TierSection>
              ))}
            </div>
          )}
        </TabsContent>
        <TabsContent value="skills">
          {homeScreen === "skills" ? (
            <KcHeatmap
              rows={buildHeatmap(graphs.display, kcMap, now, locale)}
              selectedKcId={selectedKc}
              onSelectKc={(id) => setSelectedKc((cur) => (cur === id ? null : id))}
            />
          ) : null}
        </TabsContent>
        <TabsContent value="review">
          {homeScreen === "review" ? (
            <ReviewQueueList
              entries={buildReviewQueue(graphs.display, state.kcs, now, locale)}
              now={now}
              onPracticeAll={session.busy ? undefined : () => void startSession({ kind: "review" })}
              onPracticeKc={session.busy ? undefined : (kcId) => void startSession({ kind: "remedial", kcIds: [kcId] })}
            />
          ) : null}
        </TabsContent>
        <TabsContent value="simulation">
          {homeScreen === "simulation" ? (
            <SimulationPanel
              rows={graphs.rows}
              contentHash={manifest.contentHash}
              locale={locale}
              onStartCase={session.busy ? undefined : (itemId) => void startSession({ kind: "simulation", itemId })}
            />
          ) : null}
        </TabsContent>
      </Tabs>
    </DojoPathLayout>
  );
}
