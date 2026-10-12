"use client";

import * as React from "react";
import type { Meta, StoryObj } from "@storybook/react-vite";
import type { DojoItem, L10n } from "../core/content-schema";
import {
  scoreChooseDesign,
  scoreFillBlank,
  scoreParsons,
  scorePredict,
  scoreSpotBug,
  scoreTests,
} from "../core/grading";
import { itemXp } from "../core/gamification";
import {
  ChooseDesignItemView,
  ExplainItemView,
  FeedbackSheet,
  FillBlankItemView,
  HintPanel,
  ImplementItemView,
  ItemFrame,
  LessonPlayerLayout,
  LessonProgressBar,
  ParsonsItemView,
  PredictItemView,
  SessionSummary,
  SpotBugItemView,
  emptyChooseDesignAnswer,
  emptyExplainAnswer,
  emptyFillBlankAnswer,
  emptyImplementAnswer,
  emptyParsonsAnswer,
  emptyPredictAnswer,
  emptySpotBugAnswer,
  fillBlankValues,
  isChooseDesignAnswerComplete,
  isExplainAnswerComplete,
  isFillBlankAnswerComplete,
  isImplementAnswerComplete,
  isParsonsAnswerComplete,
  isPredictAnswerComplete,
  isSpotBugAnswerComplete,
  parsonsOrder,
  type CodeRunState,
  type DojoPlatform,
  type ItemReveal,
  type ItemVerdict,
} from "./index";
import {
  chooseDesignItem,
  explainItem,
  explainRubric,
  fillBlankItem,
  implementAnswerBuggy,
  implementItem,
  parsonsItem,
  predictChoiceItem,
  runAllGreen,
  runBoundaryOnly,
  sessionKcChanges,
  spotBugItem,
} from "./fixtures";
import { useIsZh } from "./dojo-stories-support";

const meta = {
  title: "Dojo / Lesson Player",
  tags: ["autodocs"],
  parameters: {
    docs: { description: { component: "Page composition of the session player, assembled from `LessonPlayerLayout`, `LessonProgressBar`, `ItemFrame`, the item views, `HintPanel`, `FeedbackSheet`, `RuntimeStatus` / `TestResultList` and `SessionSummary`. The story is a working mock: answers are graded with the real `core/grading` functions; the implement item “runs” against fixture results. The dock stays at the bottom edge so Check / Continue are reachable on a phone." } },
  },
  decorators: [(Story) => <div data-workspace-root style={{ background: "var(--background)", minHeight: "100dvh" }}><Story /></div>],
} satisfies Meta;

export default meta;
type Story = StoryObj<typeof meta>;

const SESSION: DojoItem[] = [predictChoiceItem, spotBugItem, fillBlankItem, parsonsItem, chooseDesignItem, implementItem, explainItem];

type Answers = Record<string, unknown>;

function emptyAnswer(item: DojoItem): unknown {
  switch (item.type) {
    case "predict": return emptyPredictAnswer();
    case "spot-bug": return emptySpotBugAnswer();
    case "fill-blank": return emptyFillBlankAnswer(item);
    case "parsons": return emptyParsonsAnswer(item, 11);
    case "choose-design": return emptyChooseDesignAnswer();
    case "implement": return emptyImplementAnswer(item);
    case "explain": return emptyExplainAnswer();
    default: return null;
  }
}

function isComplete(item: DojoItem, answer: unknown): boolean {
  switch (item.type) {
    case "predict": return isPredictAnswerComplete(item, answer as never);
    case "spot-bug": return isSpotBugAnswerComplete(answer as never);
    case "fill-blank": return isFillBlankAnswerComplete(answer as never);
    case "parsons": return isParsonsAnswerComplete(answer as never);
    case "choose-design": return isChooseDesignAnswerComplete(answer as never);
    case "implement": return isImplementAnswerComplete(item, answer as never);
    case "explain": return isExplainAnswerComplete(answer as never);
    default: return false;
  }
}

const verdictOf = (q: number, passAt = 1): ItemVerdict => (q >= passAt - 1e-9 ? "correct" : q > 0 ? "partial" : "incorrect");

/** Grades with the real scorers; the implement "run" is a fixture keyed on the boundary fix. */
function grade(item: DojoItem, answer: unknown): { reveal: ItemReveal; run?: CodeRunState } {
  const kcs = item.kcs.map((kc) => kc.id);
  switch (item.type) {
    case "predict": {
      const expected = item.answer.mode === "choice" ? { mode: "choice" as const, correct: item.answer.correct } : item.answer.mode === "stdout" ? item.answer : item.answer;
      const { q } = scorePredict({ kcs, expected, answer: answer as never });
      return { reveal: { verdict: verdictOf(q), q } };
    }
    case "spot-bug": {
      const { q } = scoreSpotBug({ kcs, bugs: item.bugs, tolerance: item.tolerance, selected: (answer as { selected: { path: string; line: number }[] }).selected });
      return { reveal: { verdict: verdictOf(q, 0.75), q } };
    }
    case "fill-blank": {
      const { q } = scoreFillBlank({ blanks: item.blanks, answers: fillBlankValues(answer as never) });
      return { reveal: { verdict: verdictOf(q), q } };
    }
    case "parsons": {
      const { q } = scoreParsons({ kcs, solutions: item.solutions, order: parsonsOrder(answer as never) });
      return { reveal: { verdict: verdictOf(q), q } };
    }
    case "choose-design": {
      const { q } = scoreChooseDesign({ kcs, options: item.options, selected: (answer as { selected: string[] }).selected });
      return { reveal: { verdict: verdictOf(q), q } };
    }
    case "implement": {
      const fixed = (answer as { files: { content: string }[] }).files.some((file) => file.content.includes(">= expires") || file.content.includes("now < "));
      const result = fixed ? runAllGreen : runBoundaryOnly;
      const results = result.status === "ok" ? result.results.map((outcome) => ({ id: outcome.id, passed: outcome.ok })) : [];
      const { q } = scoreTests({ kcs, testMeta: item.testMeta, results });
      return { reveal: { verdict: verdictOf(q), q }, run: { state: "done", result } };
    }
    case "explain":
      return { reveal: { verdict: "partial", q: 0.6 } };
    default:
      return { reveal: { verdict: "incorrect", q: 0 } };
  }
}

type PlayerState = {
  index: number;
  answers: Answers;
  reveal: ItemReveal | null;
  hintsShown: number;
  hintOpen: boolean;
  run: CodeRunState;
  xp: number;
  passed: number;
  finished: boolean;
};

function LessonPlayerDemo({ platform = "runner", start = 0, preset }: { platform?: DojoPlatform; start?: number; preset?: (state: PlayerState) => PlayerState }) {
  const zh = useIsZh();
  const pick = (text: L10n) => (zh ? text["zh-CN"] : text["en-US"]);
  const [state, setState] = React.useState<PlayerState>(() => {
    const initial: PlayerState = {
      index: start,
      answers: Object.fromEntries(SESSION.map((item) => [item.id, emptyAnswer(item)])),
      reveal: null,
      hintsShown: 0,
      hintOpen: false,
      run: { state: "idle" },
      xp: 0,
      passed: 0,
      finished: false,
    };
    return preset ? preset(initial) : initial;
  });
  const item = SESSION[state.index]!;
  const answer = state.answers[item.id];
  const setAnswer = (value: unknown) => setState((current) => ({ ...current, answers: { ...current.answers, [item.id]: value } }));
  const blocked = item.runtime === "sandbox:python" && platform === "no-runner";

  const check = () => {
    if (item.type === "implement") {
      setState((current) => ({ ...current, run: { state: "running" } }));
      window.setTimeout(() => {
        const graded = grade(item, answer);
        setState((current) => ({ ...current, run: graded.run ?? current.run, reveal: graded.reveal, xp: current.xp + itemXp(item.type, graded.reveal.q), passed: current.passed + (graded.reveal.verdict === "correct" ? 1 : 0) }));
      }, 900);
      return;
    }
    const graded = grade(item, answer);
    setState((current) => ({ ...current, reveal: graded.reveal, xp: current.xp + itemXp(item.type, graded.reveal.q), passed: current.passed + (graded.reveal.verdict === "correct" ? 1 : 0) }));
  };
  const next = () => setState((current) => current.index + 1 >= SESSION.length
    ? { ...current, finished: true }
    : { ...current, index: current.index + 1, reveal: null, hintsShown: 0, hintOpen: false, run: { state: "idle" } });

  const progress = <LessonProgressBar done={state.finished ? SESSION.length : state.index + (state.reveal ? 1 : 0)} total={SESSION.length} onClose={() => {}} />;

  if (state.finished) {
    return (
      <LessonPlayerLayout progress={progress}>
        <div style={{ display: "grid", justifyItems: "center", alignContent: "start" }}>
          <SessionSummary
            xp={state.xp}
            bonusXp={5}
            itemsDone={SESSION.length}
            itemsPassed={state.passed}
            accuracy={state.passed / SESSION.length}
            activeSec={611}
            today={{ xp: state.xp + 5, goalXp: 30 }}
            kcs={sessionKcChanges(zh)}
            streak={{ change: "extended", count: 13, freezesLeft: 1 }}
            remedial={state.passed < SESSION.length ? { itemCount: SESSION.length - state.passed, onStart: () => {} } : undefined}
            onContinue={() => {}}
          />
        </div>
      </LessonPlayerLayout>
    );
  }

  const common = { reveal: state.reveal, platform, disabled: state.run.state === "running" };
  let view: React.ReactNode = null;
  switch (item.type) {
    case "predict": view = <PredictItemView item={item} answer={answer as never} onAnswerChange={setAnswer} {...common} />; break;
    case "spot-bug": view = <SpotBugItemView item={item} answer={answer as never} onAnswerChange={setAnswer} {...common} />; break;
    case "fill-blank": view = <FillBlankItemView item={item} answer={answer as never} onAnswerChange={setAnswer} {...common} />; break;
    case "parsons": view = <ParsonsItemView item={item} answer={answer as never} onAnswerChange={setAnswer} {...common} />; break;
    case "choose-design": view = <ChooseDesignItemView item={item} answer={answer as never} onAnswerChange={setAnswer} {...common} />; break;
    case "implement":
      view = (
        <ImplementItemView
          item={item}
          answer={answer as never}
          onAnswerChange={setAnswer}
          {...common}
          sandbox={{ state: "ready", runtimeLabel: "CPython 3.12 (Pyodide)" }}
          run={state.run}
          onReset={() => setAnswer(emptyImplementAnswer(item))}
         
        />
      );
      break;
    case "explain": {
      const { criteria, scores } = explainRubric(zh);
      view = <ExplainItemView item={item} answer={answer as never} onAnswerChange={setAnswer} {...common} grading={{ mode: "ai", criteria, scores, passAt: item.rubric.passAt, total: 0.6 }} />;
      break;
    }
  }

  const phase = state.reveal ? "revealed" : state.run.state === "running" ? "checking" : isComplete(item, answer) ? "answered" : "unanswered";
  const hints = item.hints.map(pick);

  return (
    <LessonPlayerLayout progress={progress} wide={item.type === "implement" && platform === "runner"}>
      <ItemFrame
        itemType={item.type}
        prompt={pick(item.prompt)}
        phase={phase}
        checkKind={item.type === "implement" ? "run" : "check"}
        blocked={blocked}
        hintOpen={state.hintOpen}
        hint={<HintPanel hints={hints} shown={state.hintsShown} onNextHint={() => setState((current) => ({ ...current, hintsShown: current.hintsShown + 1 }))} />}
        onHint={() => setState((current) => ({ ...current, hintOpen: !current.hintOpen, hintsShown: Math.max(1, current.hintsShown) }))}
        onCheck={check}
        onSkip={next}
        onContinue={next}
        feedback={state.reveal ? (
          <FeedbackSheet
            verdict={state.reveal.verdict}
            xp={itemXp(item.type, state.reveal.q)}
            explanation={pick(item.explanation)}
          />
        ) : undefined}
      >
        {view}
      </ItemFrame>
    </LessonPlayerLayout>
  );
}

/** Interactive: answer, Check, read the feedback, Continue — seven item types, then the summary. */
export const Interactive: Story = { render: () => <LessonPlayerDemo /> };

/** Spot-the-bug after a partially correct check: feedback sheet in the dock above Continue. */
export const RevealedPartial: Story = {
  render: () => (
    <LessonPlayerDemo
      start={1}
      preset={(state) => ({
        ...state,
        answers: { ...state.answers, [spotBugItem.id]: { selected: [{ path: "bank.py", line: 11 }, { path: "bank.py", line: 13 }] } },
        reveal: { verdict: "partial", q: 0.5 },
      })}
    />
  ),
};

export const RevealedCorrect: Story = {
  render: () => (
    <LessonPlayerDemo
      start={0}
      preset={(state) => ({ ...state, answers: { ...state.answers, [predictChoiceItem.id]: { choice: 1 } }, reveal: { verdict: "correct", q: 1 } })}
    />
  ),
};

/** Implement with a code runner, after a run: one hidden boundary test fails. */
export const ImplementWithResults: Story = {
  render: () => (
    <LessonPlayerDemo
      start={5}
      preset={(state) => ({ ...state, answers: { ...state.answers, [implementItem.id]: implementAnswerBuggy }, run: { state: "done", result: runBoundaryOnly } })}
    />
  ),
};

/** The same implement item without a code runner: Check disabled, Skip available. */
export const ImplementNoRunner: Story = { render: () => <LessonPlayerDemo start={5} platform="no-runner" /> };

export const SessionEnd: Story = {
  render: () => <LessonPlayerDemo preset={(state) => ({ ...state, finished: true, xp: 21, passed: 5 })} />,
};

export const Narrow: Story = {
  ...RevealedPartial,
  parameters: { viewport: { defaultViewport: "workspace-mobile" } },
  globals: { viewport: "workspace-mobile" },
};
