"use client";

import * as React from "react";
import type { Meta, StoryObj } from "@storybook/react-vite";
import { useTranslations } from "use-intl";
import type { Grade } from "../core/learner-model";
import type { DojoItem, L10n } from "../core/content-schema";
import {
  AnswerCompare,
  ChooseDesignItemView,
  ExplainItemView,
  FeedbackSheet,
  FillBlankItemView,
  ImplementItemView,
  ItemFrame,
  NeedsRunnerNotice,
  OutputText,
  ParsonsItemView,
  PredictItemView,
  SpotBugItemView,
  VerdictMark,
  emptyFillBlankAnswer,
  emptyParsonsAnswer,
  type CodeRunState,
  type DojoPlatform,
  type ItemPhase,
  type ItemVerdict,
  type SandboxStatus,
} from "./index";
import {
  chooseDesignItem,
  explainAnswerText,
  explainItem,
  explainRubric,
  fillBlankItem,
  fillBlanks,
  implementAnswerBuggy,
  implementAnswerFixed,
  implementItem,
  parsonsAnswerCorrect,
  parsonsAnswerPartial,
  parsonsAnswerWrong,
  parsonsItem,
  predictChoiceItem,
  predictStdoutItem,
  runAllGreen,
  runBoundaryOnly,
  spotBugItem,
} from "./fixtures";
import { DojoStage, StateLabel, useIsZh } from "./dojo-stories-support";

const meta = {
  title: "Dojo / Item Views",
  tags: ["autodocs"],
  parameters: {
    docs: { description: { component: "Controlled item views for the MVP types. Each takes `item` (content-schema type), `answer`, `onAnswerChange`, `reveal` (verdict + q from the grader), `disabled` and `platform`; none fetches or runs code. Stories wrap each view in `ItemFrame` so the prompt, dock and feedback are visible: initial, answering, wrong reveal and right reveal. Code items show a clear “needs a code runner” state when none is registered." } },
  },
} satisfies Meta;

export default meta;
type Story = StoryObj<typeof meta>;

type Stage = "initial" | "answering" | "wrong" | "right";

function usePick() {
  const zh = useIsZh();
  return (text: L10n) => (zh ? text["zh-CN"] : text["en-US"]);
}

/** Frames an item view the way the player does, with feedback when revealed. */
function Framed({
  item,
  stage,
  complete,
  verdict,
  xp,
  correctAnswer,
  children,
  width = "48rem",
  checkKind,
  blocked,
}: {
  item: DojoItem;
  stage: Stage;
  complete: boolean;
  verdict?: ItemVerdict;
  xp?: number;
  correctAnswer?: React.ReactNode;
  children: React.ReactNode;
  width?: string;
  checkKind?: "check" | "run";
  blocked?: boolean;
}) {
  const pick = usePick();
  const revealed = stage === "wrong" || stage === "right";
  const phase: ItemPhase = revealed ? "revealed" : complete ? "answered" : "unanswered";
  const v: ItemVerdict = verdict ?? (stage === "right" ? "correct" : "incorrect");
  return (
    <DojoStage width={width}>
      <ItemFrame
        itemType={item.type}
        prompt={pick(item.prompt)}
        phase={phase}
        checkKind={checkKind}
        blocked={blocked}
        onHint={item.hints.length ? () => {} : undefined}
        onCheck={() => {}}
        onSkip={() => {}}
        onContinue={() => {}}
        feedback={revealed ? <FeedbackSheet verdict={v} xp={xp ?? (v === "correct" ? 3 : 0)} explanation={pick(item.explanation)} correctAnswer={v === "correct" ? undefined : correctAnswer} /> : undefined}
      >
        {children}
      </ItemFrame>
    </DojoStage>
  );
}

const revealFor = (stage: Stage, verdict?: ItemVerdict) =>
  stage === "right" ? { verdict: "correct" as const, q: 1 } : stage === "wrong" ? { verdict: verdict ?? ("incorrect" as const), q: verdict === "partial" ? 0.5 : 0 } : null;

/* ───────────── Predict ───────────── */

function PredictCase({ stage }: { stage: Stage }) {
  const initial = stage === "initial" ? {} : stage === "right" ? { stdout: "True 2\n['hot', 'cold']" } : stage === "wrong" ? { stdout: "False 1\n['cold']" } : { stdout: "True 2\n" };
  const [answer, setAnswer] = React.useState(initial);
  return (
    <Framed item={predictStdoutItem} stage={stage} complete={Boolean(answer.stdout?.trim())}>
      <PredictItemView item={predictStdoutItem} answer={answer} onAnswerChange={setAnswer} reveal={revealFor(stage)} platform="runner" />
    </Framed>
  );
}

export const PredictInitial: Story = { render: () => <PredictCase stage="initial" /> };
export const PredictAnswering: Story = { render: () => <PredictCase stage="answering" /> };
export const PredictWrongReveal: Story = { render: () => <PredictCase stage="wrong" /> };
export const PredictRightReveal: Story = { render: () => <PredictCase stage="right" /> };

function PredictChoiceCase({ stage }: { stage: Stage }) {
  const [answer, setAnswer] = React.useState<{ choice?: number }>(stage === "initial" ? {} : { choice: stage === "right" ? 1 : 0 });
  return (
    <Framed item={predictChoiceItem} stage={stage} complete={typeof answer.choice === "number"}>
      <PredictItemView item={predictChoiceItem} answer={answer} onAnswerChange={setAnswer} reveal={revealFor(stage)} platform="runner" />
    </Framed>
  );
}

export const PredictChoiceAnswering: Story = { render: () => <PredictChoiceCase stage="answering" /> };
export const PredictChoiceWrongReveal: Story = { render: () => <PredictChoiceCase stage="wrong" /> };

/* ───────────── Spot the bug ───────────── */

function SpotBugCase({ stage }: { stage: Stage }) {
  const selections: Record<Stage, number[]> = { initial: [], answering: [11], wrong: [11, 13], right: [11, 18] };
  const [answer, setAnswer] = React.useState({ selected: selections[stage].map((line) => ({ path: "bank.py", line })) });
  return (
    <Framed item={spotBugItem} stage={stage} complete={answer.selected.length > 0} verdict={stage === "wrong" ? "partial" : undefined} xp={stage === "wrong" ? 2 : undefined}>
      <SpotBugItemView item={spotBugItem} answer={answer} onAnswerChange={setAnswer} reveal={revealFor(stage, "partial")} platform="runner" />
    </Framed>
  );
}

export const SpotBugInitial: Story = { render: () => <SpotBugCase stage="initial" /> };
export const SpotBugAnswering: Story = { render: () => <SpotBugCase stage="answering" /> };
/** One bug found, one missed, one clean line marked: partially correct. */
export const SpotBugWrongReveal: Story = { render: () => <SpotBugCase stage="wrong" /> };
export const SpotBugRightReveal: Story = { render: () => <SpotBugCase stage="right" /> };

/* ───────────── Fill in the blank ───────────── */

function FillBlankCase({ stage }: { stage: Stage }) {
  const empty = emptyFillBlankAnswer(fillBlankItem);
  const values: Record<Stage, Record<string, string>> = {
    initial: {},
    answering: { touch: "self.data.move_to_end(key)" },
    wrong: { touch: "self.data.move_to_end(key)", evict: "self.data.popitem()" },
    right: { touch: "self.data.move_to_end(key)", evict: "self.data.popitem(last=False)" },
  };
  const [answer, setAnswer] = React.useState(() => fillBlanks(empty, values[stage]));
  return (
    <Framed item={fillBlankItem} stage={stage} complete={stage !== "initial"} verdict={stage === "wrong" ? "partial" : undefined}>
      <FillBlankItemView item={fillBlankItem} answer={answer} onAnswerChange={setAnswer} reveal={revealFor(stage, "partial")} platform="runner" />
    </Framed>
  );
}

export const FillBlankInitial: Story = { render: () => <FillBlankCase stage="initial" /> };
export const FillBlankAnswering: Story = { render: () => <FillBlankCase stage="answering" /> };
export const FillBlankWrongReveal: Story = { render: () => <FillBlankCase stage="wrong" /> };
export const FillBlankRightReveal: Story = { render: () => <FillBlankCase stage="right" /> };

/* ───────────── Parsons ───────────── */

function ParsonsCase({ stage }: { stage: Stage }) {
  const initial = { initial: emptyParsonsAnswer(parsonsItem, 7), answering: parsonsAnswerPartial, wrong: parsonsAnswerWrong, right: parsonsAnswerCorrect }[stage];
  const [answer, setAnswer] = React.useState(initial);
  return (
    <Framed item={parsonsItem} stage={stage} complete={answer.items.length > 0}>
      <ParsonsItemView item={parsonsItem} answer={answer} onAnswerChange={setAnswer} reveal={revealFor(stage)} platform="runner" />
    </Framed>
  );
}

export const ParsonsInitial: Story = { render: () => <ParsonsCase stage="initial" /> };
export const ParsonsAnswering: Story = { render: () => <ParsonsCase stage="answering" /> };
export const ParsonsWrongReveal: Story = { render: () => <ParsonsCase stage="wrong" /> };
export const ParsonsRightReveal: Story = { render: () => <ParsonsCase stage="right" /> };

/* ───────────── Choose design ───────────── */

function ChooseDesignCase({ stage }: { stage: Stage }) {
  const zh = useIsZh();
  const selected: Record<Stage, string[]> = { initial: [], answering: ["versions"], wrong: ["snapshot"], right: ["versions"] };
  const [answer, setAnswer] = React.useState({
    selected: selected[stage],
    rationale: stage === "initial" ? "" : zh ? "写入只是追加，历史读用 bisect，O(log n)。" : "Writes stay appends; history reads bisect in O(log n).",
  });
  return (
    <Framed item={chooseDesignItem} stage={stage} complete={answer.selected.length > 0}>
      <ChooseDesignItemView item={chooseDesignItem} answer={answer} onAnswerChange={setAnswer} reveal={revealFor(stage)} platform="runner" />
    </Framed>
  );
}

export const ChooseDesignInitial: Story = { render: () => <ChooseDesignCase stage="initial" /> };
export const ChooseDesignAnswering: Story = { render: () => <ChooseDesignCase stage="answering" /> };
export const ChooseDesignWrongReveal: Story = { render: () => <ChooseDesignCase stage="wrong" /> };
export const ChooseDesignRightReveal: Story = { render: () => <ChooseDesignCase stage="right" /> };

/* ───────────── Implement ───────────── */

function ImplementCase({ stage, run, sandbox = { state: "ready", runtimeLabel: "CPython 3.12 (Pyodide)" }, platform = "runner" }: { stage: Stage; run: CodeRunState; sandbox?: SandboxStatus; platform?: DojoPlatform }) {
  const initial = stage === "initial" ? { files: implementItem.starter.map((file) => ({ ...file })) } : stage === "right" ? implementAnswerFixed : implementAnswerBuggy;
  const [answer, setAnswer] = React.useState(initial);
  const verdict: ItemVerdict | undefined = stage === "wrong" ? "partial" : undefined;
  return (
    <Framed item={implementItem} stage={stage} complete={stage !== "initial"} verdict={verdict} xp={stage === "right" ? 8 : stage === "wrong" ? 7 : undefined} width="80rem" checkKind="run" blocked={platform === "no-runner"}>
      <ImplementItemView
        item={implementItem}
        answer={answer}
        onAnswerChange={setAnswer}
        reveal={revealFor(stage, "partial")}
        platform={platform}
        sandbox={sandbox}
        run={run}
        onReset={() => setAnswer({ files: implementItem.starter.map((file) => ({ ...file })) })}
        onRetrySandbox={() => {}}
       
      />
    </Framed>
  );
}

export const ImplementInitial: Story = { render: () => <ImplementCase stage="initial" run={{ state: "idle" }} /> };
export const ImplementProvisioning: Story = { render: () => <ImplementCase stage="initial" run={{ state: "idle" }} sandbox={{ state: "provisioning", progress: 0.6 }} /> };
export const ImplementRunning: Story = { render: () => <ImplementCase stage="answering" run={{ state: "running" }} /> };
/** The boundary bug fails one test; the failing assertion is shown next to the editor. */
export const ImplementTestResults: Story = { render: () => <ImplementCase stage="answering" run={{ state: "done", result: runBoundaryOnly }} /> };
export const ImplementWrongReveal: Story = { render: () => <ImplementCase stage="wrong" run={{ state: "done", result: runBoundaryOnly }} /> };
export const ImplementRightReveal: Story = { render: () => <ImplementCase stage="right" run={{ state: "done", result: runAllGreen }} /> };
export const ImplementNoRunner: Story = { render: () => <ImplementCase stage="initial" run={{ state: "idle" }} platform="no-runner" /> };
export const ImplementNarrow: Story = {
  render: () => <ImplementCase stage="answering" run={{ state: "done", result: runBoundaryOnly }} />,
  parameters: { viewport: { defaultViewport: "workspace-mobile" } },
  globals: { viewport: "workspace-mobile" },
};

/* ───────────── Explain ───────────── */

function ExplainCase({ stage, mode = "ai" }: { stage: Stage; mode?: "ai" | "self" }) {
  const zh = useIsZh();
  const pick = usePick();
  const [answer, setAnswer] = React.useState({ text: stage === "initial" ? "" : zh ? explainAnswerText.zh : explainAnswerText.en });
  const [grade, setGrade] = React.useState<Grade | null>(null);
  const { criteria, scores } = explainRubric(zh);
  const rightScores = scores.map((score) => ({ ...score, score: 1, evidence: score.evidence ?? (zh ? "“task_done() 放在 finally 里”" : "“task_done() goes in finally”") }));
  return (
    <Framed item={explainItem} stage={stage} complete={answer.text.trim().length >= 10} verdict={stage === "wrong" ? "partial" : undefined} xp={stage === "right" ? 5 : stage === "wrong" ? 3 : undefined}>
      <ExplainItemView
        item={explainItem}
        answer={answer}
        onAnswerChange={setAnswer}
        reveal={revealFor(stage, "partial")}
        platform="runner"
        grading={mode === "self"
          ? { mode: "self", criteria, modelAnswer: pick(explainItem.modelAnswer), selected: grade, onSelfGrade: setGrade }
          : { mode: "ai", criteria, scores: stage === "right" ? rightScores : scores, passAt: explainItem.rubric.passAt, total: stage === "right" ? 1 : 0.6 }}
      />
    </Framed>
  );
}

export const ExplainInitial: Story = { render: () => <ExplainCase stage="initial" /> };
export const ExplainAnswering: Story = { render: () => <ExplainCase stage="answering" /> };
export const ExplainWrongReveal: Story = { render: () => <ExplainCase stage="wrong" /> };
export const ExplainRightReveal: Story = { render: () => <ExplainCase stage="right" /> };
export const ExplainSelfGrade: Story = { render: () => <ExplainCase stage="wrong" mode="self" /> };

/* ───────────── Narrow + parts ───────────── */

export const SpotBugNarrow: Story = {
  render: () => <SpotBugCase stage="wrong" />,
  parameters: { viewport: { defaultViewport: "workspace-mobile" } },
  globals: { viewport: "workspace-mobile" },
};

export const ParsonsNarrow: Story = {
  render: () => <ParsonsCase stage="wrong" />,
  parameters: { viewport: { defaultViewport: "workspace-mobile" } },
  globals: { viewport: "workspace-mobile" },
};

/** Shared parts the item views compose: verdict marks, answer comparison, needs-runner notice. */
export const ItemParts: Story = {
  render: function ItemPartsStory() {
    const t = useTranslations("dojo.items");
    return (
    <DojoStage width="40rem">
      <StateLabel>VerdictMark</StateLabel>
      <div style={{ display: "flex", gap: "var(--space-4)", flexWrap: "wrap" }}>
        <VerdictMark tone="correct">{t("predict.reveal.correct")}</VerdictMark>
        <VerdictMark tone="partial">{t("spotBug.falsePositive")}</VerdictMark>
        <VerdictMark tone="incorrect">{t("predict.reveal.incorrect")}</VerdictMark>
      </div>
      <StateLabel>AnswerCompare · differs</StateLabel>
      <AnswerCompare correct={false} yours={<OutputText text={"False 1\n['cold']"} />} expected={<OutputText text={"True 2\n['hot', 'cold']"} />} />
      <StateLabel>AnswerCompare · matches</StateLabel>
      <AnswerCompare correct yours={<OutputText text={"True 2\n['hot', 'cold']"} />} expected={null} />
      <StateLabel>NeedsRunnerNotice</StateLabel>
      <NeedsRunnerNotice />
    </DojoStage>
    );
  },
};
