"use client";

import * as React from "react";
import { CheckCircle2, CircleDashed, Lightbulb, Loader2, MessageCircleQuestion, RotateCw, X, XCircle } from "lucide-react";
import { useTranslations } from "use-intl";
import { Button } from "../ui/button";
import { cn } from "../lib/utils";
import { Markdown } from "../ui/markdown";
import type { DojoItemType, ItemPhase, ItemVerdict } from "./types";

/* ───────────────────────── LessonProgressBar ───────────────────────── */

export type LessonProgressBarProps = {
  /** Items already answered (0-based count). */
  done: number;
  /** Planned items, including items requeued after a miss. */
  total: number;
  /** Items appended by a requeue; shown so the growing length is explained. */
  requeued?: number;
  onClose?: () => void;
  className?: string;
};

/** Close button, a segmented-free progress track and the item counter. */
export function LessonProgressBar({ done, total, requeued = 0, onClose, className }: LessonProgressBarProps) {
  const t = useTranslations("dojo.player.progress");
  const ratio = total > 0 ? Math.min(1, Math.max(0, done / total)) : 0;
  return (
    <div className={cn("dj-dojo-progress", className)}>
      <Button variant="ghost" size="icon" onClick={onClose} aria-label={t("close")} disabled={!onClose}>
        <X aria-hidden="true" />
      </Button>
      <div
        className="dj-dojo-progress__track"
        role="progressbar"
        aria-label={t("label")}
        aria-valuemin={0}
        aria-valuemax={total}
        aria-valuenow={done}
        aria-valuetext={t("aria", { done, total })}
      >
        <span className="dj-dojo-progress__fill" style={{ inlineSize: `${ratio * 100}%` }} />
      </div>
      <span className="dj-dojo-progress__count dj-type-data" aria-hidden="true">{t("count", { done, total })}</span>
      {requeued > 0 ? <span className="dj-dojo-chip dj-type-caption" data-state="requeue"><RotateCw aria-hidden="true" />{t("requeued", { count: requeued })}</span> : null}
    </div>
  );
}

/* ───────────────────────── ItemFrame ───────────────────────── */

export const ITEM_TYPE_KEY = {
  predict: "predict",
  "spot-bug": "spotBug",
  "fill-blank": "fillBlank",
  parsons: "parsons",
  "choose-design": "chooseDesign",
  implement: "implement",
  refactor: "refactor",
  "write-tests": "writeTests",
  ladder: "ladder",
  case: "case",
  explain: "explain",
  review: "review",
} as const satisfies Record<DojoItemType, string>;

export type ItemFrameProps = {
  itemType: DojoItemType;
  /** Locale-resolved item prompt (Markdown, content data). */
  prompt: string;
  phase: ItemPhase;
  /** Item view (the answer surface). */
  children: React.ReactNode;
  /** Runtime status + test results for code items; sits beside the answer on wide screens. */
  aside?: React.ReactNode;
  /** Optional chips beside the type label, e.g. a "review" reason. */
  meta?: React.ReactNode;
  /** HintPanel, rendered under the answer when open. */
  hint?: React.ReactNode;
  /** FeedbackSheet, rendered in the dock once revealed. */
  feedback?: React.ReactNode;
  /** Shows the Hint action (false hides it, e.g. when no hints remain and AI is off). */
  canHint?: boolean;
  hintOpen?: boolean;
  onHint?: () => void;
  onCheck?: () => void;
  onContinue?: () => void;
  onSkip?: () => void;
  /** Code items after a failed run: stop and see the reference solution. Hidden when omitted. */
  onGiveUp?: () => void;
  /** Code items say "Run tests" rather than "Check". */
  checkKind?: "check" | "run";
  /** The item cannot be checked here (e.g. it needs a code runner this build lacks): Check stays disabled. */
  blocked?: boolean;
  className?: string;
};

/**
 * Prompt + answer slot + bottom action dock. The dock is sticky so Check and
 * Continue stay reachable on a phone; after a check the feedback sheet slides
 * into the same dock, directly above Continue.
 */
export function ItemFrame({
  itemType,
  prompt,
  phase,
  children,
  aside,
  meta,
  hint,
  feedback,
  canHint = true,
  hintOpen = false,
  onHint,
  onCheck,
  onContinue,
  onSkip,
  onGiveUp,
  checkKind = "check",
  blocked = false,
  className,
}: ItemFrameProps) {
  const t = useTranslations("dojo");
  const revealed = phase === "revealed";
  const checking = phase === "checking";
  const checkLabel = checking
    ? (checkKind === "run" ? t("player.frame.running") : t("player.frame.checking"))
    : (checkKind === "run" ? t("player.frame.runTests") : t("player.frame.check"));
  const headingId = React.useId();

  return (
    <article className={cn("dj-dojo-frame", className)} data-phase={phase} data-has-aside={aside ? "true" : undefined} aria-labelledby={headingId}>
      <div className="dj-dojo-frame__body">
        <header className="dj-dojo-frame__header">
          <div className="dj-dojo-frame__meta">
            <span className="dj-dojo-chip dj-type-caption" data-state="type" id={headingId}>{t(`itemType.${ITEM_TYPE_KEY[itemType]}`)}</span>
            {meta}
          </div>
          <Markdown className="dj-dojo-frame__prompt">{prompt}</Markdown>
        </header>
        <div className="dj-dojo-frame__content">
          <div className="dj-dojo-frame__answer">{children}</div>
          {aside ? <div className="dj-dojo-frame__aside">{aside}</div> : null}
        </div>
        {hintOpen && hint ? <div className="dj-dojo-frame__hint">{hint}</div> : null}
      </div>
      <div className="dj-dojo-frame__dock" data-phase={phase}>
        {revealed && feedback ? <div className="dj-dojo-frame__feedback">{feedback}</div> : null}
        <div className="dj-dojo-frame__actions" role="group" aria-label={t("player.frame.actions")}>
          {revealed ? (
            <Button className="dj-dojo-frame__primary" size="lg" onClick={onContinue} disabled={!onContinue}>
              {t("player.frame.continue")}
            </Button>
          ) : (
            <>
              <div className="dj-dojo-frame__secondary">
                {onSkip ? (
                  <Button variant="ghost" onClick={onSkip} disabled={checking}>{t("player.frame.skip")}</Button>
                ) : null}
                {onGiveUp ? (
                  <Button variant="ghost" onClick={onGiveUp} disabled={checking}>{t("player.frame.giveUp")}</Button>
                ) : null}
                {canHint && onHint ? (
                  <Button variant="outline" onClick={onHint} disabled={checking} aria-expanded={hintOpen}>
                    <Lightbulb aria-hidden="true" />
                    {t("player.frame.hint")}
                  </Button>
                ) : null}
              </div>
              <Button
                className="dj-dojo-frame__primary"
                size="lg"
                onClick={onCheck}
                disabled={blocked || checking || phase === "unanswered" || !onCheck}
                aria-busy={checking}
              >
                {checking ? <Loader2 className="dj-dojo-spin" aria-hidden="true" /> : null}
                {checkLabel}
              </Button>
            </>
          )}
        </div>
      </div>
    </article>
  );
}

/* ───────────────────────── ItemMetaChips ───────────────────────── */

export type ItemMetaChipsProps = {
  /** Why the composer put this item in the session. */
  reason?: "new" | "review" | "remedial" | "requeue";
  /** Code items: how many test runs so far (omit or 0 to hide). Runs are unlimited. */
  runCount?: number;
};

const REASON_CHIP_STATE = { new: "available", review: "count", remedial: "in-progress", requeue: "requeue" } as const;

/** Chips for the `ItemFrame` `meta` slot: the plan reason and, for code items, the runs left. */
export function ItemMetaChips({ reason, runCount = 0 }: ItemMetaChipsProps) {
  const t = useTranslations("dojo.player.meta");
  return (
    <>
      {reason ? <span className="dj-dojo-chip dj-type-caption" data-state={REASON_CHIP_STATE[reason]}>{t(`reason.${reason}`)}</span> : null}
      {runCount > 0 ? <span className="dj-dojo-chip dj-type-caption" data-state="count"><RotateCw aria-hidden="true" />{t("runCount", { count: runCount })}</span> : null}
    </>
  );
}

/* ───────────────────────── FeedbackSheet ───────────────────────── */

export type FeedbackSheetProps = {
  verdict: ItemVerdict;
  /** XP earned for this item; omitted when the grader has not answered yet. */
  xp?: number;
  /** Locale-resolved explanation (Markdown, content data). Always shown after answering. */
  explanation: string;
  /** e.g. the expected output or accepted answer, rendered under the title. */
  correctAnswer?: React.ReactNode;
  /** Interviewer follow-up question slot (question text + answer input). */
  followUp?: React.ReactNode;
  className?: string;
};

const VERDICT_ICON = { correct: CheckCircle2, partial: CircleDashed, incorrect: XCircle } as const;

/** Verdict (icon + title + color), XP, explanation and an optional follow-up question. */
export function FeedbackSheet({ verdict, xp, explanation, correctAnswer, followUp, className }: FeedbackSheetProps) {
  const t = useTranslations("dojo.player.feedback");
  const Icon = VERDICT_ICON[verdict];
  const titleId = React.useId();
  return (
    <section className={cn("dj-dojo-feedback", className)} data-verdict={verdict} aria-labelledby={titleId} role="status">
      <header className="dj-dojo-feedback__header">
        <Icon className="dj-dojo-feedback__icon" aria-hidden="true" />
        <h3 className="dj-dojo-feedback__title dj-type-heading-lg" id={titleId}>{t(`title.${verdict}`)}</h3>
        {typeof xp === "number" && xp > 0 ? <span className="dj-dojo-feedback__xp dj-type-data">{t("xp", { count: xp })}</span> : null}
      </header>
      {correctAnswer ? (
        <div className="dj-dojo-feedback__answer">
          <span className="dj-type-caption dj-dojo-feedback__label">{t("correctAnswer")}</span>
          {correctAnswer}
        </div>
      ) : null}
      <Markdown className="dj-dojo-feedback__explanation">{explanation}</Markdown>
      {followUp ? (
        <div className="dj-dojo-feedback__follow-up">
          <span className="dj-type-caption dj-dojo-feedback__label"><MessageCircleQuestion aria-hidden="true" />{t("followUpLabel")}</span>
          {followUp}
        </div>
      ) : null}
    </section>
  );
}

/* ───────────────────────── HintPanel ───────────────────────── */

export type HintPanelProps = {
  /** Locale-resolved static hints (Markdown), in order. */
  hints: readonly string[];
  /** How many are revealed (0..hints.length). */
  shown: number;
  onNextHint?: () => void;
  className?: string;
};

/** Ordered static hints, revealed one at a time. */
export function HintPanel({ hints, shown, onNextHint, className }: HintPanelProps) {
  const t = useTranslations("dojo.player.hint");
  const visible = hints.slice(0, Math.max(0, Math.min(shown, hints.length)));
  const exhausted = shown >= hints.length;
  return (
    <section className={cn("dj-dojo-hints", className)} aria-label={t("title")}>
      <header className="dj-dojo-hints__header">
        <Lightbulb className="dj-dojo-hints__icon" aria-hidden="true" />
        <h3 className="dj-type-heading-sm">{t("title")}</h3>
        {hints.length > 0 ? <span className="dj-type-caption dj-dojo-hints__count">{t("counter", { current: visible.length, total: hints.length })}</span> : null}
      </header>
      {hints.length === 0 ? <p className="dj-type-body-sm dj-dojo-muted">{t("empty")}</p> : null}
      {visible.length ? (
        <ol className="dj-dojo-hints__list">
          {visible.map((hint, index) => (
            <li key={index} className="dj-dojo-hints__item">
              <span className="dj-dojo-hints__index dj-type-caption" aria-hidden="true">{index + 1}</span>
              <Markdown>{hint}</Markdown>
            </li>
          ))}
        </ol>
      ) : null}
      <p className="dj-type-caption dj-dojo-muted">{t("penalty")}</p>
      <div className="dj-dojo-hints__actions" aria-live="polite">
        {!exhausted ? (
          <Button variant="outline" size="sm" onClick={onNextHint} disabled={!onNextHint}>{t("next")}</Button>
        ) : hints.length > 0 ? (
          <span className="dj-type-body-sm dj-dojo-muted">{t("exhausted")}</span>
        ) : null}
      </div>
    </section>
  );
}

/* ───────────────────────── Page layouts ───────────────────────── */

export type LessonPlayerLayoutProps = {
  /** LessonProgressBar. */
  progress: React.ReactNode;
  /** ItemFrame, or SessionSummary at the end. */
  children: React.ReactNode;
  /** Code items with a results panel use the wider track. */
  wide?: boolean;
  className?: string;
};

/** Player page: progress bar on top, the item frame filling the rest with its dock at the bottom edge. */
export function LessonPlayerLayout({ progress, children, wide = false, className }: LessonPlayerLayoutProps) {
  return (
    <div className={cn("dj-dojo-player-page", className)} data-wide={wide ? "true" : undefined} data-region>
      {progress}
      {children}
    </div>
  );
}

export type DojoPathLayoutProps = {
  /** DojoHeaderStats. */
  header: React.ReactNode;
  /** TierSection list. */
  children: React.ReactNode;
  className?: string;
};

/** Path page: the stats strip, then tiers of units in one reading column. */
export function DojoPathLayout({ header, children, className }: DojoPathLayoutProps) {
  return (
    <div className={cn("dj-dojo-path-page", className)} data-region>
      {header}
      {children}
    </div>
  );
}
