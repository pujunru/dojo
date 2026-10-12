"use client";

import * as React from "react";
import {
  AlertTriangle,
  Bug,
  CheckCircle2,
  Clock3,
  Cpu,
  FileWarning,
  Laptop,
  Loader2,
  PackageX,
  ShieldCheck,
  Skull,
  TimerOff,
  XCircle,
} from "lucide-react";
import { useFormatter, useTranslations } from "use-intl";
import { Button } from "../ui/button";
import { cn } from "../lib/utils";
import type { Frame, RunResult, TestOutcome } from "../core/run-protocol";
import type { Grade } from "../core/learner-model";
import { Markdown } from "../ui/markdown";
import type { SandboxStatus } from "./types";
import { InlineMarkdown } from "./item-parts";

/* ───────────────────────── RuntimeStatus ───────────────────────── */

export type RuntimeStatusProps = {
  status: SandboxStatus;
  onRetry?: () => void;
  className?: string;
};

const RUNTIME_TONE: Record<SandboxStatus["state"], "neutral" | "info" | "success" | "warning" | "error"> = {
  "no-runner": "neutral",
  provisioning: "info",
  ready: "success",
  running: "info",
  "timed-out": "warning",
  failed: "error",
};

const FAILURE_KEY = {
  host_unreachable: "hostUnreachable",
  sandbox_failed: "sandboxFailed",
  python_missing: "pythonMissing",
  harness_error: "harnessError",
} as const;

/** Sandbox lifecycle line: icon + state text + one sentence of detail + the single recovery action. */
export function RuntimeStatus({ status, onRetry, className }: RuntimeStatusProps) {
  const t = useTranslations("dojo.runtime");
  const format = useFormatter();
  const tone = RUNTIME_TONE[status.state];
  let icon: React.ReactNode;
  let title: string;
  let detail: string | null = null;
  let action: React.ReactNode = null;

  switch (status.state) {
    case "no-runner":
      icon = <Laptop />;
      title = t("state.noRunner");
      detail = t("detail.noRunner");
      break;
    case "provisioning":
      icon = <Loader2 className="dj-dojo-spin" />;
      title = typeof status.progress === "number"
        ? t("state.provisioningProgress", { progress: format.number(Math.min(1, Math.max(0, status.progress)), { style: "percent" }) })
        : t("state.provisioning");
      break;
    case "ready":
      icon = <ShieldCheck />;
      title = t("state.ready");
      detail = status.runtimeLabel ?? null;
      break;
    case "running":
      icon = <Loader2 className="dj-dojo-spin" />;
      title = t("state.running");
      detail = typeof status.elapsedMs === "number" ? t("elapsed", { seconds: format.number(status.elapsedMs / 1000, { maximumFractionDigits: 1 }) }) : null;
      break;
    case "timed-out":
      icon = <TimerOff />;
      title = t("state.timedOut");
      detail = status.scope === "import" ? t("detail.timedOutImport") : t("detail.timedOutJob");
      if (onRetry) action = <Button variant="outline" size="sm" onClick={onRetry}>{t("retry")}</Button>;
      break;
    case "failed":
      icon = <AlertTriangle />;
      title = t("state.failed");
      detail = t(`detail.${FAILURE_KEY[status.reason]}`);
      if (onRetry) action = <Button variant="outline" size="sm" onClick={onRetry}>{t("retry")}</Button>;
      break;
  }

  return (
    <div
      className={cn("dj-dojo-runtime", className)}
      data-state={status.state}
      data-tone={tone}
      role={status.state === "failed" ? "alert" : "status"}
      aria-live="polite"
    >
      <span className="dj-dojo-runtime__icon" aria-hidden="true">{icon}</span>
      <div className="dj-dojo-runtime__text">
        <span className="dj-dojo-runtime__label dj-type-caption">{t("label")}</span>
        <span className="dj-type-label">{title}</span>
        {detail ? <span className="dj-type-body-sm dj-dojo-muted">{detail}</span> : null}
        {status.state === "failed" && status.detail ? <code className="dj-dojo-runtime__detail dj-type-caption" translate="no">{status.detail}</code> : null}
      </div>
      {action ? <div className="dj-dojo-runtime__action">{action}</div> : null}
    </div>
  );
}

/* ───────────────────────── OutputBlock ───────────────────────── */

/** Machine output (data). Long output is cut to `maxLines` with an expand toggle. */
function OutputBlock({ label, text, maxLines = 12 }: { label: string; text: string; maxLines?: number }) {
  const t = useTranslations("dojo.tests");
  const [expanded, setExpanded] = React.useState(false);
  const lines = text.replace(/\n+$/, "").split("\n");
  const long = lines.length > maxLines;
  const shown = expanded || !long ? lines : lines.slice(0, maxLines);
  return (
    <div className="dj-dojo-output">
      <span className="dj-dojo-output__label dj-type-caption">{label}</span>
      <pre className="dj-dojo-output__pre" translate="no" tabIndex={0}>{shown.join("\n")}</pre>
      {long ? (
        <div className="dj-dojo-output__more">
          {!expanded ? <span className="dj-type-caption dj-dojo-muted">{t("truncated", { count: maxLines, total: lines.length })}</span> : null}
          <Button variant="ghost" size="sm" onClick={() => setExpanded((value) => !value)} aria-expanded={expanded}>
            {expanded ? t("showLess") : t("showAll", { count: lines.length })}
          </Button>
        </div>
      ) : null}
    </div>
  );
}

function FrameList({ frames }: { frames: readonly Frame[] }) {
  const t = useTranslations("dojo.tests");
  if (!frames.length) return null;
  return (
    <ol className="dj-dojo-frames dj-type-caption" aria-label={t("frames")}>
      {frames.map(([file, line, fn], index) => (
        <li key={`${file}:${line}:${index}`} translate="no">{t("frame", { file, line, fn })}</li>
      ))}
    </ol>
  );
}

function Traceback({ traceback }: { traceback: string }) {
  const t = useTranslations("dojo.tests");
  if (!traceback.trim()) return null;
  return (
    <details className="dj-dojo-traceback">
      <summary className="dj-type-caption">{t("traceback")}</summary>
      <pre className="dj-dojo-output__pre" translate="no" tabIndex={0}>{traceback}</pre>
    </details>
  );
}

/* ───────────────────────── TestResultList ───────────────────────── */

export type TestResultListProps = {
  /** `null` before the first run. */
  result: RunResult | null;
  running?: boolean;
  /** Locale-resolved test titles by test id; ids are shown as code otherwise. */
  testTitles?: Readonly<Record<string, string>>;
  /** Ids of hidden tests (titles shown, code not). */
  hiddenTestIds?: readonly string[];
  /** Line cap for stdout/tracebacks before "show all". */
  maxOutputLines?: number;
  /** Heading override (already translated), e.g. "Existing tests" for a refactor split. */
  title?: string;
  className?: string;
};

const OUTCOME_ICON = { pass: CheckCircle2, assert: XCircle, error: Bug, timeout: Clock3 } as const;

function outcomeKind(outcome: TestOutcome) {
  return outcome.ok ? "pass" : outcome.kind;
}

/** Test outcomes from `POST /api/dojo/run`, including every non-`ok` run status. */
export function TestResultList({ result, running = false, testTitles = {}, hiddenTestIds = [], maxOutputLines = 12, title, className }: TestResultListProps) {
  const t = useTranslations("dojo.tests");
  const format = useFormatter();
  const hidden = new Set(hiddenTestIds);

  let body: React.ReactNode;
  let summary: React.ReactNode = null;
  let tone: "neutral" | "success" | "error" | "warning" = "neutral";

  if (running) {
    body = <p className="dj-dojo-tests__empty dj-type-body-sm" aria-live="polite"><Loader2 className="dj-dojo-spin" aria-hidden="true" />{t("running")}</p>;
  } else if (!result) {
    body = <p className="dj-dojo-tests__empty dj-type-body-sm dj-dojo-muted">{t("empty")}</p>;
  } else {
    switch (result.status) {
      case "ok": {
        const failed = result.total - result.passed;
        tone = failed === 0 && result.total > 0 ? "success" : "error";
        summary = (
          <span className="dj-dojo-tests__summary">
            <span className="dj-type-data">{t("summary", { passed: result.passed, total: result.total })}</span>
            <span className="dj-dojo-chip dj-type-caption" data-state={failed === 0 ? "pass" : "fail"}>
              {failed === 0 ? <CheckCircle2 aria-hidden="true" /> : <XCircle aria-hidden="true" />}
              {failed === 0 ? t("allPassed") : t("someFailed", { count: failed })}
            </span>
          </span>
        );
        body = (
          <>
            <ul className="dj-dojo-tests__list">
              {result.results.map((outcome) => {
                const kind = outcomeKind(outcome);
                const Icon = OUTCOME_ICON[kind];
                const title = testTitles[outcome.id];
                return (
                  <li key={outcome.id} className="dj-dojo-test" data-outcome={kind}>
                    <div className="dj-dojo-test__row">
                      <Icon className="dj-dojo-test__icon" aria-hidden="true" />
                      <span className="dj-dojo-test__name">
                        {title ? <span className="dj-type-body">{title}</span> : null}
                        <code className="dj-type-caption dj-dojo-test__id" translate="no">{outcome.id}</code>
                      </span>
                      <span className="dj-dojo-test__meta">
                        {hidden.has(outcome.id) ? <span className="dj-dojo-chip dj-type-caption" data-state="hidden">{t("hidden")}</span> : null}
                        <span className="dj-dojo-test__status dj-type-caption">{t(`outcome.${kind}`)}</span>
                      </span>
                      <span className="dj-dojo-test__ms dj-type-caption">{t("ms", { ms: format.number(outcome.ms, { maximumFractionDigits: 0 }) })}</span>
                    </div>
                    {!outcome.ok ? (
                      <div className="dj-dojo-test__detail">
                        {outcome.kind === "assert" ? (
                          <>
                            <code className="dj-dojo-test__message" translate="no">{outcome.msg || "AssertionError"}</code>
                            <span className="dj-type-caption dj-dojo-muted" translate="no">{t("location", { file: outcome.file, line: outcome.line })}</span>
                          </>
                        ) : null}
                        {outcome.kind === "error" ? (
                          <>
                            <code className="dj-dojo-test__message" translate="no">{`${outcome.exc}: ${outcome.msg}`}</code>
                            <FrameList frames={outcome.frames} />
                            <Traceback traceback={outcome.traceback} />
                          </>
                        ) : null}
                        {outcome.kind === "timeout" ? <span className="dj-type-body-sm">{t("testTimeout")}</span> : null}
                        {outcome.stdout ? <OutputBlock label={t("stdout")} text={outcome.stdout} maxLines={maxOutputLines} /> : null}
                      </div>
                    ) : null}
                  </li>
                );
              })}
            </ul>
            {result.stdout ? <OutputBlock label={t("stdout")} text={result.stdout} maxLines={maxOutputLines} /> : null}
            {result.stderr ? <OutputBlock label={t("stderr")} text={result.stderr} maxLines={maxOutputLines} /> : null}
          </>
        );
        break;
      }
      case "compile_error":
        tone = "error";
        body = (
          <RunProblem icon={<FileWarning />} title={t("compileError")}>
            <code className="dj-dojo-test__message" translate="no">{result.msg}</code>
            <span className="dj-type-caption dj-dojo-muted" translate="no">
              {typeof result.col === "number" ? t("locationCol", { file: result.file, line: result.line, col: result.col }) : t("location", { file: result.file, line: result.line })}
            </span>
          </RunProblem>
        );
        break;
      case "import_error":
        tone = "error";
        body = (
          <RunProblem icon={<PackageX />} title={t("importError")}>
            <code className="dj-dojo-test__message" translate="no">{`${result.exc}: ${result.msg}`}</code>
            <FrameList frames={result.frames} />
            <Traceback traceback={result.traceback} />
          </RunProblem>
        );
        break;
      case "timeout":
        tone = "warning";
        body = (
          <RunProblem icon={<TimerOff />} title={result.scope === "import" ? t("importTimeout") : t("jobTimeout")}>
            <span className="dj-type-body-sm">{result.scope === "import" ? t("importTimeoutBody") : t("jobTimeoutBody")}</span>
          </RunProblem>
        );
        break;
      case "harness_error":
        tone = "warning";
        body = (
          <RunProblem icon={<Cpu />} title={t("harnessError")}>
            <span className="dj-type-body-sm">{t("harnessErrorBody")}</span>
            <code className="dj-dojo-test__message" translate="no">{result.msg}</code>
          </RunProblem>
        );
        break;
      case "runtime_unavailable":
        body = (
          <RunProblem icon={<Laptop />} title={t("unavailable")}>
            <span className="dj-type-body-sm">{t("unavailableBody")}</span>
          </RunProblem>
        );
        break;
      case "script":
        tone = result.exception || result.timedOut ? "error" : "neutral";
        body = (
          <>
            {result.stdout ? <OutputBlock label={t("stdout")} text={result.stdout} maxLines={maxOutputLines} /> : <p className="dj-type-body-sm dj-dojo-muted">{t("noOutput")}</p>}
            {result.stderr ? <OutputBlock label={t("stderr")} text={result.stderr} maxLines={maxOutputLines} /> : null}
            {result.exception ? (
              <RunProblem icon={<Bug />} title={t("scriptException")}>
                <code className="dj-dojo-test__message" translate="no">{`${result.exception.exc}: ${result.exception.msg}`}</code>
                <Traceback traceback={result.exception.traceback} />
              </RunProblem>
            ) : null}
            {result.timedOut ? <RunProblem icon={<TimerOff />} title={t("jobTimeout")}>{null}</RunProblem> : null}
          </>
        );
        break;
      default:
        body = <p className="dj-dojo-tests__empty dj-type-body-sm dj-dojo-muted">{t("empty")}</p>;
    }
  }

  return (
    <section className={cn("dj-dojo-tests", className)} data-tone={tone} aria-label={title ?? t("title")}>
      <header className="dj-dojo-tests__header">
        <h3 className="dj-type-heading-sm">{title ?? t("title")}</h3>
        {summary}
      </header>
      <div aria-live="polite">{body}</div>
    </section>
  );
}

function RunProblem({ icon, title, children }: { icon: React.ReactNode; title: string; children: React.ReactNode }) {
  return (
    <div className="dj-dojo-run-problem" role="alert">
      <span className="dj-dojo-run-problem__icon" aria-hidden="true">{icon}</span>
      <div className="dj-dojo-run-problem__body">
        <span className="dj-type-label">{title}</span>
        {children}
      </div>
    </div>
  );
}

/* ───────────────────────── MutantScoreboard ───────────────────────── */

export type MutantScoreboardProps = {
  result: Extract<RunResult, { status: "mutants" }> | Extract<RunResult, { status: "tests_fail_on_reference" }>;
  /** Locale-resolved mutant descriptions by id. */
  descriptions: Readonly<Record<string, string>>;
  /** Share of mutants that must die (0..1). */
  killTarget: number;
  testTitles?: Readonly<Record<string, string>>;
  className?: string;
};

/** Write-tests outcome: killed vs surviving mutants, or the reference precondition failing. */
export function MutantScoreboard({ result, descriptions, killTarget, testTitles = {}, className }: MutantScoreboardProps) {
  const t = useTranslations("dojo.mutants");
  const format = useFormatter();

  if (result.status === "tests_fail_on_reference") {
    return (
      <section className={cn("dj-dojo-mutants", className)} data-tone="warning" aria-label={t("title")}>
        <header className="dj-dojo-tests__header"><h3 className="dj-type-heading-sm">{t("title")}</h3></header>
        <RunProblem icon={<AlertTriangle />} title={t("referenceFailedTitle")}>
          <span className="dj-type-body-sm">{t("referenceFailed", { passed: result.base.passed, total: result.base.total })}</span>
        </RunProblem>
        <TestResultList result={result.base} testTitles={testTitles} />
      </section>
    );
  }

  const killed = result.mutants.filter((mutant) => mutant.killed).length;
  const total = result.mutants.length;
  const ratio = total ? killed / total : 0;
  const met = ratio >= killTarget - 1e-9;

  return (
    <section className={cn("dj-dojo-mutants", className)} data-tone={met ? "success" : "error"} aria-label={t("title")}>
      <header className="dj-dojo-tests__header">
        <h3 className="dj-type-heading-sm">{t("title")}</h3>
        <span className="dj-dojo-tests__summary">
          <span className="dj-type-data">{t("summary", { killed, total })}</span>
          <span className="dj-dojo-chip dj-type-caption" data-state={met ? "pass" : "fail"}>
            {met ? <CheckCircle2 aria-hidden="true" /> : <XCircle aria-hidden="true" />}
            {met ? t("targetMet") : t("targetMissed")}
          </span>
        </span>
      </header>
      <div className="dj-dojo-mutants__meter" aria-hidden="true">
        <span className="dj-dojo-mutants__fill" style={{ inlineSize: `${ratio * 100}%` }} />
        <span className="dj-dojo-mutants__target" style={{ insetInlineStart: `${Math.min(1, killTarget) * 100}%` }} />
      </div>
      <p className="dj-type-caption dj-dojo-muted">{t("target", { target: format.number(killTarget, { style: "percent" }) })}</p>
      <ul className="dj-dojo-tests__list">
        {result.mutants.map((mutant) => (
          <li key={mutant.id} className="dj-dojo-test" data-outcome={mutant.killed ? "pass" : "assert"}>
            <div className="dj-dojo-test__row">
              {mutant.killed ? <Skull className="dj-dojo-test__icon" aria-hidden="true" /> : <Bug className="dj-dojo-test__icon" aria-hidden="true" />}
              <span className="dj-dojo-test__name">
                <span className="dj-type-body">{descriptions[mutant.id] ?? mutant.id}</span>
                <code className="dj-type-caption dj-dojo-test__id" translate="no">{mutant.id}</code>
              </span>
              <span className="dj-dojo-test__status dj-type-caption">
                {mutant.killed
                  ? (mutant.by ? t("killedBy", { test: testTitles[mutant.by] ?? mutant.by }) : t("killed"))
                  : t("survived")}
              </span>
            </div>
          </li>
        ))}
      </ul>
    </section>
  );
}

/* ───────────────────────── RubricResult ───────────────────────── */

export type RubricCriterionView = {
  id: string;
  /** Locale-resolved criterion text (content data). */
  description: string;
  weight: number;
  mustMention?: readonly string[];
};

export type RubricScoreView = {
  id: string;
  /** 0..1 */
  score: number;
  /** Quote from the learner's answer the grader relied on (data). */
  evidence?: string;
};

export type RubricResultProps =
  | {
      mode: "ai";
      criteria: readonly RubricCriterionView[];
      scores: readonly RubricScoreView[];
      /** 0..1 */
      passAt: number;
      /** Weighted total q (0..1). */
      total: number;
      className?: string;
    }
  | {
      /** No AI grader configured: compare with the model answer and pick a grade. */
      mode: "self";
      criteria: readonly RubricCriterionView[];
      /** Locale-resolved model answer (Markdown). */
      modelAnswer: string;
      selected?: Grade | null;
      onSelfGrade?: (grade: Grade) => void;
      disabled?: boolean;
      className?: string;
    };

const GRADE_KEY = { 1: "again", 2: "hard", 3: "good", 4: "easy" } as const;

function scoreBand(score: number) {
  return score >= 0.85 ? "pass" : score >= 0.4 ? "partial" : "fail";
}

/** Per-criterion rubric scores with evidence, or the self-grade fallback. */
export function RubricResult(props: RubricResultProps) {
  const t = useTranslations("dojo.rubric");
  const format = useFormatter();
  const percent = (value: number) => format.number(Math.min(1, Math.max(0, value)), { style: "percent" });

  if (props.mode === "self") {
    const { criteria, modelAnswer, selected, onSelfGrade, disabled } = props;
    return (
      <section className={cn("dj-dojo-rubric", props.className)} data-mode="self" aria-label={t("selfTitle")}>
        <header className="dj-dojo-rubric__header">
          <h3 className="dj-type-heading-sm">{t("selfTitle")}</h3>
        </header>
        <p className="dj-type-body-sm dj-dojo-muted">{t("selfBody")}</p>
        <div className="dj-dojo-rubric__model">
          <span className="dj-type-caption dj-dojo-rubric__label">{t("modelAnswer")}</span>
          <Markdown>{modelAnswer}</Markdown>
        </div>
        <ul className="dj-dojo-rubric__list">
          {criteria.map((criterion) => (
            <li key={criterion.id} className="dj-dojo-rubric__criterion">
              <span className="dj-dojo-rubric__bullet" aria-hidden="true" />
              <div className="dj-dojo-rubric__text">
                <span className="dj-type-body"><InlineMarkdown>{criterion.description}</InlineMarkdown></span>
                {criterion.mustMention?.length ? (
                  <span className="dj-type-caption dj-dojo-muted">{t("mentions", { terms: format.list(criterion.mustMention, { type: "conjunction" }) })}</span>
                ) : null}
              </div>
            </li>
          ))}
        </ul>
        <div className="dj-dojo-rubric__grades" role="radiogroup" aria-label={t("gradeLegend")}>
          <span className="dj-type-label">{t("gradeLegend")}</span>
          <div className="dj-dojo-rubric__grade-buttons">
            {([1, 2, 3, 4] as const).map((grade) => (
              <Button
                key={grade}
                variant={selected === grade ? "primary" : "outline"}
                size="sm"
                role="radio"
                aria-checked={selected === grade}
                data-grade={GRADE_KEY[grade]}
                disabled={disabled || !onSelfGrade}
                onClick={() => onSelfGrade?.(grade)}
              >
                {t(`grade.${GRADE_KEY[grade]}`)}
              </Button>
            ))}
          </div>
        </div>
      </section>
    );
  }

  const { criteria, scores, passAt, total } = props;
  const byId = new Map(scores.map((score) => [score.id, score]));
  const passed = total >= passAt - 1e-9;
  return (
    <section className={cn("dj-dojo-rubric", props.className)} data-mode="ai" aria-label={t("title")}>
      <header className="dj-dojo-rubric__header">
        <h3 className="dj-type-heading-sm">{t("title")}</h3>
        <span className="dj-dojo-tests__summary">
          <span className="dj-type-data">{t("total", { value: percent(total) })}</span>
          <span className="dj-dojo-chip dj-type-caption" data-state={passed ? "pass" : "fail"}>
            {passed ? <CheckCircle2 aria-hidden="true" /> : <XCircle aria-hidden="true" />}
            {t("passAt", { value: percent(passAt) })}
          </span>
        </span>
      </header>
      <ul className="dj-dojo-rubric__list">
        {criteria.map((criterion) => {
          const score = byId.get(criterion.id);
          const value = score?.score ?? 0;
          const band = scoreBand(value);
          return (
            <li key={criterion.id} className="dj-dojo-rubric__criterion" data-band={band}>
              <span className="dj-dojo-rubric__score dj-type-data" aria-label={t("scoreAria", { value: percent(value) })}>{percent(value)}</span>
              <div className="dj-dojo-rubric__text">
                <span className="dj-type-body"><InlineMarkdown>{criterion.description}</InlineMarkdown></span>
                <span className="dj-dojo-rubric__meter" aria-hidden="true"><span style={{ inlineSize: `${value * 100}%` }} /></span>
                {score?.evidence ? (
                  <blockquote className="dj-dojo-rubric__evidence dj-type-body-sm">
                    <span className="dj-type-caption dj-dojo-rubric__label">{t("evidence")}</span>
                    {score.evidence}
                  </blockquote>
                ) : (
                  <span className="dj-type-caption dj-dojo-muted">{t("noEvidence")}</span>
                )}
              </div>
            </li>
          );
        })}
      </ul>
    </section>
  );
}
