import { Flame, FlameKindling, Snowflake } from "lucide-react";
import { cn } from "../lib/utils";

export type StreakStatus = "active" | "at-risk" | "frozen" | "broken";

export type StreakBadgeProps = {
  count: number;
  status: StreakStatus;
  /** Full accessible description, e.g. "12-day streak, not practiced today". */
  ariaLabel: string;
  /** Optional visible status word (non-color cue), e.g. "Practice today". */
  statusLabel?: string;
  /** Formats the count (caller owns locale-aware number formatting). */
  formattedCount?: string;
  className?: string;
};

const tone: Record<StreakStatus, "amber" | "blue" | "neutral"> = {
  active: "amber",
  "at-risk": "amber",
  frozen: "blue",
  broken: "neutral",
};

/** Daily streak count with status. Icon, border style and text all encode the status. */
export function StreakBadge({ count, status, ariaLabel, statusLabel, formattedCount, className }: StreakBadgeProps) {
  const Icon = status === "frozen" ? Snowflake : status === "broken" ? FlameKindling : Flame;
  return (
    <span className={cn("dj-streak", className)} data-status={status} role="img" aria-label={ariaLabel}>
      <span className="dj-practice-milestone-tile" data-tone={tone[status]} aria-hidden="true">
        <Icon />
      </span>
      <span className="dj-streak__count" aria-hidden="true">{formattedCount ?? String(count)}</span>
      {statusLabel ? <span className="dj-streak__status dj-type-caption" aria-hidden="true">{statusLabel}</span> : null}
    </span>
  );
}
