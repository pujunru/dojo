"use client";

import * as React from "react";
import type { Meta, StoryObj } from "@storybook/react-vite";
import type { CaseItem } from "../core/content-schema";
import type { Grade } from "../core/learner-model";
import { RubricJudgement, type JudgedCriterion } from "./rubric-judgement";
import { CaseItemView, type CaseAnswer } from "./item-views-write";
import { DojoStage, useIsZh } from "./dojo-stories-support";

const L = (zh: string, en: string) => ({ "zh-CN": zh, "en-US": en });

const caseFixture: CaseItem = {
  id: "dj-demo-case-escalation-spike",
  version: 1,
  type: "case",
  unit: "u-eval-basics",
  lesson: "l-eval-basics-2",
  kcs: [{ id: "eval-clarify", weight: 1 }, { id: "eval-metric-choice", weight: 0.5 }],
  archetype: "eval-design",
  skin: "support-agent",
  difficulty: 3,
  estSeconds: 900,
  runtime: "none",
  prompt: L("分段案例：每段答完才会出现下一段追问。", "Staged case: each follow-up appears once you answer the stage before."),
  explanation: L("先问决策和基线，再查分布变化，最后谈门禁。", "Ask about the decision and baseline, then check for distribution shift, then talk about the gate."),
  hints: [],
  checkpointFor: "u-eval-basics",
  scenario: L(
    "你负责一个客服智能体的评测。团队想下周把新模型换上线，问你怎么评。",
    "You own evals for a support agent. The team wants to ship a new model next week and asks how you would evaluate it.",
  ),
  stages: [
    {
      id: "plan",
      question: L("给一个评测方案：评什么、和谁比、用什么数据。", "Propose an eval plan: what you measure, against what, on which data."),
      rubric: {
        passAt: 0.7,
        criteria: [
          { id: "baseline", kcs: ["eval-clarify"], weight: 2, description: L("和现网模型在同一份数据上对比", "Compares against the production model on the same data"), mustMention: ["基线"] },
          { id: "traffic", kcs: ["eval-clarify"], weight: 1, description: L("评测数据来自真实流量的分层抽样", "Eval data is a stratified sample of real traffic") },
          { id: "no-bleu", kcs: ["eval-metric-choice"], weight: 1, description: L("不拿 BLEU 或困惑度当产品指标", "Does not use BLEU or perplexity as the product metric"), forbidden: ["BLEU", "perplexity", "困惑度"] },
        ],
      },
      modelAnswer: L(
        "目标是决定能否替换现网，所以基线是现网模型。从最近两周真实工单分层抽样 800 条，按意图和语言分层，两边同题对比解决率和升级率。",
        "The goal is a replace-or-not decision, so the baseline is the production model. Sample 800 recent real tickets stratified by intent and language, and compare resolution and escalation rates on the same items.",
      ),
    },
    {
      id: "spike",
      question: L(
        "**新约束**：上线灰度一天后，升级到人工的比例一夜翻倍。离线评测是持平的。你先查什么？",
        "**New constraint**: one day into the canary, the escalation rate doubled overnight. The offline eval was flat. What do you check first?",
      ),
      rubric: {
        passAt: 0.7,
        criteria: [
          { id: "shift", kcs: ["eval-clarify"], weight: 2, description: L("先查线上流量和评测集的分布差异", "First checks for a distribution gap between live traffic and the eval set") },
          { id: "slice", kcs: ["eval-metric-choice"], weight: 1, description: L("按切片（意图、语言、渠道）看升级率", "Breaks escalation down by slice (intent, language, channel)") },
        ],
      },
      modelAnswer: L(
        "离线持平而线上翻倍，最可能是分布变了：先比较灰度流量和评测集在意图、语言、渠道上的占比，再按切片看升级率，找出是哪一块在升。",
        "Flat offline but doubled online most likely means the distribution moved: compare the canary traffic's mix of intents, languages and channels with the eval set, then break escalation down by slice to find which part rose.",
      ),
    },
  ],
};

const criteriaOf = (zh: boolean, stage = 0) =>
  caseFixture.stages[stage].rubric.criteria.map((c) => ({ id: c.id, description: zh ? c.description["zh-CN"] : c.description["en-US"], weight: c.weight, mustMention: c.mustMention, forbidden: c.forbidden }));

/** After the learner ticked one criterion; the phrase check decided "no-bleu". */
const checked: Record<string, JudgedCriterion> = {
  baseline: { id: "baseline", met: true },
  traffic: { id: "traffic", met: false },
  "no-bleu": { id: "no-bleu", met: false, evidence: "BLEU" },
};

function Judgement({ verdicts, action = "grade" }: { verdicts: Record<string, JudgedCriterion>; action?: "grade" | "next" }) {
  const zh = useIsZh();
  const [state, setState] = React.useState(verdicts);
  const [grade, setGrade] = React.useState<Grade | null>(null);
  return (
    <DojoStage width="48rem">
      <RubricJudgement
        criteria={criteriaOf(zh)}
        verdicts={state}
        modelAnswer={zh ? caseFixture.stages[0].modelAnswer["zh-CN"] : caseFixture.stages[0].modelAnswer["en-US"]}
        action={action === "grade" ? { kind: "grade", suggested: 2, selected: grade, onGrade: setGrade } : { kind: "next", onNext: () => {} }}
        onToggle={(id, met) => setState((cur) => ({ ...cur, [id]: { id, met } }))}
      />
    </DojoStage>
  );
}

const meta = {
  title: "Dojo / Case and Judge",
  tags: ["autodocs"],
  parameters: {
    layout: "fullscreen",
    docs: { description: { component: "`RubricJudgement` is the self-check for a written answer: the model answer, then each criterion to mark met or not; a criterion with `forbidden` phrases is decided by the phrase check and shows the phrase found. It ends with the grade (suggestion capped at Good; Easy only by choice). `CaseItemView` is a staged case: the scenario stays on top and each follow-up stage appears once the previous one is judged." } },
  },
} satisfies Meta;

export default meta;
type Story = StoryObj<typeof meta>;

export const SelfCheckEmpty: Story = { render: () => <Judgement verdicts={{ "no-bleu": checked["no-bleu"] }} /> };
export const SelfCheckDone: Story = { render: () => <Judgement verdicts={checked} /> };
export const SelfCheckBeforeNextStage: Story = { render: () => <Judgement verdicts={checked} action="next" /> };

function CaseStory({ stage, judged }: { stage: number; judged: boolean }) {
  const zh = useIsZh();
  const [answer, setAnswer] = React.useState<CaseAnswer>({
    current: stage,
    texts: {
      plan: zh ? "替换现网的决定，基线是现网模型：和现网模型在同样的 800 条工单上比较，看解决率。指标我会看 BLEU。" : "This is a replace decision, so the baseline is production: compare on the same 800 tickets, looking at resolution. I'd also track BLEU.",
      ...(stage > 0 ? { spike: "" } : {}),
    },
  });
  const submitted = new Set(caseFixture.stages.slice(0, judged ? stage + 1 : stage).map((s) => s.id));
  return (
    <DojoStage width="52rem">
      <CaseItemView
        item={caseFixture}
        answer={answer}
        onAnswerChange={setAnswer}
        platform="runner"
        submitted={submitted}
        judgementFor={(id) => id === "plan" ? (
          <RubricJudgement
            criteria={criteriaOf(zh)}
            verdicts={checked}
            modelAnswer={zh ? caseFixture.stages[0].modelAnswer["zh-CN"] : caseFixture.stages[0].modelAnswer["en-US"]}
            action={{ kind: "next", onNext: () => {} }}
          />
        ) : null}
      />
    </DojoStage>
  );
}

export const CaseFirstStage: Story = { render: () => <CaseStory stage={0} judged={false} /> };
export const CaseFirstStageJudged: Story = { render: () => <CaseStory stage={0} judged /> };
export const CaseSecondStageRevealed: Story = { render: () => <CaseStory stage={1} judged={false} /> };
export const CaseNarrow: Story = {
  render: () => <CaseStory stage={0} judged />,
  parameters: { viewport: { defaultViewport: "workspace-mobile" } },
  globals: { viewport: "workspace-mobile" },
};
