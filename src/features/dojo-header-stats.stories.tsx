"use client";

import type { Meta, StoryObj } from "@storybook/react-vite";
import { DojoHeaderStats } from "./index";
import { DojoStage, StateLabel } from "./dojo-stories-support";

const meta = {
  title: "Dojo / Header Stats",
  component: DojoHeaderStats,
  tags: ["autodocs"],
  parameters: {
    docs: { description: { component: "Top strip of the dojo home: streak, today's XP ring, streak freezes, due reviews and the single primary action (start or resume today's session). Four stat cells share one grid; below 40rem of container width they reflow to 2×2 and the action spans the row." } },
  },
  args: {
    streak: { count: 12, status: "active" },
    today: { xp: 18, goalXp: 30 },
    freezes: 1,
    dueCount: 7,
    onStartDaily: () => {},
  },
  render: (args) => <DojoStage><DojoHeaderStats {...args} /></DojoStage>,
} satisfies Meta<typeof DojoHeaderStats>;

export default meta;
type Story = StoryObj<typeof meta>;

/** In progress: part of today's goal earned, reviews due. */
export const InProgress: Story = {};

export const NewUser: Story = {
  args: { streak: { count: 0, status: "broken" }, today: { xp: 0, goalXp: 30 }, freezes: 0, dueCount: 0, isNewUser: true },
};

export const GoalMet: Story = {
  args: { streak: { count: 37, status: "active" }, today: { xp: 42, goalXp: 30 }, freezes: 2, dueCount: 0, hasOpenSession: false },
};

export const StreakAtRisk: Story = {
  args: { streak: { count: 9, status: "at-risk" }, today: { xp: 0, goalXp: 30 }, freezes: 0, dueCount: 14 },
};

export const ResumeOpenSession: Story = {
  args: { streak: { count: 4, status: "frozen" }, today: { xp: 6, goalXp: 20 }, freezes: 1, dueCount: 3, hasOpenSession: true },
};

export const AllStates: Story = {
  render: (args) => (
    <DojoStage>
      <StateLabel>new user</StateLabel>
      <DojoHeaderStats {...args} streak={{ count: 0, status: "broken" }} today={{ xp: 0, goalXp: 30 }} freezes={0} dueCount={0} isNewUser />
      <StateLabel>in progress</StateLabel>
      <DojoHeaderStats {...args} />
      <StateLabel>goal met</StateLabel>
      <DojoHeaderStats {...args} streak={{ count: 37, status: "active" }} today={{ xp: 42, goalXp: 30 }} freezes={2} dueCount={0} />
      <StateLabel>streak at risk</StateLabel>
      <DojoHeaderStats {...args} streak={{ count: 9, status: "at-risk" }} today={{ xp: 0, goalXp: 30 }} freezes={0} dueCount={14} />
    </DojoStage>
  ),
};

export const Narrow: Story = {
  parameters: { viewport: { defaultViewport: "workspace-mobile" } },
  globals: { viewport: "workspace-mobile" },
};
