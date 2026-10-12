import type { ReactNode } from "react";
import { cn } from "../lib/utils";

export type ProgressRingProps = {
  value: number;
  /** The goal. Values above it render an "over goal" second lap. */
  goal: number;
  /** Accessible name, e.g. "Daily XP goal". */
  ariaLabel: string;
  /** Accessible value text, e.g. "30 of 50 XP". Translated by the caller. */
  valueText: string;
  /** Visible content in the center (number, icon, short label). */
  children?: ReactNode;
  size?: "sm" | "md" | "lg";
  className?: string;
};

export type ProgressRingState = "empty" | "partial" | "full" | "over";

export function progressRingState(value: number, goal: number): ProgressRingState {
  if (value <= 0) return "empty";
  if (goal <= 0 || value > goal) return "over";
  if (value === goal) return "full";
  return "partial";
}

const RADIUS = 16;
const CIRCUMFERENCE = 2 * Math.PI * RADIUS;

/** Circular goal progress. Over goal draws a magenta second lap over the full green ring. */
export function ProgressRing({ value, goal, ariaLabel, valueText, children, size = "md", className }: ProgressRingProps) {
  const state = progressRingState(value, goal);
  const ratio = goal > 0 ? Math.min(1, Math.max(0, value / goal)) : 1;
  const overRatio = goal > 0 && value > goal ? Math.min(1, (value - goal) / goal) : 0;

  return (
    <div
      className={cn("dj-progress-ring", className)}
      data-size={size}
      data-state={state}
      role="progressbar"
      aria-label={ariaLabel}
      aria-valuemin={0}
      aria-valuemax={Math.max(goal, value)}
      aria-valuenow={Math.max(0, value)}
      aria-valuetext={valueText}
    >
      <svg viewBox="0 0 40 40" aria-hidden="true">
        <circle className="dj-progress-ring__track" cx="20" cy="20" r={RADIUS} fill="none" strokeWidth="4" />
        {ratio > 0 ? (
          <circle
            className="dj-progress-ring__value"
            cx="20"
            cy="20"
            r={RADIUS}
            fill="none"
            strokeWidth="4"
            strokeDasharray={CIRCUMFERENCE}
            strokeDashoffset={CIRCUMFERENCE * (1 - ratio)}
          />
        ) : null}
        {overRatio > 0 ? (
          <circle
            className="dj-progress-ring__over"
            cx="20"
            cy="20"
            r={RADIUS}
            fill="none"
            strokeWidth="4"
            strokeDasharray={CIRCUMFERENCE}
            strokeDashoffset={CIRCUMFERENCE * (1 - overRatio)}
          />
        ) : null}
      </svg>
      {children ? <span className="dj-progress-ring__label dj-type-label">{children}</span> : null}
    </div>
  );
}
