"use client";

import * as React from "react";
import type { Meta, StoryObj } from "@storybook/react-vite";
import type { DojoItem, L10n } from "../core/content-schema";
import type { RunResult } from "../core/run-protocol";
import { scoreReviewFindings } from "../core/grading";
import {
  FeedbackSheet,
  ItemFrame,
  LadderItemView,
  LevelStepper,
  RefactorItemView,
  ReviewItemView,
  WriteTestsItemView,
  emptyLadderAnswer,
  emptyRefactorAnswer,
  emptyReviewAnswer,
  emptyWriteTestsAnswer,
  type CodeRunState,
  type DojoPlatform,
  type ItemPhase,
  type LadderAnswer,
  type ReviewAnswer,
} from "./index";
import { ladderItem, refactorItem, reviewItem, writeTestsItem } from "./fixtures-advanced";
import { DojoStage, StateLabel, useIsZh } from "./dojo-stories-support";

const meta = {
  title: "Dojo / Advanced Item Views",
  tags: ["autodocs"],
  parameters: {
    docs: { description: { component: "WP9 item views: refactor (old vs new tests), write-tests (mutant kill ratio vs target), review (diff findings with severity/category), the timed ladder with LevelStepper + Countdown, and the mock self-assessment. Fixtures come from the validated `_sample-advanced` content unit." } },
  },
} satisfies Meta;
export default meta;
type Story = StoryObj<typeof meta>;
const mobile = { parameters: { viewport: { defaultViewport: "workspace-mobile" } }, globals: { viewport: "workspace-mobile" } } as const;

function usePick() {
  const zh = useIsZh();
  return (text: L10n) => (zh ? text["zh-CN"] : text["en-US"]);
}

function Framed({ item, phase, verdict = "incorrect", children }: { item: DojoItem; phase: ItemPhase; verdict?: "correct" | "partial" | "incorrect"; children: React.ReactNode }) {
  const pick = usePick();
  return (
    <DojoStage width="72rem">
      <ItemFrame
        itemType={item.type}
        prompt={pick(item.prompt)}
        phase={phase}
        checkKind="run"
        onHint={item.hints.length ? () => {} : undefined}
        onCheck={() => {}}
        onSkip={() => {}}
        onContinue={() => {}}
        feedback={phase === "revealed" ? <FeedbackSheet verdict={verdict} xp={verdict === "correct" ? 10 : 3} explanation={pick(item.explanation)} /> : undefined}
      >
        {children}
      </ItemFrame>
    </DojoStage>
  );
}

const ok = (results: { id: string; ok: boolean }[]): RunResult => ({
  status: "ok",
  passed: results.filter((r) => r.ok).length,
  total: results.length,
  results: results.map((r) => (r.ok ? { id: r.id, ok: true as const, ms: 1 } : { id: r.id, ok: false as const, ms: 1, kind: "assert" as const, msg: "assert [] == [('transfer_in', 20)]", file: "tests.py", line: 30 })),
  stdout: "",
  stderr: "",
  runtime: "cpython-sandbox",
  ms: 42,
});
const ready = { state: "ready" as const, runtimeLabel: "CPython 3.12 (Pyodide)" };

/* ───────────── Refactor ───────────── */

function RefactorCase({ run, phase = "answered", platform = "runner" }: { run: CodeRunState; phase?: ItemPhase; platform?: DojoPlatform }) {
  const [answer, setAnswer] = React.useState(emptyRefactorAnswer(refactorItem));
  return (
    <Framed item={refactorItem} phase={phase} verdict={phase === "revealed" ? "correct" : "incorrect"}>
      <RefactorItemView item={refactorItem} answer={answer} onAnswerChange={setAnswer} platform={platform} sandbox={ready} run={run} reveal={phase === "revealed" ? { verdict: "correct", q: 1 } : null} onReset={() => {}} />
    </Framed>
  );
}
const refactorIds = refactorItem.testMeta.map((m) => m.id);
export const RefactorInitial: Story = { render: () => <RefactorCase run={{ state: "idle" }} phase="unanswered" /> };
export const RefactorRegression: Story = {
  render: () => <RefactorCase run={{ state: "done", result: ok(refactorIds.map((id) => ({ id, ok: !["test_spend_refuses_more_than_the_balance", "test_history_lists_every_change_in_order", "test_failed_operations_leave_no_history"].includes(id) }))) }} />,
};
export const RefactorRightReveal: Story = { render: () => <RefactorCase run={{ state: "done", result: ok(refactorIds.map((id) => ({ id, ok: true }))) }} phase="revealed" /> };
export const RefactorNoRunner: Story = { render: () => <RefactorCase run={{ state: "idle" }} phase="unanswered" platform="no-runner" /> };
export const RefactorNarrow: Story = { ...mobile, render: () => <RefactorCase run={{ state: "done", result: ok(refactorIds.map((id, i) => ({ id, ok: i % 3 !== 0 }))) }} /> };

/* ───────────── Write tests ───────────── */

const mutantRun = (killed: string[]): RunResult => ({
  status: "mutants",
  base: { passed: 3, total: 3 },
  mutants: writeTestsItem.mutants.map((m) => ({ id: m.id, killed: killed.includes(m.id), ...(killed.includes(m.id) ? { by: "test_ties_break_by_id_ascending" } : {}) })),
  runtime: "cpython-sandbox",
  ms: 120,
});
function WriteTestsCase({ run, phase = "answered", platform = "runner" }: { run: CodeRunState; phase?: ItemPhase; platform?: DojoPlatform }) {
  const [answer, setAnswer] = React.useState(emptyWriteTestsAnswer(writeTestsItem));
  return (
    <Framed item={writeTestsItem} phase={phase} verdict={phase === "revealed" ? "correct" : "partial"}>
      <WriteTestsItemView item={writeTestsItem} answer={answer} onAnswerChange={setAnswer} platform={platform} sandbox={ready} run={run} reveal={phase === "revealed" ? { verdict: "correct", q: 1 } : null} onReset={() => {}} />
    </Framed>
  );
}
export const WriteTestsInitial: Story = { render: () => <WriteTestsCase run={{ state: "idle" }} phase="unanswered" /> };
export const WriteTestsRunning: Story = { render: () => <WriteTestsCase run={{ state: "running" }} /> };
export const WriteTestsFailOnReference: Story = {
  render: () => <WriteTestsCase run={{ state: "done", result: { status: "tests_fail_on_reference", base: ok([{ id: "test_orders_by_total_outgoing", ok: true }, { id: "test_ties", ok: false }]) as Extract<RunResult, { status: "ok" }>, runtime: "cpython-sandbox", ms: 30 } }} />,
};
export const WriteTestsBelowTarget: Story = { render: () => <WriteTestsCase run={{ state: "done", result: mutantRun(["tie-desc", "last-amount"]) }} /> };
export const WriteTestsTargetMetReveal: Story = { render: () => <WriteTestsCase run={{ state: "done", result: mutantRun(["tie-desc", "last-amount", "off-by-one"]) }} phase="revealed" /> };
export const WriteTestsNoRunner: Story = { render: () => <WriteTestsCase run={{ state: "idle" }} phase="unanswered" platform="no-runner" /> };

/* ───────────── Review ───────────── */

const sampleFindings: ReviewAnswer = {
  findings: [
    { anchor: "payments.py#R16", path: "payments.py", line: 16, severity: "major", category: "correctness" },
    { anchor: "payments.py#R18", path: "payments.py", line: 18, severity: "major", category: null },
    { anchor: "payments.py#R10", path: "payments.py", line: 10, severity: "minor", category: "readability" },
  ],
};
function ReviewCase({ initial, revealed = false }: { initial: ReviewAnswer; revealed?: boolean }) {
  const [answer, setAnswer] = React.useState(initial);
  const detail = revealed ? scoreReviewFindings({ kcs: reviewItem.kcs.map((k) => k.id), issues: reviewItem.issues, tolerance: reviewItem.tolerance, findings: answer.findings }) : null;
  return (
    <Framed item={reviewItem} phase={revealed ? "revealed" : answer.findings.length ? "answered" : "unanswered"} verdict="partial">
      <ReviewItemView item={reviewItem} answer={answer} onAnswerChange={setAnswer} platform="runner" reveal={revealed ? { verdict: "partial", q: detail?.q ?? 0 } : null} detail={detail} />
    </Framed>
  );
}
export const ReviewInitial: Story = { render: () => <ReviewCase initial={emptyReviewAnswer()} /> };
export const ReviewAnswering: Story = { render: () => <ReviewCase initial={sampleFindings} /> };
export const ReviewReveal: Story = { render: () => <ReviewCase initial={sampleFindings} revealed /> };
export const ReviewNarrow: Story = { ...mobile, render: () => <ReviewCase initial={sampleFindings} /> };

/* ───────────── Ladder ───────────── */

function ladderAt(current: number, statuses: LadderAnswer["levels"][string]["status"][], elapsed: number[], failed: number[] = []): LadderAnswer {
  const base = emptyLadderAnswer(ladderItem);
  return {
    ...base,
    current,
    levels: Object.fromEntries(ladderItem.levels.map((l, i) => [l.id, { status: statuses[i], elapsedSec: elapsed[i] ?? 0, failedRuns: failed[i] ?? 0 }])),
  };
}
function LadderCase({ initial, run = { state: "idle" }, remaining, revealed = false, platform = "runner" }: { initial: LadderAnswer; run?: CodeRunState; remaining: number; revealed?: boolean; platform?: DojoPlatform }) {
  const [answer, setAnswer] = React.useState(initial);
  return (
    <Framed item={ladderItem} phase={revealed ? "revealed" : "answered"} verdict="partial">
      <LadderItemView item={ladderItem} answer={answer} onAnswerChange={setAnswer} platform={platform} sandbox={ready} run={run} remainingSeconds={remaining} onSkipLevel={() => {}} reveal={revealed ? { verdict: "partial", q: 2 / 3 } : null} />
    </Framed>
  );
}
const l2Ids = ladderItem.levels[1].testMeta.map((m) => m.id);
export const LadderLevelOne: Story = { render: () => <LadderCase initial={emptyLadderAnswer(ladderItem)} remaining={540} /> };
export const LadderLevelTwoFailedRun: Story = {
  render: () => <LadderCase initial={ladderAt(1, ["passed", "active", "locked"], [720, 300], [0, 1])} remaining={-45} run={{ state: "done", result: ok(l2Ids.map((id, i) => ({ id, ok: i !== 1 }))) }} />,
};
export const LadderFinishedReveal: Story = { render: () => <LadderCase initial={ladderAt(3, ["passed", "passed", "skipped"], [720, 540, 200], [0, 1, 2])} remaining={0} revealed /> };
export const LadderNoRunner: Story = { render: () => <LadderCase initial={emptyLadderAnswer(ladderItem)} remaining={600} platform="no-runner" /> };
export const LadderNarrow: Story = { ...mobile, render: () => <LadderCase initial={ladderAt(1, ["passed", "active", "locked"], [720, 300], [0, 1])} remaining={120} /> };

export const LevelStepperStates: Story = {
  render: () => (
    <DojoStage width="60rem">
      <StateLabel>locked · active · passed · failed · skipped · overtime</StateLabel>
      <LevelStepper levels={[
        { id: "a", title: "Accounts, deposits and transfers", timeboxSec: 600, status: "passed", elapsedSec: 720 },
        { id: "b", title: "Top spenders", timeboxSec: 600, status: "failed", elapsedSec: 610, failedRuns: 2 },
        { id: "c", title: "Scheduled payments with a very long level title that wraps", timeboxSec: 900, status: "active", elapsedSec: 120 },
        { id: "d", title: "Merge accounts", timeboxSec: 900, status: "skipped", elapsedSec: 30 },
        { id: "e", title: "Locked", timeboxSec: 900, status: "locked", elapsedSec: 0 },
      ]} />
    </DojoStage>
  ),
};

