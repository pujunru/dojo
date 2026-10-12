import { Crown } from "lucide-react";
import { cn } from "../lib/utils";

export type MasteryLevel = 0 | 1 | 2 | 3 | 4 | 5;

export type MasteryCrownProps = {
  level: MasteryLevel;
  /** Decaying mastery: still earned, but due for review. */
  cracked?: boolean;
  /** Accessible name, e.g. "Mastery level 3 of 5, needs review". */
  ariaLabel: string;
  /** Hide the five level pips (e.g. in dense rows). */
  hidePips?: boolean;
  className?: string;
};

function toneFor(level: MasteryLevel) {
  if (level === 0) return "neutral";
  if (level === 5) return "magenta";
  return "amber";
}

/**
 * Mastery crown 0–5. Level is encoded three ways: numeral badge, filled pips and
 * color (neutral → amber → magenta at mastery). `cracked` desaturates the tile
 * and draws a crack, independent of color.
 */
export function MasteryCrown({ level, cracked = false, ariaLabel, hidePips = false, className }: MasteryCrownProps) {
  return (
    <span className={cn("dj-crown", className)} data-level={level} data-cracked={cracked ? "true" : undefined} role="img" aria-label={ariaLabel}>
      <span className="dj-practice-milestone-tile dj-crown__tile" data-tone={toneFor(level)} aria-hidden="true">
        <Crown className="dj-crown__glyph" />
        {cracked ? (
          <svg className="dj-crown__crack" viewBox="0 0 28 28" aria-hidden="true">
            <path d="M15 3 L12 10 L16 13 L11 20 L13 25" />
            <path d="M15 3 L12 10 L16 13 L11 20 L13 25" />
          </svg>
        ) : null}
        {level > 0 ? <span className="dj-crown__level">{level}</span> : null}
      </span>
      {hidePips ? null : (
        <span className="dj-crown__pips" aria-hidden="true">
          {Array.from({ length: 5 }, (_, index) => (
            <span key={index} className="dj-crown__pip" data-filled={index < level ? "true" : "false"} />
          ))}
        </span>
      )}
    </span>
  );
}
