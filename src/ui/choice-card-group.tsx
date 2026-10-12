"use client";

import { useId, type ReactNode } from "react";
import { AlertTriangle, Check, X } from "lucide-react";
import { cn } from "../lib/utils";

export type ChoiceCardOption = {
  value: string;
  label: ReactNode;
  description?: ReactNode;
  /** Optional code snippet, rendered monospace and LTR. */
  code?: string;
  disabled?: boolean;
};

export type ChoiceCardReveal = {
  /** Values that are correct answers. */
  correct: readonly string[];
  /** Per-option explanation shown after reveal. */
  explanations?: Partial<Record<string, ReactNode>>;
};

/** Verdict labels shown with the icon after reveal, translated by the caller. */
export type ChoiceCardRevealLabels = {
  correct: string;
  incorrect: string;
  missed: string;
};

export type ChoiceCardGroupProps = {
  mode: "single" | "multiple";
  options: readonly ChoiceCardOption[];
  value: readonly string[];
  onChange: (value: string[]) => void;
  /** Accessible group name (visible legend when `showLegend`). */
  legend: string;
  showLegend?: boolean;
  disabled?: boolean;
  reveal?: ChoiceCardReveal;
  revealLabels?: ChoiceCardRevealLabels;
  columns?: 1 | 2;
  name?: string;
  className?: string;
};

type Verdict = "correct" | "incorrect" | "missed" | undefined;

function verdictFor(value: string, selected: boolean, reveal?: ChoiceCardReveal): Verdict {
  if (!reveal) return undefined;
  const isCorrect = reveal.correct.includes(value);
  if (selected) return isCorrect ? "correct" : "incorrect";
  return isCorrect ? "missed" : undefined;
}

/**
 * Answer cards for single-choice (native radio group) or multiple-choice (native
 * checkboxes). Native inputs give arrow-key / Space semantics for free; cards
 * can hold code. After `reveal`, each card shows a verdict icon + text and an
 * optional explanation, and the group becomes read-only.
 */
export function ChoiceCardGroup({
  mode,
  options,
  value,
  onChange,
  legend,
  showLegend = false,
  disabled = false,
  reveal,
  revealLabels,
  columns = 1,
  name,
  className,
}: ChoiceCardGroupProps) {
  const generatedName = useId();
  const groupName = name ?? generatedName;
  const locked = disabled || Boolean(reveal);

  const toggle = (optionValue: string, checked: boolean) => {
    if (locked) return;
    if (mode === "single") onChange([optionValue]);
    else onChange(checked ? [...value, optionValue] : value.filter((entry) => entry !== optionValue));
  };

  return (
    <fieldset
      className={cn("dj-choice-group", className)}
      data-columns={columns}
      role={mode === "single" ? "radiogroup" : "group"}
      aria-label={legend}
      aria-disabled={disabled || undefined}
    >
      {showLegend ? <legend className="dj-choice-group__legend dj-type-label">{legend}</legend> : null}
      {options.map((option) => {
        const selected = value.includes(option.value);
        const verdict = verdictFor(option.value, selected, reveal);
        const optionDisabled = locked || option.disabled;
        const explanation = reveal?.explanations?.[option.value];
        const id = `${groupName}-${option.value}`;
        return (
          <label
            key={option.value}
            htmlFor={id}
            className="dj-choice-card"
            data-selected={selected && !verdict ? "true" : undefined}
            data-reveal={verdict}
            data-disabled={optionDisabled ? "true" : undefined}
          >
            <input
              id={id}
              type={mode === "single" ? "radio" : "checkbox"}
              name={groupName}
              value={option.value}
              checked={selected}
              disabled={disabled || option.disabled}
              aria-readonly={reveal ? true : undefined}
              onChange={(event) => toggle(option.value, event.currentTarget.checked)}
            />
            <span className="dj-choice-card__control" data-shape={mode === "single" ? "radio" : "checkbox"} aria-hidden="true">
              {verdict === "incorrect" ? <X /> : verdict === "missed" ? null : selected ? <Check /> : null}
            </span>
            <span className="dj-choice-card__body">
              <span className="dj-choice-card__label dj-type-body">{option.label}</span>
              {option.description ? <span className="dj-choice-card__description dj-type-body-sm">{option.description}</span> : null}
              {option.code ? (
                <pre className="dj-choice-card__code" dir="ltr">
                  <code>{option.code}</code>
                </pre>
              ) : null}
              {verdict && revealLabels ? (
                <span className="dj-choice-card__verdict dj-type-caption">
                  {verdict === "correct" ? <Check aria-hidden="true" /> : verdict === "incorrect" ? <X aria-hidden="true" /> : <AlertTriangle aria-hidden="true" />}
                  {revealLabels[verdict]}
                </span>
              ) : null}
              {reveal && explanation ? <span className="dj-choice-card__explanation dj-type-body-sm">{explanation}</span> : null}
            </span>
          </label>
        );
      })}
    </fieldset>
  );
}
