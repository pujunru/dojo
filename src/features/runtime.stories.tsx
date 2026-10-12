"use client";

import * as React from "react";
import type { Meta, StoryObj } from "@storybook/react-vite";
import type { Grade } from "../core/learner-model";
import { MutantScoreboard, RubricResult, RuntimeStatus, TestResultList } from "./index";
import {
  explainItem,
  explainRubric,
  implementItem,
  mutantDescriptions,
  runAllGreen,
  runCompileError,
  runHarnessError,
  runImportError,
  runJobTimeout,
  runLongOutput,
  runMutants,
  runMutantsAllKilled,
  runSomeFailing,
  runTestsFailOnReference,
  runUnavailable,
} from "./fixtures";
import { DojoStage, StateLabel, useIsZh } from "./dojo-stories-support";

const meta = {
  title: "Dojo / Runtime and Tests",
  tags: ["autodocs"],
  parameters: {
    docs: { description: { component: "Code-runner and grading feedback. `RuntimeStatus` shows the registered runner's lifecycle (or that this build has none). `TestResultList` renders a `RunResult` from the runner: per-test rows, assertion messages with location, errors with frames and an expandable traceback, timeouts, and run-level failures (syntax, import, timeout, harness). Long output is cut with a “show all” toggle. `MutantScoreboard` and `RubricResult` cover write-tests and rubric grading, including self-grade without AI." } },
  },
} satisfies Meta;

export default meta;
type Story = StoryObj<typeof meta>;

function useTestTitles() {
  const zh = useIsZh();
  return Object.fromEntries(implementItem.testMeta.map((meta) => [meta.id, zh ? meta.title!["zh-CN"] : meta.title!["en-US"]]));
}
const hiddenIds = implementItem.testMeta.filter((meta) => meta.hidden).map((meta) => meta.id);

export const RuntimeStates: Story = {
  render: () => (
    <DojoStage width="36rem" gap="var(--space-3)">
      <StateLabel>no code runner</StateLabel>
      <RuntimeStatus status={{ state: "no-runner" }} />
      <StateLabel>provisioning</StateLabel>
      <RuntimeStatus status={{ state: "provisioning" }} />
      <StateLabel>provisioning · progress</StateLabel>
      <RuntimeStatus status={{ state: "provisioning", progress: 0.45 }} />
      <StateLabel>ready</StateLabel>
      <RuntimeStatus status={{ state: "ready", runtimeLabel: "CPython 3.12 (Pyodide)" }} />
      <StateLabel>running</StateLabel>
      <RuntimeStatus status={{ state: "running", elapsedMs: 1240 }} />
      <StateLabel>timed out (job)</StateLabel>
      <RuntimeStatus status={{ state: "timed-out", scope: "job" }} onRetry={() => {}} />
      <StateLabel>failed · python missing</StateLabel>
      <RuntimeStatus status={{ state: "failed", reason: "python_missing", detail: "spawn python3 ENOENT" }} onRetry={() => {}} />
      <StateLabel>failed · host unreachable</StateLabel>
      <RuntimeStatus status={{ state: "failed", reason: "host_unreachable", detail: "ssh: connect to host gpu-box port 22: Connection refused" }} onRetry={() => {}} />
    </DojoStage>
  ),
};

function TestsStory({ result, running = false, width = "40rem" }: { result: Parameters<typeof TestResultList>[0]["result"]; running?: boolean; width?: string }) {
  const titles = useTestTitles();
  return (
    <DojoStage width={width}>
      <TestResultList result={result} running={running} testTitles={titles} hiddenTestIds={hiddenIds} />
    </DojoStage>
  );
}

export const TestsEmpty: Story = { render: () => <TestsStory result={null} /> };
export const TestsRunning: Story = { render: () => <TestsStory result={null} running /> };
export const TestsAllGreen: Story = { render: () => <TestsStory result={runAllGreen} /> };
/** Assertion with location, an error with frames + traceback + captured stdout, and a timeout. */
export const TestsSomeFailing: Story = { render: () => <TestsStory result={runSomeFailing} /> };
export const TestsCompileError: Story = { render: () => <TestsStory result={runCompileError} /> };
export const TestsImportError: Story = { render: () => <TestsStory result={runImportError} /> };
export const TestsJobTimeout: Story = { render: () => <TestsStory result={runJobTimeout} /> };
export const TestsHarnessError: Story = { render: () => <TestsStory result={runHarnessError} /> };
export const TestsRuntimeUnavailable: Story = { render: () => <TestsStory result={runUnavailable} /> };
/** 60 lines of stdout, cut to 12 with an expand toggle. */
export const TestsLongOutputTruncated: Story = { render: () => <TestsStory result={runLongOutput} /> };
export const TestsNarrow: Story = {
  render: () => <TestsStory result={runSomeFailing} />,
  parameters: { viewport: { defaultViewport: "workspace-mobile" } },
  globals: { viewport: "workspace-mobile" },
};

export const Mutants: Story = {
  render: function MutantsStory() {
    const zh = useIsZh();
    const titles = useTestTitles();
    return (
      <DojoStage width="40rem">
        <StateLabel>tests fail on the reference</StateLabel>
        <MutantScoreboard result={runTestsFailOnReference as Extract<typeof runTestsFailOnReference, { status: "tests_fail_on_reference" }>} descriptions={mutantDescriptions(zh)} killTarget={0.75} testTitles={titles} />
        <StateLabel>partial · below target</StateLabel>
        <MutantScoreboard result={runMutants as Extract<typeof runMutants, { status: "mutants" }>} descriptions={mutantDescriptions(zh)} killTarget={0.75} testTitles={titles} />
        <StateLabel>all killed</StateLabel>
        <MutantScoreboard result={runMutantsAllKilled as Extract<typeof runMutantsAllKilled, { status: "mutants" }>} descriptions={mutantDescriptions(zh)} killTarget={0.75} testTitles={titles} />
        <StateLabel>none killed</StateLabel>
        <MutantScoreboard
          result={{ status: "mutants", base: { passed: 2, total: 2 }, mutants: (runMutants.status === "mutants" ? runMutants.mutants : []).map((mutant) => ({ id: mutant.id, killed: false })), runtime: "cpython-sandbox", ms: 700 }}
          descriptions={mutantDescriptions(zh)}
          killTarget={0.75}
        />
      </DojoStage>
    );
  },
};

export const Rubric: Story = {
  render: function RubricStory() {
    const zh = useIsZh();
    const { criteria, scores } = explainRubric(zh);
    const [grade, setGrade] = React.useState<Grade | null>(null);
    return (
      <DojoStage width="42rem">
        <StateLabel>AI-graded · below pass mark</StateLabel>
        <RubricResult mode="ai" criteria={criteria} scores={scores} passAt={explainItem.rubric.passAt} total={0.6} />
        <StateLabel>AI-graded · passed</StateLabel>
        <RubricResult mode="ai" criteria={criteria} scores={scores.map((score) => ({ ...score, score: Math.max(score.score, 0.9), evidence: score.evidence ?? (zh ? "“task_done() 放在 finally 里”" : "“task_done() goes in finally”") }))} passAt={explainItem.rubric.passAt} total={0.93} />
        <StateLabel>self-grade (no AI)</StateLabel>
        <RubricResult mode="self" criteria={criteria} modelAnswer={zh ? explainItem.modelAnswer["zh-CN"] : explainItem.modelAnswer["en-US"]} selected={grade} onSelfGrade={setGrade} />
      </DojoStage>
    );
  },
};
