"use client";

import { useEffect, useRef, useState } from "react";
import { AlarmClock, Pause, Timer } from "lucide-react";
import { cn } from "../lib/utils";

export type CountdownState = "normal" | "warning" | "overtime";

export type CountdownLabels = {
  /** Accessible name of the timer, e.g. "Time remaining". */
  name: string;
  /** Visible state words (non-color cue). */
  warning: string;
  overtime: string;
  paused: string;
  /** Announced once when a threshold is crossed (not every second). */
  announceWarning: string;
  announceOvertime: string;
};

export type CountdownProps = {
  /** Seconds left; negative values mean overtime. The caller owns the clock. */
  remainingSeconds: number;
  totalSeconds: number;
  paused?: boolean;
  /** Share of the total at or below which the warning state starts. */
  warningRatio?: number;
  labels: CountdownLabels;
  /** Override time formatting (default `m:ss`, `h:mm:ss` past one hour). */
  formatTime?: (seconds: number) => string;
  showMeter?: boolean;
  className?: string;
};

export function formatClock(totalSeconds: number) {
  const seconds = Math.max(0, Math.floor(totalSeconds));
  const hours = Math.floor(seconds / 3600);
  const minutes = Math.floor((seconds % 3600) / 60);
  const rest = seconds % 60;
  const pad = (value: number) => String(value).padStart(2, "0");
  return hours > 0 ? `${hours}:${pad(minutes)}:${pad(rest)}` : `${minutes}:${pad(rest)}`;
}

export function countdownState(remainingSeconds: number, totalSeconds: number, warningRatio = 0.2): CountdownState {
  if (remainingSeconds < 0) return "overtime";
  if (totalSeconds > 0 && remainingSeconds <= totalSeconds * warningRatio) return "warning";
  return "normal";
}

/**
 * Presentational timer. Counts down to zero, then counts up as overtime with a
 * distinct dashed treatment and a "+" prefix. The time itself is not a live
 * region; only threshold crossings are announced.
 */
export function Countdown({ remainingSeconds, totalSeconds, paused = false, warningRatio = 0.2, labels, formatTime = formatClock, showMeter = true, className }: CountdownProps) {
  const state = countdownState(remainingSeconds, totalSeconds, warningRatio);
  const previous = useRef<CountdownState | null>(null);
  const [announcement, setAnnouncement] = useState("");

  useEffect(() => {
    const before = previous.current;
    previous.current = state;
    if (before === null || before === state) return;
    if (state === "warning") setAnnouncement(labels.announceWarning);
    if (state === "overtime") setAnnouncement(labels.announceOvertime);
  }, [state, labels.announceWarning, labels.announceOvertime]);

  const overtime = state === "overtime";
  const display = overtime ? `+${formatTime(-remainingSeconds)}` : formatTime(remainingSeconds);
  const ratio = totalSeconds > 0 ? Math.min(1, Math.max(0, remainingSeconds / totalSeconds)) : 0;
  const stateWord = paused ? labels.paused : state === "warning" ? labels.warning : overtime ? labels.overtime : "";
  const Icon = paused ? Pause : overtime ? AlarmClock : Timer;

  return (
    <div className={cn("dj-countdown", className)} data-state={state} data-paused={paused ? "true" : undefined}>
      <Icon aria-hidden="true" />
      <span role="timer" aria-live="off" aria-label={`${labels.name}${stateWord ? ` (${stateWord})` : ""}: ${display}`} className="dj-countdown__time">
        {display}
      </span>
      {showMeter && !overtime ? (
        <span className="dj-countdown__meter" aria-hidden="true">
          <span className="dj-countdown__meter-fill" style={{ width: `${ratio * 100}%` }} />
        </span>
      ) : null}
      {stateWord ? <span className="dj-countdown__state dj-type-caption" aria-hidden="true">{stateWord}</span> : null}
      <span className="dj-practice-sr-only" role="status" aria-live="polite">{announcement}</span>
    </div>
  );
}
