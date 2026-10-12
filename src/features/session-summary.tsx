"use client";

import * as React from "react";
import { localRef } from "../core/series";
import { ArrowRight, LifeBuoy, Target, Timer, Zap } from "lucide-react";
import { useFormatter, useTranslations } from "use-intl";
import { Button } from "../ui/button";
import { MasteryCrown, type MasteryLevel } from "../ui/mastery-crown";
import { StreakBadge, type StreakStatus } from "../ui/streak-badge";
import { cn } from "../lib/utils";
import type { StreakChange } from "../core/gamification";

export type SessionKcChange = {
  kcId: string;
  /** Locale-resolved KC title (curriculum data). */
  title: string;
  /** Recall probability before / after this session (0..1). */
  pBefore: number;
  pAfter: number;
  masteryBefore: MasteryLevel;
  masteryAfter: MasteryLevel;
};

export type SessionSummaryProps = {
  /** XP from items, without the session bonus. */
  xp: number;
  bonusXp?: number;
  itemsDone: number;
  itemsPassed: number;
  /** 0..1, or null when nothing was graded. */
  accuracy: number | null;
  activeSec: number;
  today: { xp: number; goalXp: number };
  kcs: readonly SessionKcChange[];
  streak: { change: StreakChange; count: number; freezeEarned?: boolean; freezesLeft: number };
  /** Offered when the session had misses. */
  remedial?: { itemCount: number; onStart?: () => void };
  onContinue?: () => void;
  className?: string;
};

const STREAK_STATUS: Record<StreakChange, StreakStatus> = {
  extended: "active",
  "kept-by-freeze": "frozen",
  reset: "broken",
  unchanged: "active",
};

const STREAK_KEY = { extended: "extended", "kept-by-freeze": "keptByFreeze", reset: "reset", unchanged: "unchanged" } as const;

/** Result screen: KPI strip, streak change, strengthened KCs (p before → after), remedial pack CTA. */
export function SessionSummary({
  xp,
  bonusXp = 0,
  itemsDone,
  itemsPassed,
  accuracy,
  activeSec,
  today,
  kcs,
  streak,
  remedial,
  onContinue,
  className,
}: SessionSummaryProps) {
  const t = useTranslations("dojo.summary");
  const format = useFormatter();
  const percent = (value: number) => format.number(Math.min(1, Math.max(0, value)), { style: "percent" });
  const tone = accuracy === null ? "good" : accuracy >= 0.999 ? "perfect" : accuracy >= 0.7 ? "good" : "rough";
  const minutes = Math.floor(activeSec / 60);
  const seconds = Math.round(activeSec % 60);
  const titleId = React.useId();

  return (
    <section className={cn("dj-dojo-summary", className)} data-tone={tone} aria-labelledby={titleId} data-region>
      <header className="dj-dojo-summary__header">
        <h2 className="dj-type-heading-xl" id={titleId}>{t(`title.${tone}`)}</h2>
        <p className="dj-type-body-sm dj-dojo-muted">{t("subtitle", { passed: itemsPassed, count: itemsDone })}</p>
      </header>

      <dl className="dj-dojo-summary__kpis">
        <div className="dj-dojo-kpi">
          <dt className="dj-dojo-kpi__label"><span className="dj-practice-milestone-tile" data-tone="amber" aria-hidden="true"><Zap /></span><span className="dj-type-label">{t("xpLabel")}</span></dt>
          <dd className="dj-dojo-kpi__value">
            <span className="dj-type-display">{t("xp", { count: xp + bonusXp })}</span>
            <span className="dj-type-caption dj-dojo-muted">{bonusXp > 0 ? t("xpBonus", { count: bonusXp }) : t("goal", { xp: today.xp, goal: today.goalXp })}</span>
          </dd>
        </div>
        <div className="dj-dojo-kpi">
          <dt className="dj-dojo-kpi__label"><span className="dj-practice-milestone-tile" data-tone="blue" aria-hidden="true"><Target /></span><span className="dj-type-label">{t("accuracyLabel")}</span></dt>
          <dd className="dj-dojo-kpi__value">
            <span className="dj-type-display">{accuracy === null ? t("noValue") : percent(accuracy)}</span>
            <span className="dj-type-caption dj-dojo-muted">{t("items", { passed: itemsPassed, count: itemsDone })}</span>
          </dd>
        </div>
        <div className="dj-dojo-kpi">
          <dt className="dj-dojo-kpi__label"><span className="dj-practice-milestone-tile" data-tone="indigo" aria-hidden="true"><Timer /></span><span className="dj-type-label">{t("timeLabel")}</span></dt>
          <dd className="dj-dojo-kpi__value">
            <span className="dj-type-display">{minutes > 0 ? t("durationMinutes", { minutes, seconds }) : t("durationSeconds", { seconds })}</span>
            <span className="dj-type-caption dj-dojo-muted">{t("activeTime")}</span>
          </dd>
        </div>
      </dl>

      <div className="dj-dojo-summary__streak" data-change={streak.change}>
        <StreakBadge count={streak.count} status={STREAK_STATUS[streak.change]} ariaLabel={t("streakAria", { count: streak.count })} />
        <div className="dj-dojo-summary__streak-text">
          <span className="dj-type-label">{t(`streak.${STREAK_KEY[streak.change]}`, { count: streak.count })}</span>
          <span className="dj-type-caption dj-dojo-muted">
            {streak.freezeEarned ? t("freezeEarned", { count: streak.freezesLeft }) : t("freezesLeft", { count: streak.freezesLeft })}
          </span>
        </div>
      </div>

      <section className="dj-dojo-summary__kcs" aria-labelledby={`${titleId}-kcs`}>
        <h3 className="dj-type-heading-sm" id={`${titleId}-kcs`}>{t("kcTitle")}</h3>
        {kcs.length === 0 ? <p className="dj-type-body-sm dj-dojo-muted">{t("kcEmpty")}</p> : (
          <ul className="dj-dojo-summary__kc-list">
            {kcs.map((kc) => {
              const up = kc.pAfter >= kc.pBefore;
              return (
                <li key={kc.kcId} className="dj-dojo-kc-change" data-direction={up ? "up" : "down"}>
                  <div className="dj-dojo-kc-change__identity">
                    <span className="dj-type-label">{kc.title}</span>
                    <code className="dj-type-caption dj-dojo-test__id" translate="no">{localRef(kc.kcId)}</code>
                  </div>
                  <div
                    className="dj-dojo-kc-change__meter"
                    role="img"
                    aria-label={t("kcAria", { title: kc.title, before: percent(kc.pBefore), after: percent(kc.pAfter) })}
                  >
                    <span className="dj-dojo-kc-change__before" style={{ inlineSize: `${kc.pBefore * 100}%` }} />
                    <span className="dj-dojo-kc-change__after" style={{ inlineSize: `${kc.pAfter * 100}%` }} />
                  </div>
                  <span className="dj-dojo-kc-change__values dj-type-data" aria-hidden="true">
                    {t("kcValues", { before: percent(kc.pBefore), after: percent(kc.pAfter) })}
                  </span>
                  <MasteryCrown
                    level={kc.masteryAfter}
                    hidePips
                    ariaLabel={t("masteryAria", { before: kc.masteryBefore, after: kc.masteryAfter })}
                  />
                </li>
              );
            })}
          </ul>
        )}
      </section>

      {remedial && remedial.itemCount > 0 ? (
        <div className="dj-dojo-summary__remedial">
          <span className="dj-practice-milestone-tile" data-tone="magenta" aria-hidden="true"><LifeBuoy /></span>
          <div className="dj-dojo-summary__remedial-text">
            <span className="dj-type-label">{t("remedialTitle")}</span>
            <span className="dj-type-body-sm dj-dojo-muted">{t("remedialBody", { count: remedial.itemCount })}</span>
          </div>
          <Button variant="outline" onClick={remedial.onStart} disabled={!remedial.onStart}>{t("remedialStart")}</Button>
        </div>
      ) : null}

      <div className="dj-dojo-summary__actions">
        <Button size="lg" onClick={onContinue} disabled={!onContinue}>
          {t("continue")}
          <ArrowRight aria-hidden="true" className="dj-dojo-flip-rtl" />
        </Button>
      </div>
    </section>
  );
}
