"use client";

/**
 * Picks the registered item view for the current item and wires it to the
 * session runner. No markup of its own: every visual is a Storybook-registered
 * composition from `src/features`.
 */
import { useLocale } from "use-intl";
import type { Locale } from "../i18n/config";
import { pickL10n, type DojoItem } from "../core/content-schema";
import type { Grade } from "../core/learner-model";
import {
  CaseItemView,
  ChooseDesignItemView,
  ExplainItemView,
  RubricJudgement,
  FillBlankItemView,
  ImplementItemView,
  LadderItemView,
  RefactorItemView,
  ReviewItemView,
  WriteTestsItemView,
  ParsonsItemView,
  PredictItemView,
  SpotBugItemView,
  type CaseAnswer,
  type DojoPlatform,
  type ItemReveal,
  type SandboxStatus,
} from "../features";
import type { ItemProgress } from "./use-dojo-session";
import { judgedParts, reviewDetail } from "./grade";
import { forbiddenPhrases } from "../core/rubric";
import { caseRubric, scoreCase, scoreChooseDesign, scoreJudged, suggestedGrade } from "../core/grading";
import { resetRunner } from "./runtimes";

const retrySandbox = () => resetRunner();

export function ItemSurface({
  item,
  progress,
  platform,
  sandbox,
  onAnswerChange,
  onReset,
  onSelfGrade,
  onSkipLevel,
  judge,
  now,
}: {
  item: DojoItem;
  progress: ItemProgress;
  platform: DojoPlatform;
  sandbox: SandboxStatus;
  onAnswerChange: (answer: unknown) => void;
  onReset: () => void;
  onSelfGrade: (grade: Grade) => void;
  onSkipLevel?: () => void;
  /** Self-checked items: tick a criterion, reveal the next case stage, grade. */
  judge: {
    onToggle: (part: string, criterionId: string, met: boolean) => void;
    onNext: () => void;
    onGrade: (grade: Grade) => void;
  };
  /** Clock for the ladder's level timer (ms), ticked by the page. */
  now?: number;
}) {
  const locale = useLocale() as Locale;
  const running = progress.run.state === "running";
  const answer = progress.answer as never;
  const common = { reveal: progress.reveal, platform, disabled: running, onAnswerChange };

  /** The suggested grade for the whole item from the verdicts so far (Good at most). */
  const suggestion = (): Grade => {
    const parts = judgedParts(item);
    const states = parts.map((jp) => progress.judge[jp.part]).filter(Boolean);
    const ticked = states.some((st) => st.touched);
    if (!ticked) return 3;
    const list = (part: string) => Object.values(progress.judge[part]?.verdicts ?? {});
    const kcs = item.kcs.map((k) => k.id);
    if (item.type === "case") return suggestedGrade(scoreCase(item, Object.fromEntries(parts.map((jp) => [jp.part, list(jp.part)]))).q, caseRubric(item).passAt);
    if (item.type === "choose-design" && item.rationale) {
      const rationaleQ = scoreJudged(item.rationale, list("rationale"), kcs).q;
      return suggestedGrade(scoreChooseDesign({ kcs, options: item.options, selected: (progress.answer as { selected: string[] }).selected, rationaleQ }).q, item.rationale.passAt);
    }
    return suggestedGrade(scoreJudged(parts[0].rubric, list(parts[0].part), kcs).q, parts[0].rubric.passAt);
  };

  /** The verdict panel of one judged part; `last` decides grade vs next stage. */
  const judgementFor = (part: string, last: boolean, past = false) => {
    const jp = judgedParts(item).find((x) => x.part === part);
    const state = progress.judge[part];
    if (!jp || !state) return null;
    // A past case stage stays visible as a record; only the current stage acts.
    const locked = Boolean(progress.reveal) || past;
    return (
      <RubricJudgement
        criteria={jp.rubric.criteria.map((c) => ({ id: c.id, description: pickL10n(c.description, locale), weight: c.weight, mustMention: c.mustMention, forbidden: forbiddenPhrases(c) }))}
        verdicts={state.verdicts}
        modelAnswer={pickL10n(jp.modelAnswer, locale)}
        action={past ? undefined : last
          ? { kind: "grade", suggested: suggestion(), selected: progress.selfGrade, onGrade: judge.onGrade }
          : { kind: "next", onNext: judge.onNext }}
        onToggle={locked ? undefined : (id, met) => judge.onToggle(part, id, met)}
        disabled={locked}
      />
    );
  };

  switch (item.type) {
    case "predict":
      return <PredictItemView item={item} answer={answer} {...common} />;
    case "spot-bug":
      return <SpotBugItemView item={item} answer={answer} {...common} />;
    case "fill-blank":
      return <FillBlankItemView item={item} answer={answer} {...common} />;
    case "parsons":
      return <ParsonsItemView item={item} answer={answer} {...common} />;
    case "choose-design":
      return <ChooseDesignItemView item={item} answer={answer} {...common} judgement={progress.judge.rationale ? judgementFor("rationale", true) : undefined} />;
    case "implement":
      return (
        <ImplementItemView
          item={item}
          answer={answer}
          {...common}
          sandbox={sandbox}
          run={progress.run}
          onRetrySandbox={retrySandbox}
          onReset={onReset}
        />
      );
    case "refactor":
      return <RefactorItemView item={item} answer={answer} {...common} sandbox={sandbox} run={progress.run} onReset={onReset} onRetrySandbox={retrySandbox} />;
    case "write-tests":
      return <WriteTestsItemView item={item} answer={answer} {...common} sandbox={sandbox} run={progress.run} onReset={onReset} onRetrySandbox={retrySandbox} />;
    case "review":
      return <ReviewItemView item={item} answer={answer} {...common} detail={progress.reveal ? reviewDetail(item, progress.answer as never) : null} />;
    case "ladder": {
      const ladder = progress.answer as { current: number; levels: Record<string, { elapsedSec: number }> };
      const level = item.levels[Math.min(ladder.current, item.levels.length - 1)];
      const spent = (ladder.levels[level.id]?.elapsedSec ?? 0) + Math.max(0, ((now ?? Date.now()) - progress.levelStartedAt) / 1000);
      return (
        <LadderItemView
          item={item}
          answer={answer}
          {...common}
          sandbox={sandbox}
          run={progress.run}
          onRetrySandbox={retrySandbox}
          remainingSeconds={Math.round(level.timeboxMin * 60 - spent)}
          onSkipLevel={onSkipLevel}
        />
      );
    }
    case "explain": {
      if (progress.judge.main) {
        return <ExplainItemView item={item} answer={answer} {...common} judgement={judgementFor("main", true)} />;
      }
      // While self-grading the answer is locked and the rubric shows; the
      // frame reveals only once a grade is picked.
      const gradingReveal: ItemReveal | null = progress.reveal ?? (progress.selfGrading ? { verdict: "partial", q: 0 } : null);
      return (
        <ExplainItemView
          item={item}
          answer={answer}
          {...common}
          reveal={gradingReveal}
          grading={gradingReveal ? {
            mode: "self",
            criteria: item.rubric.criteria.map((criterion) => ({
              id: criterion.id,
              description: pickL10n(criterion.description, locale),
              weight: criterion.weight,
              mustMention: criterion.mustMention,
            })),
            modelAnswer: pickL10n(item.modelAnswer, locale),
            selected: progress.selfGrade,
            onSelfGrade: progress.reveal ? undefined : onSelfGrade,
            disabled: Boolean(progress.reveal),
          } : undefined}
        />
      );
    }
    case "case": {
      const a = progress.answer as CaseAnswer;
      const submitted = new Set(item.stages.filter((st) => progress.judge[st.id]).map((st) => st.id));
      return (
        <CaseItemView
          item={item}
          answer={a}
          {...common}
          submitted={submitted}
          remainingSeconds={item.simulation && now ? item.simulation.minutes * 60 - (now - progress.shownAt) / 1000 : undefined}
          judgementFor={(stageId) => {
            const index = item.stages.findIndex((st) => st.id === stageId);
            return judgementFor(stageId, index === item.stages.length - 1, index < a.current);
          }}
        />
      );
    }
    default:
      return null;
  }
}
