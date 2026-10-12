"use client";

import * as React from "react";
import type { Meta, StoryObj } from "@storybook/react-vite";
import { SeriesSwitcher, type SeriesOption } from "./series-switcher";
import { DojoStage, useIsZh } from "./dojo-stories-support";

function useSeries(): SeriesOption[] {
  const zh = useIsZh();
  return [
    {
      id: "python",
      title: zh ? "Python 实战编程" : "Python practical coding",
      description: zh ? "从 Python 基本功、OOP 到八类原型阶梯和公司全真模拟。" : "From Python fluency and OOP to the archetype ladders and company mocks.",
      progress: { done: 2, total: 21 },
    },
    {
      id: "mleval",
      title: zh ? "ML eval 端到端设计" : "ML eval, end to end",
      description: zh ? "给定场景：先问什么、数据集和 benchmark 怎么选、pipeline 怎么搭、结果怎么回流。" : "Given a scenario: what to ask first, which datasets and benchmarks, how to build the pipeline, how results flow back.",
      progress: { done: 0, total: 6 },
    },
    {
      id: "posttrain",
      title: zh ? "Post-training" : "Post-training",
      description: zh ? "选 open-weight 模型、存储与精度、RL 方法及其数学、怎么验证。" : "Choosing an open-weight model, storage and precision, RL methods and their math, and validation.",
    },
  ];
}

function Interactive({ initial = "python", count = 3, disabled = false }: { initial?: string; count?: number; disabled?: boolean }) {
  const series = useSeries().slice(0, count);
  const [active, setActive] = React.useState(initial);
  return (
    <DojoStage>
      <SeriesSwitcher series={series} activeId={active} onSelect={setActive} disabled={disabled} />
    </DojoStage>
  );
}

const meta = {
  title: "Dojo / Series Switcher",
  component: SeriesSwitcher,
  tags: ["autodocs"],
  parameters: {
    layout: "fullscreen",
    docs: { description: { component: "Chooses the curriculum (series) whose path, skills and review queue the dojo shows. XP, streak and the daily goal are global and stay in the header. Hidden with a single series. Radiogroup: arrow keys move and select." } },
  },
  args: { series: [], activeId: "python", onSelect: () => {} },
} satisfies Meta<typeof SeriesSwitcher>;

export default meta;
type Story = StoryObj<typeof meta>;

export const ThreeSeries: Story = { render: () => <Interactive /> };
export const SecondActive: Story = { render: () => <Interactive initial="mleval" /> };
export const TwoSeries: Story = { render: () => <Interactive count={2} /> };
/** With one series nothing renders: the Python-only app looks exactly as before. */
export const SingleSeriesRendersNothing: Story = { render: () => <Interactive count={1} /> };
export const Disabled: Story = { render: () => <Interactive disabled /> };
export const Narrow: Story = {
  render: () => <Interactive />,
  parameters: { viewport: { defaultViewport: "workspace-mobile" } },
  globals: { viewport: "workspace-mobile" },
};
