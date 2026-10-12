"use client";


import { CalendarClock, Play, Snowflake } from "lucide-react";
import { useTranslations } from "use-intl";
import { Button } from "../ui/button";
import { ProgressRing } from "../ui/progress-ring";
import { StreakBadge, type StreakStatus } from "../ui/streak-badge";
import { cn } from "../lib/utils";

export type DojoHeaderStatsProps = {
  streak: { count: number; status: StreakStatus };
  today: { xp: number; goalXp: number };
  freezes: number;
  dueCount: number;
  /** No activity yet: show the welcome line instead of the at-risk nudge. */
  isNewUser?: boolean;
  /** An unfinished daily session exists; the primary action resumes it. */
  hasOpenSession?: boolean;
  onStartDaily?: () => void;
  startDisabled?: boolean;
  className?: string;
};

/**
 * Top strip of the dojo home: streak, today's XP ring, freezes, due
 * reviews and the one primary action. Four stat cells share one grid so the
 * values align; the action wins the cluster.
 */
export function DojoHeaderStats({
  streak,
  today,
  freezes,
  dueCount,
  isNewUser = false,
  hasOpenSession = false,
  onStartDaily,
  startDisabled = false,
  className,
}: DojoHeaderStatsProps) {
  const t = useTranslations("dojo.header");
  const goalMet = today.xp >= today.goalXp && today.goalXp > 0;
  const statusKey = streak.status === "at-risk" ? "atRisk" : streak.status;
  const notice = isNewUser
    ? { tone: "welcome", text: t("welcomeBody") }
    : streak.status === "at-risk"
      ? { tone: "risk", text: t("atRiskNotice", { count: streak.count }) }
      : null;

  return (
    <section className={cn("dj-dojo-header", className)} aria-label={t("region")} data-region>
      {isNewUser ? <h2 className="dj-dojo-header__welcome dj-type-heading-lg">{t("welcomeTitle")}</h2> : null}
      <div className="dj-dojo-header__row">
        <dl className="dj-dojo-header__stats">
          <div className="dj-dojo-stat">
            <dt className="dj-dojo-stat__label dj-type-caption">{t("streakLabel")}</dt>
            <dd className="dj-dojo-stat__value">
              <StreakBadge
                count={streak.count}
                status={streak.status}
                ariaLabel={t("streakAria", { count: streak.count, status: statusKey })}
              />
              <span className="dj-dojo-stat__note dj-type-caption" data-tone={streak.status} aria-hidden="true">{t(`streakStatus.${statusKey}`)}</span>
            </dd>
          </div>
          <div className="dj-dojo-stat">
            <dt className="dj-dojo-stat__label dj-type-caption">{t("goalLabel")}</dt>
            <dd className="dj-dojo-stat__value">
              <ProgressRing
                value={today.xp}
                goal={today.goalXp}
                size="sm"
                ariaLabel={t("goalLabel")}
                valueText={t("goalAria", { xp: today.xp, goal: today.goalXp })}
              />
              <span className="dj-dojo-stat__text">
                <span className="dj-type-data">{t("goalValue", { xp: today.xp, goal: today.goalXp })}</span>
                {goalMet ? <span className="dj-dojo-stat__note dj-type-caption" data-tone="success">{t("goalMet")}</span> : null}
              </span>
            </dd>
          </div>
          <div className="dj-dojo-stat">
            <dt className="dj-dojo-stat__label dj-type-caption">{t("freezesLabel")}</dt>
            <dd className="dj-dojo-stat__value">
              <span className="dj-practice-milestone-tile" data-tone={freezes > 0 ? "blue" : "neutral"} aria-hidden="true"><Snowflake /></span>
              <span className="dj-dojo-stat__text dj-type-label">{t("freezes", { count: freezes })}</span>
            </dd>
          </div>
          <div className="dj-dojo-stat">
            <dt className="dj-dojo-stat__label dj-type-caption">{t("dueLabel")}</dt>
            <dd className="dj-dojo-stat__value">
              <span className="dj-practice-milestone-tile" data-tone={dueCount > 0 ? "indigo" : "neutral"} aria-hidden="true"><CalendarClock /></span>
              <span className="dj-dojo-stat__text dj-type-label">{t("due", { count: dueCount })}</span>
            </dd>
          </div>
        </dl>
        <Button className="dj-dojo-header__action" size="lg" onClick={onStartDaily} disabled={startDisabled || !onStartDaily}>
          <Play aria-hidden="true" />
          {hasOpenSession ? t("resume") : t("start")}
        </Button>
      </div>
      {notice ? (
        <p className="dj-dojo-header__notice dj-type-body-sm" data-tone={notice.tone}>{notice.text}</p>
      ) : null}
    </section>
  );
}
