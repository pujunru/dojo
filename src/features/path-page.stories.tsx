"use client";

import type { Meta, StoryObj } from "@storybook/react-vite";
import { DojoHeaderStats, DojoPathLayout, TierSection, UnitPath, type DojoPlatform } from "./index";
import { pathTiers, pickBi, resolveUnit } from "./fixtures";
import { useIsZh } from "./dojo-stories-support";

const TONES = ["amber", "blue", "magenta", "indigo"] as const;

const meta = {
  title: "Dojo / Path",
  tags: ["autodocs"],
  parameters: {
    docs: { description: { component: "Page composition of the dojo home (`#path`): `DojoHeaderStats` above tiers of units (`TierSection` → `UnitPath` → `PathNode`), inside `DojoPathLayout`. Reading order: stats and the primary action first, then the journey top to bottom; the current lesson is marked “You are here”." } },
  },
  decorators: [(Story) => <div data-workspace-root style={{ background: "var(--background)", minHeight: "100dvh" }}><Story /></div>],
} satisfies Meta;

export default meta;
type Story = StoryObj<typeof meta>;

function PathPage({ platform = "runner", atRisk = false }: { platform?: DojoPlatform; atRisk?: boolean }) {
  const zh = useIsZh();
  return (
    <DojoPathLayout
      header={
        <DojoHeaderStats
          streak={{ count: 12, status: atRisk ? "at-risk" : "active" }}
          today={{ xp: atRisk ? 0 : 18, goalXp: 30 }}
          freezes={1}
          dueCount={7}
          hasOpenSession={!atRisk}
          onStartDaily={() => {}}
        />
      }
    >
      {pathTiers.map((tier) => (
        <TierSection
          key={tier.id}
          code={tier.code}
          title={pickBi(tier.title, zh)}
          unitsComplete={tier.units.filter((unit) => unit.state === "complete").length}
          unitsTotal={tier.units.length}
        >
          {tier.units.map((unit) => (
            <UnitPath key={unit.id} unit={resolveUnit(unit, zh)} platform={platform} onStartNode={() => {}} tone={TONES[(unit.ordinal - 1) % TONES.length]} />
          ))}
        </TierSection>
      ))}
    </DojoPathLayout>
  );
}

export const WithRunner: Story = { render: () => <PathPage /> };

/** No code runner: lessons that need one are disabled with the reason inline. */
export const NoRunner: Story = { render: () => <PathPage platform="no-runner" atRisk /> };

export const Narrow: Story = {
  render: () => <PathPage />,
  parameters: { viewport: { defaultViewport: "workspace-mobile" } },
  globals: { viewport: "workspace-mobile" },
};
