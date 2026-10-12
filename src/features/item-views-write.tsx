"use client";

import * as React from "react";
import { RotateCcw } from "lucide-react";
import { useLocale, useTranslations } from "use-intl";
import { Button } from "../ui/button";
import { CodeEditor, codeLanguageForPath, type CodeEditorDiagnostic } from "../ui/code-editor";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "../ui/tabs";
import { Textarea } from "../ui/textarea";
import { pickL10n, type CaseItem, type ExplainItem, type ImplementItem } from "../core/content-schema";
import type { RunResult } from "../core/run-protocol";
import { Markdown } from "../ui/markdown";
import { DojoCodeFile, NeedsRunnerNotice } from "./item-parts";
import type { CodeRunState, DojoItemViewBaseProps, PyFile, SandboxStatus } from "./types";
import { RubricResult, RuntimeStatus, TestResultList, type RubricResultProps } from "./runtime";

/* ───────────────────────── Implement ───────────────────────── */

export type ImplementAnswer = { files: PyFile[] };

export type ImplementItemViewProps = DojoItemViewBaseProps<ImplementItem, ImplementAnswer> & {
  /** Code-runner status, owned by the app layer. Ignored without a runner. */
  sandbox: SandboxStatus;
  /** Latest test run, owned by the app layer (the frame's Check runs it). */
  run: CodeRunState;
  /** Restore the starter files. */
  onReset?: () => void;
  onRetrySandbox?: () => void;
};

export const emptyImplementAnswer = (item: Pick<ImplementItem, "starter">): ImplementAnswer => ({
  files: item.starter.map((file) => ({ ...file })),
});

export const isImplementAnswerComplete = (item: Pick<ImplementItem, "starter">, answer: ImplementAnswer) =>
  answer.files.some((file) => file.content !== item.starter.find((starter) => starter.path === file.path)?.content);

/** Editor diagnostics for one user file, taken from a run result. */
export function runDiagnostics(result: RunResult | null, path: string): CodeEditorDiagnostic[] {
  if (!result) return [];
  if (result.status === "compile_error") return result.file === path ? [{ line: result.line, message: result.msg, severity: "error" }] : [];
  if (result.status === "import_error") {
    return result.frames.filter(([file]) => file === path).slice(-1).map(([, line]) => ({ line, message: `${result.exc}: ${result.msg}`, severity: "error" as const }));
  }
  if (result.status !== "ok") return [];
  const out = new Map<number, CodeEditorDiagnostic>();
  for (const outcome of result.results) {
    if (outcome.ok || outcome.kind !== "error") continue;
    const frame = outcome.frames.filter(([file]) => file === path).at(-1);
    if (frame && !out.has(frame[1])) out.set(frame[1], { line: frame[1], message: `${outcome.exc}: ${outcome.msg}`, severity: "error" });
  }
  return [...out.values()];
}

/**
 * Write the code; the hidden tests run in the code runner. The editor and
 * the runtime/test panel sit side by side on wide screens and stack on narrow
 * ones. Without a runner the answer surface becomes a "needs a code runner" state
 * with the starter code readable.
 */
export function ImplementItemView({
  item,
  answer,
  onAnswerChange,
  reveal,
  disabled = false,
  platform,
  sandbox,
  run,
  onReset,
  onRetrySandbox,
}: ImplementItemViewProps) {
  const t = useTranslations("dojo.items.implement");
  const tEditor = useTranslations("dojo.editor");
  const locale = useLocale();
  const [tab, setTab] = React.useState(answer.files[0]?.path ?? "");
  const testTitles = Object.fromEntries(item.testMeta.filter((meta) => meta.title).map((meta) => [meta.id, pickL10n(meta.title, locale)]));
  const hiddenTestIds = item.testMeta.filter((meta) => meta.hidden).map((meta) => meta.id);
  const result = run.state === "done" ? run.result : null;
  const running = run.state === "running";
  const locked = disabled || running || Boolean(reveal);

  if (platform === "no-runner") {
    return (
      <div className="dj-dojo-item" data-type="implement" data-platform="no-runner">
        <NeedsRunnerNotice />
        <div className="dj-dojo-item__code">
          {item.starter.map((file) => <DojoCodeFile key={file.path} file={file} maxHeight="18rem" />)}
        </div>
      </div>
    );
  }

  const tabs = [
    ...answer.files.map((file) => ({ value: file.path, label: file.path, kind: "edit" as const, file })),
    ...(item.visibleTests ? [{ value: `tests:${item.visibleTests.path}`, label: item.visibleTests.path, kind: "tests" as const, file: item.visibleTests }] : []),
    ...(reveal ? item.solution.map((file) => ({ value: `solution:${file.path}`, label: t("solutionTab", { path: file.path }), kind: "solution" as const, file })) : []),
  ];
  const activeTab = tabs.some((entry) => entry.value === tab) ? tab : tabs[0]?.value ?? "";

  return (
    <div className="dj-dojo-item dj-dojo-implement" data-type="implement">
      <div className="dj-dojo-implement__editor">
        <Tabs value={activeTab} onValueChange={setTab}>
          <div className="dj-dojo-implement__toolbar">
            <TabsList variant="view-switch" aria-label={t("filesLabel")}>
              {tabs.map((entry) => (
                <TabsTrigger key={entry.value} value={entry.value} className="dj-dojo-implement__tab" translate="no">{entry.label}</TabsTrigger>
              ))}
            </TabsList>
            {onReset && !reveal ? (
              <Button variant="ghost" size="sm" onClick={onReset} disabled={locked}>
                <RotateCcw aria-hidden="true" />
                {t("reset")}
              </Button>
            ) : null}
          </div>
          {tabs.map((entry) => (
            <TabsContent key={entry.value} value={entry.value} className="dj-dojo-implement__panel">
              {entry.kind === "edit" ? (
                <CodeEditor
                  value={entry.file.content}
                  language={codeLanguageForPath(entry.file.path)}
                  onChange={locked ? undefined : (content) => onAnswerChange({ files: answer.files.map((file) => (file.path === entry.file.path ? { ...file, content } : file)) })}
                  readOnly={locked}
                  diagnostics={runDiagnostics(result, entry.file.path)}
                  ariaLabel={t("editorLabel", { path: entry.file.path })}
                  loadingLabel={tEditor("loading")}
                  minHeight="18rem"
                  maxHeight="34rem"
                  footer={locked ? undefined : <span>{tEditor("keyboardHint")}</span>}
                />
              ) : (
                <CodeEditor
                  value={entry.file.content}
                  language={codeLanguageForPath(entry.file.path)}
                  readOnly
                  ariaLabel={tEditor("readOnlyLabel", { path: entry.file.path })}
                  loadingLabel={tEditor("loading")}
                  minHeight="18rem"
                  maxHeight="34rem"
                />
              )}
            </TabsContent>
          ))}
        </Tabs>
      </div>
      <div className="dj-dojo-implement__results">
        <RuntimeStatus status={running ? { state: "running" } : sandbox} onRetry={onRetrySandbox} />
        <TestResultList result={result} running={running} testTitles={testTitles} hiddenTestIds={hiddenTestIds} />
      </div>
    </div>
  );
}

/* ───────────────────────── Explain ───────────────────────── */

export type ExplainAnswer = { text: string };

export type ExplainItemViewProps = DojoItemViewBaseProps<ExplainItem, ExplainAnswer> & {
  /** Rubric outcome once revealed: AI scores, or self-grade when no AI grader is configured. */
  grading?: RubricResultProps;
  /** Criterion-by-criterion verdicts (`RubricJudgement`) once submitted; replaces `grading`. */
  judgement?: React.ReactNode;
};

export const emptyExplainAnswer = (): ExplainAnswer => ({ text: "" });
export const isExplainAnswerComplete = (answer: ExplainAnswer) => answer.text.trim().length >= 10;

/** Short written explanation; reveal shows the rubric result (or self-grade with the model answer). */
export function ExplainItemView({ item, answer, onAnswerChange, reveal, disabled = false, grading, judgement }: ExplainItemViewProps) {
  const t = useTranslations("dojo.items.explain");
  const locale = useLocale();
  const format = (count: number) => t("charCount", { count });
  const id = React.useId();
  const locked = disabled || Boolean(reveal) || Boolean(judgement);

  return (
    <div className="dj-dojo-item" data-type="explain">
      <div className="dj-dojo-callout" data-tone="question">
        <span className="dj-type-caption dj-dojo-callout__label">{t("question")}</span>
        <Markdown>{pickL10n(item.question, locale)}</Markdown>
      </div>
      {item.context?.length ? (
        <div className="dj-dojo-item__code">
          {item.context.map((file) => <DojoCodeFile key={file.path} file={file} maxHeight="none" />)}
        </div>
      ) : null}
      <div className="dj-dojo-field">
        <label className="dj-type-label" htmlFor={`${id}-answer`}>{t("answerLabel")}</label>
        <Textarea
          id={`${id}-answer`}
          value={answer.text}
          onChange={(event) => onAnswerChange({ text: event.target.value })}
          placeholder={t("placeholder")}
          readOnly={locked}
          aria-readonly={locked || undefined}
          rows={5}
        />
        <span className="dj-type-caption dj-dojo-muted" aria-live="off">{format([...answer.text.trim()].length)}</span>
      </div>
      {judgement ?? (reveal ? (
        grading ? <RubricResult {...grading} /> : (
          <div className="dj-dojo-callout">
            <span className="dj-type-caption dj-dojo-callout__label">{t("modelAnswer")}</span>
            <Markdown>{pickL10n(item.modelAnswer, locale)}</Markdown>
          </div>
        )
      ) : null)}
    </div>
  );
}

/* ───────────────────────── Staged case ───────────────────────── */

export type CaseAnswer = {
  /** Index of the stage being answered (stages before it are submitted). */
  current: number;
  /** Text per stage id. */
  texts: Record<string, string>;
};

export type CaseItemViewProps = DojoItemViewBaseProps<CaseItem, CaseAnswer> & {
  /** Stage ids already submitted (their text is locked). */
  submitted: ReadonlySet<string>;
  /** The judgement panel of a submitted stage. */
  judgementFor?: (stageId: string) => React.ReactNode;
  /** Simulation: seconds left on the round's clock. */
  remainingSeconds?: number;
};

export const emptyCaseAnswer = (): CaseAnswer => ({ current: 0, texts: {} });
export const caseStageText = (answer: CaseAnswer, stageId: string) => answer.texts[stageId] ?? "";
export const isCaseAnswerComplete = (item: CaseItem, answer: CaseAnswer) => {
  const stage = item.stages[answer.current];
  return Boolean(stage) && caseStageText(answer, stage.id).trim().length >= 10;
};

/**
 * A staged interview: the scenario stays on top, stages appear one at a time
 * (the next stage's twist is only revealed once the current one is judged),
 * each answered stage keeps its text and verdicts. Later stages are counted
 * but not shown.
 */
export function CaseItemView({ item, answer, onAnswerChange, reveal, disabled = false, submitted, judgementFor, remainingSeconds }: CaseItemViewProps) {
  const t = useTranslations("dojo.items.case");
  const locale = useLocale();
  const id = React.useId();
  const total = item.stages.length;
  const visible = item.stages.slice(0, Math.min(total, answer.current + 1));
  const listRef = React.useRef<HTMLOListElement>(null);
  const shown = React.useRef(answer.current);
  // A newly revealed stage takes focus, so the learner can answer it right away.
  React.useEffect(() => {
    if (answer.current === shown.current) return;
    shown.current = answer.current;
    const field = listRef.current?.querySelector<HTMLTextAreaElement>(`li:nth-child(${answer.current + 1}) textarea`);
    field?.focus({ preventScroll: true });
    field?.closest("li")?.scrollIntoView({ block: "start", behavior: "smooth" });
  }, [answer.current]);

  return (
    <div className="dj-dojo-item dj-dojo-case" data-type="case">
      <div className="dj-dojo-callout" data-tone="question">
        <span className="dj-type-caption dj-dojo-callout__label">{t("scenario")}</span>
        <Markdown>{pickL10n(item.scenario, locale)}</Markdown>
        {typeof remainingSeconds === "number" ? (
          <span className="dj-type-caption dj-dojo-muted">{t("clock", { minutes: Math.max(0, Math.ceil(remainingSeconds / 60)) })}</span>
        ) : null}
      </div>
      {item.context?.length ? (
        <div className="dj-dojo-item__code">
          {item.context.map((file) => <DojoCodeFile key={file.path} file={file} maxHeight="none" />)}
        </div>
      ) : null}
      <ol ref={listRef} className="dj-dojo-case__stages">
        {visible.map((stage, index) => {
          const done = submitted.has(stage.id);
          const text = caseStageText(answer, stage.id);
          const locked = disabled || Boolean(reveal) || done;
          return (
            <li key={stage.id} className="dj-dojo-case__stage" data-state={done ? "done" : "current"}>
              <div className="dj-dojo-case__stage-head">
                <span className="dj-dojo-chip dj-type-caption" data-state={done ? "pass" : "available"}>{t("stage", { index: index + 1, total })}</span>
                {index > 0 ? <span className="dj-type-caption dj-dojo-muted">{t("twist")}</span> : null}
              </div>
              <Markdown>{pickL10n(stage.question, locale)}</Markdown>
              <div className="dj-dojo-field">
                <label className="dj-type-label" htmlFor={`${id}-${stage.id}`}>{t("answerLabel")}</label>
                <Textarea
                  id={`${id}-${stage.id}`}
                  value={text}
                  onChange={(event) => onAnswerChange({ ...answer, texts: { ...answer.texts, [stage.id]: event.target.value } })}
                  placeholder={t("placeholder")}
                  readOnly={locked}
                  aria-readonly={locked || undefined}
                  rows={done ? 3 : 6}
                />
              </div>
              {done && judgementFor ? judgementFor(stage.id) : null}
            </li>
          );
        })}
      </ol>
      {visible.length < total ? (
        <p className="dj-type-caption dj-dojo-muted dj-dojo-case__more">{t("moreStages", { count: total - visible.length })}</p>
      ) : null}
    </div>
  );
}
