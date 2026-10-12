"use client";

import * as React from "react";
import { Check, Quote, UserRound, X } from "lucide-react";
import { useFormatter, useTranslations } from "use-intl";
import { Button } from "../ui/button";
import { cn } from "../lib/utils";
import type { Grade } from "../core/learner-model";
import { Markdown } from "../ui/markdown";
import { InlineMarkdown } from "./item-parts";
import type { RubricCriterionView } from "./runtime";

/** One criterion as checked: by the learner, or decided by a forbidden phrase in the answer. */
export type JudgedCriterion = {
  id: string;
  met: boolean;
  /** The forbidden phrase found in the answer (data). */
  evidence?: string;
};

export type RubricJudgementAction =
  /** Final step of an item: pick the grade (Easy only by the learner's own choice). */
  | { kind: "grade"; suggested: Grade; selected: Grade | null; onGrade: (grade: Grade) => void }
  /** A case stage before the last: confirm the checks and reveal the next stage. */
  | { kind: "next"; onNext: () => void };

export type RubricJudgementProps = {
  criteria: readonly (RubricCriterionView & { forbidden?: readonly string[] })[];
  verdicts: Readonly<Record<string, JudgedCriterion>>;
  /** Locale-resolved model answer (Markdown). */
  modelAnswer: string;
  /** Omitted for a record that no longer acts (an earlier case stage). */
  action?: RubricJudgementAction;
  onToggle?: (criterionId: string, met: boolean) => void;
  disabled?: boolean;
  className?: string;
};

const GRADE_KEY = { 1: "again", 2: "hard", 3: "good", 4: "easy" } as const;

/**
 * Rubric self-check for one written answer. The learner reads the model
 * answer and ticks each criterion; a forbidden-phrase criterion is decided
 * by the phrase check and shows the phrase it found. The suggested grade
 * never goes above Good, and only an explicit click reaches Easy.
 */
export function RubricJudgement({ criteria, verdicts, modelAnswer, action, onToggle, disabled = false, className }: RubricJudgementProps) {
  const t = useTranslations("dojo.judge");
  const format = useFormatter();
  const [showModel, setShowModel] = React.useState(true);

  return (
    <section className={cn("dj-dojo-judge", className)} data-status="self" aria-label={t("title")}>
      <header className="dj-dojo-judge__header">
        <span className="dj-dojo-judge__source dj-type-label"><UserRound aria-hidden="true" />{t("bySelf")}</span>
        <span className="dj-type-caption dj-dojo-muted">{t("selfHint")}</span>
      </header>

      <div className="dj-dojo-judge__model">
        <Button variant="ghost" size="sm" aria-expanded={showModel} onClick={() => setShowModel((s) => !s)}>
          {showModel ? t("hideModel") : t("showModel")}
        </Button>
        {showModel ? <div className="dj-dojo-judge__model-body"><Markdown>{modelAnswer}</Markdown></div> : null}
      </div>

      <ul className="dj-dojo-judge__list">
        {criteria.map((criterion) => {
          const v = verdicts[criterion.id];
          const met = v?.met === true;
          const decided = Boolean(criterion.forbidden?.length);
          return (
            <li key={criterion.id} className="dj-dojo-judge__criterion" data-met={met ? "true" : "false"}>
              <span className="dj-dojo-judge__mark" aria-hidden="true">{met ? <Check /> : <X />}</span>
              <div className="dj-dojo-judge__text">
                <span className="dj-type-body"><InlineMarkdown>{criterion.description}</InlineMarkdown></span>
                {criterion.mustMention?.length ? (
                  <span className="dj-type-caption dj-dojo-muted">{t("mentions", { terms: format.list(criterion.mustMention, { type: "conjunction" }) })}</span>
                ) : null}
                {v?.evidence ? (
                  <blockquote className="dj-dojo-judge__evidence dj-type-body-sm">
                    <Quote aria-hidden="true" />
                    <span>{v.evidence}</span>
                  </blockquote>
                ) : null}
                {decided ? <span className="dj-type-caption dj-dojo-muted">{t("decidedByPhrase")}</span> : null}
              </div>
              {/* A forbidden-phrase criterion is decided by the phrase check, not by anyone's judgement. */}
              {onToggle && !decided ? (
                <div className="dj-dojo-judge__toggle" role="radiogroup" aria-label={t("toggleLabel", { criterion: criterion.description })}>
                  <Button size="sm" variant={met ? "primary" : "outline"} role="radio" aria-checked={met} disabled={disabled} onClick={() => onToggle(criterion.id, true)}>{t("met")}</Button>
                  <Button size="sm" variant={!met ? "primary" : "outline"} role="radio" aria-checked={!met} disabled={disabled} onClick={() => onToggle(criterion.id, false)}>{t("notMet")}</Button>
                </div>
              ) : null}
            </li>
          );
        })}
      </ul>

      {action?.kind === "grade" ? (
        <div className="dj-dojo-judge__grades" role="radiogroup" aria-label={t("gradeLegend")}>
          <span className="dj-type-label">{t("gradeLegend")}</span>
          <div className="dj-dojo-judge__grade-buttons">
            {([1, 2, 3, 4] as const).map((grade) => (
              <Button
                key={grade}
                variant={action.selected === grade ? "primary" : "outline"}
                size="sm"
                role="radio"
                aria-checked={action.selected === grade}
                data-grade={GRADE_KEY[grade]}
                data-suggested={action.suggested === grade || undefined}
                disabled={disabled}
                onClick={() => action.onGrade(grade)}
              >
                {t(`grade.${GRADE_KEY[grade]}`)}
                {action.suggested === grade ? <span className="dj-dojo-judge__suggested dj-type-caption">{t("suggested")}</span> : null}
              </Button>
            ))}
          </div>
          <span className="dj-type-caption dj-dojo-muted">{t("gradeNote")}</span>
        </div>
      ) : null}
      {action?.kind === "next" ? (
        <div className="dj-dojo-judge__next">
          <Button onClick={action.onNext} disabled={disabled}>{t("nextStage")}</Button>
        </div>
      ) : null}
    </section>
  );
}
