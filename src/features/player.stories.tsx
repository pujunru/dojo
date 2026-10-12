"use client";

import * as React from "react";
import type { Meta, StoryObj } from "@storybook/react-vite";
import { Textarea } from "../ui/textarea";
import { FeedbackSheet, HintPanel, ItemFrame, ItemMetaChips, LessonProgressBar, type ItemMetaChipsProps, type ItemPhase } from "./index";
import { predictStdoutItem, implementItem } from "./fixtures";
import { DojoStage, StateLabel, useIsZh } from "./dojo-stories-support";
import { PredictItemView } from "./item-views-read";

const meta = {
  title: "Dojo / Player Parts",
  tags: ["autodocs"],
  parameters: {
    docs: { description: { component: "Session-player building blocks. `LessonProgressBar`: close, progress track, item counter and a chip when requeued items lengthen the session. `ItemFrame`: type chip, prompt, answer slot, optional aside and hint, and a sticky dock holding the feedback sheet and the action bar (Hint / Skip / Check → Continue). `FeedbackSheet`: verdict by icon + title + color, XP, explanation, and a follow-up slot. `HintPanel`: ordered static hints, revealed one at a time." } },
  },
} satisfies Meta;

export default meta;
type Story = StoryObj<typeof meta>;

export const ProgressBar: Story = {
  render: () => (
    <DojoStage width="48rem">
      <StateLabel>start · 0 / 8</StateLabel>
      <LessonProgressBar done={0} total={8} onClose={() => {}} />
      <StateLabel>midway · 3 / 8</StateLabel>
      <LessonProgressBar done={3} total={8} onClose={() => {}} />
      <StateLabel>after a miss: 2 items requeued · 5 / 10</StateLabel>
      <LessonProgressBar done={5} total={10} requeued={2} onClose={() => {}} />
      <StateLabel>last item · 9 / 10</StateLabel>
      <LessonProgressBar done={9} total={10} requeued={2} onClose={() => {}} />
    </DojoStage>
  ),
};

function useExplanation() {
  const zh = useIsZh();
  return zh ? predictStdoutItem.explanation["zh-CN"] : predictStdoutItem.explanation["en-US"];
}

function FrameStory({ phase, hintOpen = false, revealVerdict, meta, giveUp = false }: { phase: ItemPhase; hintOpen?: boolean; revealVerdict?: "correct" | "partial" | "incorrect"; meta?: ItemMetaChipsProps; giveUp?: boolean }) {
  const zh = useIsZh();
  const pick = (text: { "zh-CN": string; "en-US": string }) => (zh ? text["zh-CN"] : text["en-US"]);
  const [answer, setAnswer] = React.useState(phase === "unanswered" ? {} : { stdout: revealVerdict === "correct" ? "True 2\n['hot', 'cold']" : "False 1\n['cold']" });
  const explanation = useExplanation();
  return (
    <DojoStage width="48rem">
      <ItemFrame
        itemType="predict"
        prompt={pick(predictStdoutItem.prompt)}
        phase={phase}
        meta={meta ? <ItemMetaChips {...meta} /> : undefined}
        hintOpen={hintOpen}
        hint={<HintPanel hints={predictStdoutItem.hints.map(pick)} shown={1} onNextHint={() => {}} />}
        onHint={() => {}}
        onCheck={() => {}}
        onSkip={() => {}}
        onGiveUp={giveUp ? () => {} : undefined}
        onContinue={() => {}}
        feedback={revealVerdict ? <FeedbackSheet verdict={revealVerdict} xp={revealVerdict === "correct" ? 2 : 0} explanation={explanation} /> : undefined}
      >
        <PredictItemView
          item={predictStdoutItem}
          answer={answer}
          onAnswerChange={setAnswer}
          reveal={revealVerdict ? { verdict: revealVerdict, q: revealVerdict === "correct" ? 1 : 0 } : null}
          disabled={phase === "checking"}
          platform="runner"
        />
      </ItemFrame>
    </DojoStage>
  );
}

export const FrameUnanswered: Story = { render: () => <FrameStory phase="unanswered" /> };
export const FrameAnswered: Story = { render: () => <FrameStory phase="answered" /> };
export const FrameChecking: Story = { render: () => <FrameStory phase="checking" /> };
export const FrameHintOpen: Story = { render: () => <FrameStory phase="answered" hintOpen /> };
export const FrameRevealedCorrect: Story = { render: () => <FrameStory phase="revealed" revealVerdict="correct" /> };
export const FrameRevealedIncorrect: Story = { render: () => <FrameStory phase="revealed" revealVerdict="incorrect" /> };

/** Code items say "Run tests"; without a runner, Check stays disabled for them. */
export const FrameBlockedOnWeb: Story = {
  render: function Blocked() {
    const zh = useIsZh();
    return (
      <DojoStage width="48rem">
        <ItemFrame itemType="implement" prompt={zh ? implementItem.prompt["zh-CN"] : implementItem.prompt["en-US"]} phase="unanswered" checkKind="run" blocked onCheck={() => {}} onSkip={() => {}}>
          <div style={{ minHeight: "6rem" }} />
        </ItemFrame>
      </DojoStage>
    );
  },
};

export const FrameNarrow: Story = {
  render: () => <FrameStory phase="revealed" revealVerdict="incorrect" />,
  parameters: { viewport: { defaultViewport: "workspace-mobile" } },
  globals: { viewport: "workspace-mobile" },
};

export const Feedback: Story = {
  render: function FeedbackStory() {
    const zh = useIsZh();
    const explanation = useExplanation();
    return (
      <DojoStage width="44rem">
        <StateLabel>correct</StateLabel>
        <FeedbackSheet verdict="correct" xp={3} explanation={explanation} />
        <StateLabel>partially correct · correct answer shown</StateLabel>
        <FeedbackSheet verdict="partial" xp={2} explanation={explanation} correctAnswer={<pre className="dj-dojo-output__pre">{"True 2\n['hot', 'cold']"}</pre>} />
        <StateLabel>incorrect</StateLabel>
        <FeedbackSheet verdict="incorrect" xp={0} explanation={explanation} />
        <StateLabel>correct · follow-up question</StateLabel>
        <FeedbackSheet
          verdict="correct"
          xp={5}
          explanation={explanation}
          followUp={
            <>
              <p className="dj-type-body" style={{ margin: 0 }}>{zh ? "如果 `add_tag` 被多个线程同时调用，这个 bug 会变成什么样？" : "If several threads call `add_tag` at once, what does this bug turn into?"}</p>
              <Textarea aria-label={zh ? "你的回答" : "Your answer"} rows={2} />
            </>
          }
        />
      </DojoStage>
    );
  },
};

export const Hints: Story = {
  render: function HintsStory() {
    const zh = useIsZh();
    const hints = predictStdoutItem.hints.map((hint) => (zh ? hint["zh-CN"] : hint["en-US"]));
    return (
      <DojoStage width="44rem">
        <StateLabel>no hints authored</StateLabel>
        <HintPanel hints={[]} shown={0} />
        <StateLabel>hint 1 of 2</StateLabel>
        <HintPanel hints={hints} shown={1} onNextHint={() => {}} />
        <StateLabel>all hints shown</StateLabel>
        <HintPanel hints={hints} shown={2} />
      </DojoStage>
    );
  },
};

/** `ItemMetaChips` in the frame's meta slot: why the item is here (new / review / remedial / requeue). */
export const FrameMetaReasons: Story = {
  render: () => (
    <>
      <FrameStory phase="answered" meta={{ reason: "new" }} />
      <FrameStory phase="answered" meta={{ reason: "review" }} />
      <FrameStory phase="answered" meta={{ reason: "remedial" }} />
      <FrameStory phase="answered" meta={{ reason: "requeue", runCount: 2 }} />
    </>
  ),
};

/** A code item after failed runs: runs are unlimited; "Show solution" gives up (graded Again, no XP). */
export const AfterFailedRunsCanGiveUp: Story = {
  render: () => <FrameStory phase="answered" meta={{ reason: "review", runCount: 3 }} giveUp />,
};
