"use client";

import * as React from "react";
import type { Meta, StoryObj } from "@storybook/react-vite";
import { KcHeatmap, ReviewQueueList, SessionSummary, SimulationCard } from "./index";
import { fixtureNow, heatmapRows, reviewEntries, sessionKcChanges } from "./fixtures";
import { DojoStage, StateLabel, useIsZh } from "./dojo-stories-support";

const meta = {
  title: "Dojo / Progress and Review",
  tags: ["autodocs"],
  parameters: {
    docs: { description: { component: "After-session and between-session surfaces. `SessionSummary`: XP, accuracy and time KPIs, the streak change (extended / kept by a freeze / reset), strengthened KCs with recall p before → after and mastery, and the remedial-pack offer. `KcHeatmap`: units × KCs, recall band encoded by a green ramp, a fill pattern and the mastery numeral, with a due flag. `ReviewQueueList`: remedial, due (lowest p first) and upcoming KCs. `SimulationCard`: the launcher of a timed staged case." } },
  },
} satisfies Meta;

export default meta;
type Story = StoryObj<typeof meta>;

function SummaryStory({ variant }: { variant: "perfect" | "partial" | "reset" | "freeze" }) {
  const zh = useIsZh();
  const kcs = sessionKcChanges(zh);
  const props = {
    perfect: { xp: 26, bonusXp: 10, itemsDone: 8, itemsPassed: 8, accuracy: 1, activeSec: 547, today: { xp: 36, goalXp: 30 }, kcs: kcs.slice(0, 3), streak: { change: "extended" as const, count: 14, freezeEarned: true, freezesLeft: 2 } },
    partial: { xp: 19, bonusXp: 5, itemsDone: 9, itemsPassed: 6, accuracy: 0.67, activeSec: 712, today: { xp: 24, goalXp: 30 }, kcs, streak: { change: "extended" as const, count: 6, freezesLeft: 0 }, remedial: { itemCount: 4, onStart: () => {} } },
    reset: { xp: 12, bonusXp: 5, itemsDone: 6, itemsPassed: 4, accuracy: 0.67, activeSec: 48, today: { xp: 17, goalXp: 30 }, kcs: kcs.slice(1, 3), streak: { change: "reset" as const, count: 1, freezesLeft: 0 } },
    freeze: { xp: 22, bonusXp: 5, itemsDone: 7, itemsPassed: 6, accuracy: 0.86, activeSec: 603, today: { xp: 27, goalXp: 30 }, kcs: kcs.slice(0, 2), streak: { change: "kept-by-freeze" as const, count: 21, freezesLeft: 1 } },
  }[variant];
  return (
    <DojoStage width="48rem">
      <SessionSummary {...props} onContinue={() => {}} />
    </DojoStage>
  );
}

export const SummaryPerfect: Story = { render: () => <SummaryStory variant="perfect" /> };
/** Misses: one KC dropped (down arrow in its meter) and a remedial pack is offered. */
export const SummaryPartialWithRemedial: Story = { render: () => <SummaryStory variant="partial" /> };
export const SummaryFreezeSaved: Story = { render: () => <SummaryStory variant="freeze" /> };
export const SummaryStreakReset: Story = { render: () => <SummaryStory variant="reset" /> };
export const SummaryNarrow: Story = {
  render: () => <SummaryStory variant="partial" />,
  parameters: { viewport: { defaultViewport: "workspace-mobile" } },
  globals: { viewport: "workspace-mobile" },
};

function HeatmapStory({ density }: { density: "empty" | "sparse" | "dense" }) {
  const zh = useIsZh();
  const [selected, setSelected] = React.useState<string | null>(density === "dense" ? "time-same-ts" : null);
  return (
    <DojoStage width="56rem">
      <KcHeatmap rows={heatmapRows(zh, density)} selectedKcId={selected} onSelectKc={setSelected} />
    </DojoStage>
  );
}

export const HeatmapDense: Story = { render: () => <HeatmapStory density="dense" /> };
export const HeatmapSparse: Story = { render: () => <HeatmapStory density="sparse" /> };
export const HeatmapEmpty: Story = { render: () => <HeatmapStory density="empty" /> };
export const HeatmapNarrow: Story = {
  render: () => <HeatmapStory density="dense" />,
  parameters: { viewport: { defaultViewport: "workspace-mobile" } },
  globals: { viewport: "workspace-mobile" },
};

export const ReviewQueue: Story = {
  render: function ReviewStory() {
    const zh = useIsZh();
    return (
      <DojoStage width="52rem">
        <ReviewQueueList entries={reviewEntries(zh)} now={fixtureNow} onPracticeAll={() => {}} onPracticeKc={() => {}} />
      </DojoStage>
    );
  },
};

export const ReviewQueueEmpty: Story = {
  render: () => (
    <DojoStage width="52rem">
      <ReviewQueueList entries={[]} now={fixtureNow} onPracticeAll={() => {}} />
    </DojoStage>
  ),
};

export const ReviewQueueNarrow: Story = {
  ...ReviewQueue,
  parameters: { viewport: { defaultViewport: "workspace-mobile" } },
  globals: { viewport: "workspace-mobile" },
};

export const Simulation: Story = {
  render: function SimulationStory() {
    const zh = useIsZh();
    return (
      <DojoStage width="40rem" gap="var(--space-3)">
        <SimulationCard
          title={zh ? "模拟面试：25 分钟，三段。" : "Mock interview: 25 minutes, three stages."}
          summary={zh ? "新模型在公开基准上涨了 6 分，产品经理想直接发布。你是评测负责人。" : "A new model gained 6 points on a public benchmark and the PM wants to ship it. You lead evals."}
          minutes={25}
          tag="chatbot-launch"
          onStart={() => {}}
        />
        <StateLabel>starting another session</StateLabel>
        <SimulationCard title={zh ? "模拟面试" : "Mock interview"} summary={zh ? "开始中…" : "Starting…"} minutes={25} />
      </DojoStage>
    );
  },
};
