"use client";

import * as React from "react";
import type { Meta, StoryObj } from "@storybook/react-vite";
import { AppShell, LearnerDataPanel } from "./index";
import { useIsZh } from "./dojo-stories-support";

const meta = {
  title: "Dojo / App Shell",
  tags: ["autodocs"],
  parameters: {
    layout: "fullscreen",
    docs: { description: { component: "`AppShell` is the mobile frame: a sticky top bar (title, language, learner data) over one phone-width column, centred on wider screens. `LearnerDataPanel` says where progress lives (this browser only) and moves it: export to JSON, import on another device, or start over (asks twice)." } },
  },
} satisfies Meta;

export default meta;
type Story = StoryObj<typeof meta>;

const LOCALES = [{ id: "en-US", label: "English" }, { id: "zh-CN", label: "中文" }];

function Panel({ durable }: { durable: boolean }) {
  return (
    <LearnerDataPanel
      durable={durable}
      summary={{ totalXp: 245, attempts: 61, kcs: 18 }}
      onExport={() => {}}
      onImport={async () => "format"}
      onReset={async () => {}}
    />
  );
}

function Shell({ open = false, durable = true }: { open?: boolean; durable?: boolean }) {
  const zh = useIsZh();
  const [locale, setLocale] = React.useState(zh ? "zh-CN" : "en-US");
  React.useEffect(() => {
    if (!open) return;
    // Open the data panel, as a learner tapping the database button would.
    document.querySelector<HTMLButtonElement>(".dj-shell__bar button")?.click();
  }, [open]);
  return (
    <AppShell title={zh ? "道场" : "Dojo"} locales={LOCALES} locale={locale} onLocaleChange={setLocale} dataPanel={<Panel durable={durable} />}>
      <div style={{ padding: "var(--space-4)", display: "grid", gap: "var(--space-3)" }}>
        {Array.from({ length: 6 }, (_, i) => (
          <div key={i} style={{ height: "6rem", borderRadius: "var(--radius-card)", background: "var(--card)", border: "1px solid var(--border)" }} />
        ))}
      </div>
    </AppShell>
  );
}

export const Default: Story = { render: () => <Shell /> };
export const DataPanelOpen: Story = { render: () => <Shell open /> };
export const NotDurable: Story = { render: () => <Shell open durable={false} /> };
export const OnDesktop: Story = {
  render: () => <Shell />,
  globals: { viewport: "desktop" },
};
