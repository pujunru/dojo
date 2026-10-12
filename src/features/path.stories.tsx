"use client";

import type { Meta, StoryObj } from "@storybook/react-vite";
import { PathNode, TierSection, UnitPath, type PathNodeView } from "./index";
import { pathTiers, pickBi, resolveUnit } from "./fixtures";
import { DojoStage, StateLabel, useIsZh } from "./dojo-stories-support";

const meta = {
  title: "Dojo / Unit Path",
  tags: ["autodocs"],
  parameters: {
    docs: { description: { component: "`PathNode` (one lesson or checkpoint), `UnitPath` (unit header + node column joined by a connector) and `TierSection` (tier heading + its units). Node state is carried by the disc fill, its icon, a text chip and the action label; checkpoints use a squared trophy disc. Lessons that need a code runner are disabled, with a stated reason, when none is registered." } },
  },
} satisfies Meta;

export default meta;
type Story = StoryObj<typeof meta>;

function NodeMatrix({ platform }: { platform: "runner" | "no-runner" }) {
  const zh = useIsZh();
  const title = (zhText: string, en: string) => (zh ? zhText : en);
  const nodes: (PathNodeView & { label: string })[] = [
    { label: "locked", id: "n-locked", kind: "lesson", state: "locked", minutes: 8, title: title("不变量住在哪里", "Where invariants live") },
    { label: "available", id: "n-available", kind: "lesson", state: "available", minutes: 9, title: title("惰性删除", "Lazy deletion") },
    { label: "in progress · current", id: "n-progress", kind: "lesson", state: "in-progress", minutes: 10, current: true, progress: { done: 3, total: 7 }, title: title("堆：最小、最大与并列", "Heaps: min, max, ties") },
    { label: "complete · crown 1", id: "n-c1", kind: "lesson", state: "complete", crowns: 1, minutes: 8, title: title("Counter 与 defaultdict", "Counter and defaultdict") },
    { label: "complete · crown 5", id: "n-c5", kind: "lesson", state: "complete", crowns: 5, minutes: 8, title: title("dict 与排序反射", "Dict and sort reflexes") },
    { label: "complete · cracked", id: "n-cracked", kind: "lesson", state: "complete", crowns: 2, cracked: true, minutes: 7, title: title("别名与可变默认参数", "Aliasing and mutable defaults") },
    { label: "checkpoint · available", id: "n-cp", kind: "checkpoint", state: "available", minutes: 30, title: title("检查点：库存撮合阶梯", "Checkpoint: order-book ladder") },
    { label: "checkpoint · locked", id: "n-cp-locked", kind: "checkpoint", state: "locked", minutes: 30, title: title("检查点：银行账户阶梯", "Checkpoint: bank account ladder") },
    { label: `local-only · ${platform}`, id: "n-local", kind: "lesson", state: "available", minutes: 12, localOnly: true, title: title("用 bisect 查历史版本", "bisect for history") },
    { label: "long title", id: "n-long", kind: "lesson", state: "available", minutes: 15, title: title("为 L4 设计：在测试全绿的前提下重构，把“当前值”改造成“历史”而不破坏既有接口", "Design for L4: refactor under green tests, turning a current-value store into a history without breaking the existing interface") },
  ];
  return (
    <DojoStage width="44rem" gap="var(--space-2)">
      {nodes.map(({ label, ...node }) => (
        <div key={node.id} style={{ display: "grid", gap: "var(--space-1)" }}>
          <StateLabel>{label}</StateLabel>
          <ol style={{ margin: 0, padding: "0 var(--space-4)", listStyle: "none", border: "1px solid var(--border)", borderRadius: "var(--radius-card)", background: "var(--card)" }}>
            <PathNode node={node} platform={platform} onStart={() => {}} />
          </ol>
        </div>
      ))}
    </DojoStage>
  );
}

export const PathNodeStates: Story = { render: () => <NodeMatrix platform="runner" /> };

/** A lesson that needs a code runner is disabled with its reason when none is registered. */
export const PathNodeStatesWeb: Story = { render: () => <NodeMatrix platform="no-runner" /> };

function UnitStory({ index, tierIndex = 0, platform = "runner" }: { index: number; tierIndex?: number; platform?: "runner" | "no-runner" }) {
  const zh = useIsZh();
  const unit = resolveUnit(pathTiers[tierIndex]!.units[index]!, zh);
  return (
    <DojoStage width="44rem">
      <UnitPath unit={unit} platform={platform} onStartNode={() => {}} tone={(["amber", "blue", "magenta", "indigo"] as const)[unit.ordinal % 4]} />
    </DojoStage>
  );
}

/** Every lesson crowned; one KC is fading, so the unit shows a crack. */
export const UnitComplete: Story = { render: () => <UnitStory index={0} /> };
export const UnitPartial: Story = { render: () => <UnitStory index={1} /> };
export const UnitPartialWeb: Story = { render: () => <UnitStory index={1} platform="no-runner" /> };
export const UnitAllLocked: Story = { render: () => <UnitStory index={0} tierIndex={1} /> };

export const UnitNarrow: Story = {
  render: () => <UnitStory index={1} />,
  parameters: { viewport: { defaultViewport: "workspace-mobile" } },
  globals: { viewport: "workspace-mobile" },
};

export const Tier: Story = {
  render: function TierStory() {
    const zh = useIsZh();
    const tier = pathTiers[0]!;
    return (
      <DojoStage width="44rem">
        <TierSection code={tier.code} title={pickBi(tier.title, zh)} unitsComplete={1} unitsTotal={tier.units.length}>
          {tier.units.map((unit, index) => (
            <UnitPath key={unit.id} unit={resolveUnit(unit, zh)} platform="runner" onStartNode={() => {}} tone={(["amber", "blue", "magenta", "indigo"] as const)[index % 4]} />
          ))}
        </TierSection>
      </DojoStage>
    );
  },
};
