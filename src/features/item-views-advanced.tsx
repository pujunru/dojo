"use client";

/**
 * Item views for the advanced types (WP9): refactor, write-tests, review and
 * the timed ladder, plus the ladder's LevelStepper and the mock's
 * self-assessment form. Controlled and presentational like the MVP views:
 * the app layer runs code, owns the clock and grades.
 */
import * as React from "react";
import { CheckCircle2, Circle, CircleDot, Clock3, Lock, MessageSquarePlus, RotateCcw, SkipForward, Trash2, XCircle } from "lucide-react";
import { useFormatter, useLocale, useTranslations } from "use-intl";
import { Button } from "../ui/button";
import { CodeEditor, codeLanguageForPath } from "../ui/code-editor";
import { Countdown, formatClock } from "../ui/countdown";
import { DiffViewer, type DiffLine, type DiffReveal } from "../ui/diff-viewer";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "../ui/select";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "../ui/tabs";
import { ToggleGroup, ToggleGroupItem } from "../ui/toggle-group";
import { cn } from "../lib/utils";
import { pickL10n, type LadderItem, type RefactorItem, type ReviewItem, type TestMeta, type WriteTestsItem } from "../core/content-schema";
import type { RunResult, TestOutcome } from "../core/run-protocol";
import { Markdown } from "../ui/markdown";
import { DojoCodeFile, NeedsRunnerNotice } from "./item-parts";
import { runDiagnostics, type ImplementAnswer } from "./item-views-write";
import type { CodeRunState, DojoItemViewBaseProps, PyFile, SandboxStatus } from "./types";
import { MutantScoreboard, RuntimeStatus, TestResultList } from "./runtime";

/* ───────────────────────── shared: file tabs ───────────────────────── */

type FileTab = { value: string; label: string; file: PyFile; editable: boolean };

/** Editable answer files beside read-only reference tabs (tests, solution). */
function DojoFileTabs({
  tabs,
  locked,
  result,
  onEdit,
  onReset,
  ariaLabel,
  minHeight = "16rem",
}: {
  tabs: FileTab[];
  locked: boolean;
  result: RunResult | null;
  onEdit: (path: string, content: string) => void;
  onReset?: () => void;
  ariaLabel: string;
  minHeight?: string;
}) {
  const t = useTranslations("dojo.items.implement");
  const tEditor = useTranslations("dojo.editor");
  const [tab, setTab] = React.useState(tabs[0]?.value ?? "");
  const active = tabs.some((entry) => entry.value === tab) ? tab : tabs[0]?.value ?? "";
  return (
    <Tabs value={active} onValueChange={setTab}>
      <div className="dj-dojo-implement__toolbar">
        <TabsList variant="view-switch" aria-label={ariaLabel}>
          {tabs.map((entry) => (
            <TabsTrigger key={entry.value} value={entry.value} className="dj-dojo-implement__tab" translate="no">{entry.label}</TabsTrigger>
          ))}
        </TabsList>
        {onReset && !locked ? (
          <Button variant="ghost" size="sm" onClick={onReset}>
            <RotateCcw aria-hidden="true" />
            {t("reset")}
          </Button>
        ) : null}
      </div>
      {tabs.map((entry) => (
        <TabsContent key={entry.value} value={entry.value} className="dj-dojo-implement__panel">
          <CodeEditor
            value={entry.file.content}
            language={codeLanguageForPath(entry.file.path)}
            onChange={entry.editable && !locked ? (content) => onEdit(entry.file.path, content) : undefined}
            readOnly={!entry.editable || locked}
            diagnostics={entry.editable ? runDiagnostics(result, entry.file.path) : undefined}
            ariaLabel={entry.editable ? t("editorLabel", { path: entry.file.path }) : tEditor("readOnlyLabel", { path: entry.file.path })}
            loadingLabel={tEditor("loading")}
            minHeight={minHeight}
            maxHeight="32rem"
            footer={entry.editable && !locked ? <span>{tEditor("keyboardHint")}</span> : undefined}
          />
        </TabsContent>
      ))}
    </Tabs>
  );
}

function editFile(files: PyFile[], path: string, content: string) {
  return files.map((file) => (file.path === path ? { ...file, content } : file));
}

/** Lines that differ between two versions of the answer (a cheap per-line count). */
export function changedLineCount(before: readonly PyFile[], after: readonly PyFile[]) {
  let changed = 0;
  for (const file of after) {
    const old = before.find((entry) => entry.path === file.path)?.content.split("\n") ?? [];
    const next = file.content.split("\n");
    const length = Math.max(old.length, next.length);
    for (let i = 0; i < length; i += 1) if (old[i] !== next[i]) changed += 1;
  }
  return changed;
}

/** A result restricted to some test ids (a refactor's old vs new tests). */
export function filterRunResult(result: RunResult | null, ids: ReadonlySet<string>): RunResult | null {
  if (!result || result.status !== "ok") return result;
  const results = result.results.filter((outcome: TestOutcome) => ids.has(outcome.id));
  return { ...result, results, total: results.length, passed: results.filter((outcome) => outcome.ok).length };
}

function titlesOf(meta: readonly TestMeta[], locale: string) {
  return Object.fromEntries(meta.filter((entry) => entry.title).map((entry) => [entry.id, pickL10n(entry.title, locale as never)]));
}

/* ───────────────────────── Refactor ───────────────────────── */

export type RefactorAnswer = ImplementAnswer;
export const emptyRefactorAnswer = (item: Pick<RefactorItem, "starter">): RefactorAnswer => ({ files: item.starter.map((file) => ({ ...file })) });
export const isRefactorAnswerComplete = (item: Pick<RefactorItem, "starter">, answer: RefactorAnswer) =>
  answer.files.some((file) => file.content !== item.starter.find((starter) => starter.path === file.path)?.content);

export type RefactorItemViewProps = DojoItemViewBaseProps<RefactorItem, RefactorAnswer> & {
  sandbox: SandboxStatus;
  run: CodeRunState;
  onReset?: () => void;
  onRetrySandbox?: () => void;
};

/**
 * Working legacy code + a new requirement + the public API that must not
 * change. Runs the baseline's existing tests (visible) and the requirement's
 * new tests (hidden) together and shows the two groups apart, so a
 * regression reads differently from a missing feature.
 */
export function RefactorItemView({ item, answer, onAnswerChange, reveal, disabled = false, platform, sandbox, run, onReset, onRetrySandbox }: RefactorItemViewProps) {
  const t = useTranslations("dojo.items.refactor");
  const locale = useLocale();
  const result = run.state === "done" ? run.result : null;
  const running = run.state === "running";
  const locked = disabled || running || Boolean(reveal);
  const oldIds = new Set(item.testMeta.filter((meta) => !meta.hidden).map((meta) => meta.id));
  const newIds = new Set(item.testMeta.filter((meta) => meta.hidden).map((meta) => meta.id));
  const titles = titlesOf(item.testMeta, locale);
  const changed = changedLineCount(item.baseline, answer.files);
  const limit = item.constraints.maxChangedLinesHint;

  const brief = (
    <>
      <div className="dj-dojo-callout" data-tone="question">
        <span className="dj-type-caption dj-dojo-callout__label">{t("newRequirement")}</span>
        <Markdown>{pickL10n(item.newRequirement, locale as never)}</Markdown>
      </div>
      {item.constraints.publicApi.length ? (
        <div className="dj-dojo-constraints">
          <span className="dj-type-caption dj-dojo-callout__label">{t("publicApi")}</span>
          <ul className="dj-dojo-constraints__list">
            {item.constraints.publicApi.map((signature) => <li key={signature}><code translate="no">{signature}</code></li>)}
          </ul>
        </div>
      ) : null}
    </>
  );

  if (platform === "no-runner") {
    return (
      <div className="dj-dojo-item" data-type="refactor" data-platform="no-runner">
        {brief}
        <NeedsRunnerNotice />
        <div className="dj-dojo-item__code">{item.baseline.map((file) => <DojoCodeFile key={file.path} file={file} maxHeight="18rem" />)}</div>
      </div>
    );
  }

  const tabs: FileTab[] = [
    ...answer.files.map((file) => ({ value: file.path, label: file.path, file, editable: true })),
    ...(item.visibleTests ? [{ value: `tests:${item.visibleTests.path}`, label: item.visibleTests.path, file: item.visibleTests, editable: false }] : []),
    ...(reveal ? item.solution.map((file) => ({ value: `solution:${file.path}`, label: t("solutionTab", { path: file.path }), file, editable: false })) : []),
  ];
  const groupSummary = (ids: Set<string>) => {
    if (!result || result.status !== "ok") return null;
    const subset = result.results.filter((outcome) => ids.has(outcome.id));
    return { passed: subset.filter((outcome) => outcome.ok).length, total: subset.length };
  };
  const oldSummary = groupSummary(oldIds);
  const newSummary = groupSummary(newIds);

  return (
    <div className="dj-dojo-item" data-type="refactor">
      {brief}
      <div className="dj-dojo-implement">
        <div className="dj-dojo-implement__editor">
          <DojoFileTabs
            tabs={tabs}
            locked={locked}
            result={result}
            ariaLabel={t("filesLabel")}
            onReset={onReset}
            onEdit={(path, content) => onAnswerChange({ files: editFile(answer.files, path, content) })}
          />
          <p className="dj-type-caption dj-dojo-muted" data-over={limit && changed > limit ? "true" : undefined}>
            {limit ? t("changedLinesOf", { count: changed, limit }) : t("changedLines", { count: changed })}
          </p>
        </div>
        <div className="dj-dojo-implement__results">
          <RuntimeStatus status={running ? { state: "running" } : sandbox} onRetry={onRetrySandbox} />
          {oldSummary && newSummary ? (
            <div className="dj-dojo-split" role="group" aria-label={t("splitLabel")}>
              <SplitTile label={t("oldTests")} {...oldSummary} />
              <SplitTile label={t("newTests")} {...newSummary} />
            </div>
          ) : null}
          {result && result.status === "ok" ? (
            <>
              <TestResultList title={t("oldTests")} result={filterRunResult(result, oldIds)} testTitles={titles} />
              <TestResultList title={t("newTests")} result={filterRunResult(result, newIds)} testTitles={titles} hiddenTestIds={[...newIds]} />
            </>
          ) : (
            <TestResultList result={result} running={running} testTitles={titles} hiddenTestIds={[...newIds]} />
          )}
        </div>
      </div>
    </div>
  );
}

function SplitTile({ label, passed, total }: { label: string; passed: number; total: number }) {
  const t = useTranslations("dojo.items.refactor");
  const ok = total > 0 && passed === total;
  return (
    <div className="dj-dojo-split__tile" data-ok={ok ? "true" : "false"}>
      {ok ? <CheckCircle2 aria-hidden="true" /> : <XCircle aria-hidden="true" />}
      <span className="dj-type-caption">{label}</span>
      <span className="dj-type-data">{t("passedOf", { passed, total })}</span>
    </div>
  );
}

/* ───────────────────────── Write tests ───────────────────────── */

export type WriteTestsAnswer = { tests: PyFile };
export const emptyWriteTestsAnswer = (item: Pick<WriteTestsItem, "testStarter">): WriteTestsAnswer => ({ tests: { ...item.testStarter } });
export const isWriteTestsAnswerComplete = (item: Pick<WriteTestsItem, "testStarter">, answer: WriteTestsAnswer) =>
  answer.tests.content.trim() !== item.testStarter.content.trim() && /\bdef\s+test_/.test(answer.tests.content);

export type WriteTestsItemViewProps = DojoItemViewBaseProps<WriteTestsItem, WriteTestsAnswer> & {
  sandbox: SandboxStatus;
  run: CodeRunState;
  onReset?: () => void;
  onRetrySandbox?: () => void;
};

/**
 * The learner writes tests against a spec and a readable reference. A run
 * first checks the tests are green on the reference, then runs them against
 * every planted mutant; the scoreboard shows the kill ratio against
 * `killTarget`. Mutant descriptions stay hidden until the reveal.
 */
export function WriteTestsItemView({ item, answer, onAnswerChange, reveal, disabled = false, platform, sandbox, run, onReset, onRetrySandbox }: WriteTestsItemViewProps) {
  const t = useTranslations("dojo.items.writeTests");
  const format = useFormatter();
  const locale = useLocale();
  const result = run.state === "done" ? run.result : null;
  const running = run.state === "running";
  const locked = disabled || running || Boolean(reveal);
  const descriptions = Object.fromEntries(item.mutants.map((m) => [m.id, reveal ? pickL10n(m.description, locale as never) : t("mutantHidden")]));

  const spec = (
    <div className="dj-dojo-callout" data-tone="question">
      <span className="dj-type-caption dj-dojo-callout__label">{t("spec")}</span>
      <Markdown>{pickL10n(item.spec, locale as never)}</Markdown>
      <span className="dj-type-caption dj-dojo-muted">
        {t("target", { count: item.mutants.length, target: format.number(item.killTarget, { style: "percent" }) })}
      </span>
    </div>
  );

  if (platform === "no-runner") {
    return (
      <div className="dj-dojo-item" data-type="write-tests" data-platform="no-runner">
        {spec}
        <NeedsRunnerNotice />
        <div className="dj-dojo-item__code">{item.subject.map((file) => <DojoCodeFile key={file.path} file={file} maxHeight="18rem" />)}</div>
      </div>
    );
  }

  const tabs: FileTab[] = [
    { value: answer.tests.path, label: answer.tests.path, file: answer.tests, editable: true },
    ...item.subject.map((file) => ({ value: `subject:${file.path}`, label: file.path, file, editable: false })),
  ];

  return (
    <div className="dj-dojo-item" data-type="write-tests">
      {spec}
      <div className="dj-dojo-implement">
        <div className="dj-dojo-implement__editor">
          <DojoFileTabs
            tabs={tabs}
            locked={locked}
            result={result}
            ariaLabel={t("filesLabel")}
            onReset={onReset}
            onEdit={(_path, content) => onAnswerChange({ tests: { ...answer.tests, content } })}
          />
        </div>
        <div className="dj-dojo-implement__results">
          <RuntimeStatus status={running ? { state: "running" } : sandbox} onRetry={onRetrySandbox} />
          {result && (result.status === "mutants" || result.status === "tests_fail_on_reference") ? (
            <MutantScoreboard result={result} descriptions={descriptions} killTarget={item.killTarget} />
          ) : (
            <TestResultList result={result} running={running} />
          )}
        </div>
      </div>
    </div>
  );
}

/* ───────────────────────── Review ───────────────────────── */

export const REVIEW_SEVERITY_OPTIONS = ["blocker", "major", "minor"] as const;
/** Categories offered in the finding editor; item categories outside the list are added. */
export const REVIEW_CATEGORY_OPTIONS = ["correctness", "state", "error-handling", "concurrency", "performance", "security", "api", "testing", "readability"] as const;

export type ReviewFindingAnswer = {
  anchor: string;
  path: string;
  line: number;
  severity: (typeof REVIEW_SEVERITY_OPTIONS)[number] | null;
  category: string | null;
};
export type ReviewAnswer = { findings: ReviewFindingAnswer[] };
export const emptyReviewAnswer = (): ReviewAnswer => ({ findings: [] });
export const isReviewAnswerComplete = (answer: ReviewAnswer) => answer.findings.length > 0;

export type ReviewRevealDetail = {
  hits: { issueId: string; finding: number; severityOk: boolean; categoryOk: boolean }[];
  missed: string[];
  falsePositives: number[];
};

export type ReviewItemViewProps = DojoItemViewBaseProps<ReviewItem, ReviewAnswer> & {
  /** Grader breakdown once revealed (`scoreReviewFindings`). */
  detail?: ReviewRevealDetail | null;
};

function lineOf(line: DiffLine) {
  return line.newLine ?? line.oldLine ?? 0;
}
function pathOfAnchor(anchor: string) {
  return anchor.slice(0, anchor.lastIndexOf("#"));
}

/**
 * Review a diff: select a line to add a finding, then give it a severity and
 * a category. Graded by line tolerance; the reveal marks hits, misses and
 * false positives on the diff and lists every planted issue.
 */
export function ReviewItemView({ item, answer, onAnswerChange, reveal, disabled = false, detail }: ReviewItemViewProps) {
  const t = useTranslations("dojo.items.review");
  const locale = useLocale();
  const locked = disabled || Boolean(reveal);
  const [selected, setSelected] = React.useState<string | null>(null);
  const categories = [...new Set([...REVIEW_CATEGORY_OPTIONS, ...item.issues.map((issue) => issue.category)])];
  const categoryLabel = (id: string) => ((REVIEW_CATEGORY_OPTIONS as readonly string[]).includes(id) ? t(`category.${id}` as never) : id);

  const update = (index: number, patch: Partial<ReviewFindingAnswer>) =>
    onAnswerChange({ findings: answer.findings.map((finding, i) => (i === index ? { ...finding, ...patch } : finding)) });
  const remove = (index: number) => onAnswerChange({ findings: answer.findings.filter((_, i) => i !== index) });

  const onSelectLine = (anchor: string, line: DiffLine) => {
    if (locked) return;
    setSelected(anchor);
    if (!answer.findings.some((finding) => finding.anchor === anchor)) {
      onAnswerChange({ findings: [...answer.findings, { anchor, path: pathOfAnchor(anchor), line: lineOf(line), severity: null, category: null }] });
    }
  };

  const revealMap: DiffReveal | undefined = reveal && detail ? (() => {
    const map: DiffReveal = {};
    detail.falsePositives.forEach((index) => { const f = answer.findings[index]; if (f) map[f.anchor] = "false-positive"; });
    detail.hits.forEach((hit) => { const f = answer.findings[hit.finding]; if (f) map[f.anchor] = "hit"; });
    for (const id of detail.missed) {
      const issue = item.issues.find((entry) => entry.id === id);
      if (issue) map[`${issue.path}#R${issue.line}`] = "missed";
    }
    return map;
  })() : undefined;

  const editor = (finding: ReviewFindingAnswer, index: number) => (
    <div className="dj-dojo-finding" data-complete={finding.severity && finding.category ? "true" : "false"}>
      <div className="dj-dojo-finding__head">
        <span className="dj-type-caption" translate="no">{t("findingAt", { path: finding.path, line: finding.line })}</span>
        {!locked ? (
          <Button variant="ghost" size="sm" onClick={() => remove(index)} aria-label={t("removeFinding", { line: finding.line })}>
            <Trash2 aria-hidden="true" />
          </Button>
        ) : null}
      </div>
      <div className="dj-dojo-finding__fields">
        <ToggleGroup
          type="single"
          value={finding.severity ?? ""}
          onValueChange={(value) => update(index, { severity: (value || null) as ReviewFindingAnswer["severity"] })}
          aria-label={t("severityLabel")}
          disabled={locked}
          className="dj-dojo-finding__severity"
        >
          {REVIEW_SEVERITY_OPTIONS.map((severity) => (
            <ToggleGroupItem key={severity} value={severity} data-severity={severity}>{t(`severity.${severity}`)}</ToggleGroupItem>
          ))}
        </ToggleGroup>
        <Select value={finding.category ?? undefined} onValueChange={(value) => update(index, { category: value })} disabled={locked}>
          <SelectTrigger aria-label={t("categoryLabel")} className="dj-dojo-finding__category">
            <SelectValue placeholder={t("categoryPlaceholder")} />
          </SelectTrigger>
          <SelectContent>
            {categories.map((category) => <SelectItem key={category} value={category}>{categoryLabel(category)}</SelectItem>)}
          </SelectContent>
        </Select>
      </div>
    </div>
  );

  const complete = answer.findings.filter((finding) => finding.severity && finding.category).length;

  return (
    <div className="dj-dojo-item" data-type="review">
      <p className="dj-type-body-sm dj-dojo-muted">{t("instructions")}</p>
      <DiffViewer
        diff={item.diff}
        ariaLabel={t("diffLabel")}
        selectedAnchor={selected}
        onSelectLine={locked ? undefined : onSelectLine}
        commentedAnchors={answer.findings.map((finding) => finding.anchor)}
        reveal={revealMap}
        renderLineAddon={(anchor) => {
          if (locked) return null;
          const index = answer.findings.findIndex((finding) => finding.anchor === anchor);
          return index >= 0 && selected === anchor ? editor(answer.findings[index], index) : null;
        }}
        labels={{
          lineName: (line) => t("lineName", { kind: line.kind, line: lineOf(line), code: line.content.trim() }),
          commented: t("commented"),
          hit: t("hit"),
          missed: t("missed"),
          falsePositive: t("falsePositive"),
          empty: t("emptyDiff"),
        }}
      />
      {item.context.length ? (
        <details className="dj-dojo-details">
          <summary className="dj-type-label">{t("context")}</summary>
          <div className="dj-dojo-item__code">{item.context.map((file) => <DojoCodeFile key={file.path} file={file} maxHeight="20rem" />)}</div>
        </details>
      ) : null}
      <section className="dj-dojo-findings" aria-label={t("findingsTitle")}>
        <header className="dj-dojo-tests__header">
          <h3 className="dj-type-heading-sm">{t("findingsTitle")}</h3>
          <span className="dj-type-caption dj-dojo-muted">{t("findingsCount", { count: answer.findings.length, complete })}</span>
        </header>
        {answer.findings.length === 0 ? (
          <p className="dj-type-body-sm dj-dojo-muted">{t("noFindings")}</p>
        ) : (
          <ul className="dj-dojo-findings__list">
            {answer.findings.map((finding, index) => {
              const hit = detail?.hits.find((entry) => entry.finding === index);
              const fp = detail?.falsePositives.includes(index);
              return (
                <li key={finding.anchor} data-reveal={reveal ? (hit ? "hit" : fp ? "false-positive" : undefined) : undefined}>
                  {locked ? (
                    <div className="dj-dojo-finding">
                      <div className="dj-dojo-finding__head">
                        <span className="dj-type-caption" translate="no">{t("findingAt", { path: finding.path, line: finding.line })}</span>
                        {reveal ? <span className="dj-dojo-chip dj-type-caption" data-state={hit ? "pass" : "fail"}>{hit ? t("hit") : t("falsePositive")}</span> : null}
                      </div>
                      <p className="dj-type-body-sm">
                        {finding.severity ? t(`severity.${finding.severity}`) : t("noSeverity")} · {finding.category ? categoryLabel(finding.category) : t("noCategory")}
                      </p>
                    </div>
                  ) : selected === finding.anchor ? (
                    <span className="dj-type-caption dj-dojo-muted">{t("editingInline", { line: finding.line })}</span>
                  ) : (
                    <button type="button" className="dj-dojo-finding__summary" onClick={() => setSelected(finding.anchor)}>
                      <MessageSquarePlus aria-hidden="true" />
                      <span translate="no">{t("findingAt", { path: finding.path, line: finding.line })}</span>
                      <span className="dj-dojo-muted">
                        {finding.severity ? t(`severity.${finding.severity}`) : t("noSeverity")} · {finding.category ? categoryLabel(finding.category) : t("noCategory")}
                      </span>
                    </button>
                  )}
                </li>
              );
            })}
          </ul>
        )}
      </section>
      {reveal ? (
        <section className="dj-dojo-reveal-list" aria-label={t("issuesTitle")}>
          <h3 className="dj-type-heading-sm">{t("issuesTitle")}</h3>
          <ul className="dj-dojo-issues">
            {item.issues.map((issue) => {
              const hit = detail?.hits.find((entry) => entry.issueId === issue.id);
              return (
                <li key={issue.id} className="dj-dojo-issue" data-found={hit ? "true" : "false"}>
                  <span className="dj-dojo-chip dj-type-caption" data-state={hit ? "pass" : "fail"}>{hit ? t("hit") : t("missed")}</span>
                  <span className="dj-type-caption" translate="no">{t("findingAt", { path: issue.path, line: issue.line })}</span>
                  <span className="dj-type-caption">
                    {t(`severity.${issue.severity}`)} · {categoryLabel(issue.category)}
                    {hit && (!hit.severityOk || !hit.categoryOk) ? ` — ${t(hit.severityOk ? "categoryWrong" : hit.categoryOk ? "severityWrong" : "bothWrong")}` : ""}
                  </span>
                  <div className="dj-dojo-issue__text"><Markdown>{pickL10n(issue.description, locale as never)}</Markdown></div>
                </li>
              );
            })}
          </ul>
        </section>
      ) : null}
    </div>
  );
}

/* ───────────────────────── Ladder: LevelStepper ───────────────────────── */

export type LadderLevelStatus = "locked" | "active" | "passed" | "failed" | "skipped";

export type LevelStepView = {
  id: string;
  /** Locale-resolved level title (content data). */
  title: string;
  timeboxSec: number;
  status: LadderLevelStatus;
  /** Seconds spent so far (or in total once resolved). */
  elapsedSec: number;
  /** Failed runs before the level resolved. */
  failedRuns?: number;
};

export type LevelStepperProps = { levels: LevelStepView[]; className?: string };

const STEP_ICON = { locked: Lock, active: CircleDot, passed: CheckCircle2, failed: XCircle, skipped: SkipForward } as const;

/** The ladder's levels as an ordered progress list: state, timebox and time used (overtime flagged). */
export function LevelStepper({ levels, className }: LevelStepperProps) {
  const t = useTranslations("dojo.items.ladder");
  return (
    <ol className={cn("dj-dojo-steps", className)} aria-label={t("levelsLabel")}>
      {levels.map((level, index) => {
        const Icon = STEP_ICON[level.status] ?? Circle;
        const overtime = level.status !== "locked" && level.elapsedSec > level.timeboxSec;
        return (
          <li key={level.id} className="dj-dojo-step" data-status={level.status} aria-current={level.status === "active" ? "step" : undefined}>
            <span className="dj-dojo-step__disc" aria-hidden="true"><Icon /></span>
            <span className="dj-dojo-step__body">
              <span className="dj-type-caption dj-dojo-step__eyebrow">{t("levelNumber", { number: index + 1 })} · {t(`status.${level.status}`)}</span>
              <span className="dj-type-label dj-dojo-step__title">{level.status === "locked" ? t("lockedTitle") : level.title}</span>
              <span className="dj-type-caption dj-dojo-step__time" data-overtime={overtime ? "true" : undefined}>
                <Clock3 aria-hidden="true" />
                {level.status === "locked"
                  ? t("timebox", { minutes: Math.round(level.timeboxSec / 60) })
                  : t("timeUsed", { used: formatClock(level.elapsedSec), minutes: Math.round(level.timeboxSec / 60) })}
                {overtime ? <span className="dj-dojo-step__overtime">{t("overtime")}</span> : null}
              </span>
              {level.failedRuns ? <span className="dj-type-caption dj-dojo-muted">{t("failedRuns", { count: level.failedRuns })}</span> : null}
            </span>
          </li>
        );
      })}
    </ol>
  );
}

/* ───────────────────────── Ladder: item view ───────────────────────── */

export type LadderLevelRecord = {
  status: LadderLevelStatus;
  elapsedSec: number;
  failedRuns: number;
  /** Last run of this level's tests. */
  result?: RunResult | null;
};

export type LadderAnswer = {
  files: PyFile[];
  /** Index of the level being worked on; `levels.length` once all are resolved. */
  current: number;
  levels: Record<string, LadderLevelRecord>;
};

export function emptyLadderAnswer(item: Pick<LadderItem, "starter" | "levels">): LadderAnswer {
  return {
    files: item.starter.map((file) => ({ ...file })),
    current: 0,
    levels: Object.fromEntries(item.levels.map((level, index) => [level.id, { status: index === 0 ? "active" : "locked", elapsedSec: 0, failedRuns: 0 } satisfies LadderLevelRecord])),
  };
}
export const isLadderAnswerComplete = (item: Pick<LadderItem, "starter">, answer: LadderAnswer) =>
  answer.files.some((file) => file.content !== item.starter.find((starter) => starter.path === file.path)?.content);

export type LadderItemViewProps = DojoItemViewBaseProps<LadderItem, LadderAnswer> & {
  sandbox: SandboxStatus;
  run: CodeRunState;
  /** Seconds left in the current level (negative = overtime). The caller owns the clock. */
  remainingSeconds: number;
  paused?: boolean;
  onSkipLevel?: () => void;
  onRetrySandbox?: () => void;
};

/**
 * A timed multi-level mini question. Only the current level's prompt is
 * visible (earlier ones fold into "solved levels"); each level has its own
 * timer, and overtime keeps counting rather than stopping the learner. Run
 * tests (the frame's primary action) checks the current level; Skip moves on.
 */
export function LadderItemView({ item, answer, onAnswerChange, reveal, disabled = false, platform, sandbox, run, remainingSeconds, paused = false, onSkipLevel, onRetrySandbox }: LadderItemViewProps) {
  const t = useTranslations("dojo.items.ladder");
  const tCountdown = useTranslations("dojo.items.ladder.countdown");
  const locale = useLocale();
  const running = run.state === "running";
  const locked = disabled || running || Boolean(reveal);
  const level = item.levels[Math.min(answer.current, item.levels.length - 1)];
  const record = answer.levels[level.id];
  const result = run.state === "done" ? run.result : record?.result ?? null;
  const steps: LevelStepView[] = item.levels.map((entry) => ({
    id: entry.id,
    title: pickL10n(entry.title, locale as never),
    timeboxSec: entry.timeboxMin * 60,
    status: answer.levels[entry.id]?.status ?? "locked",
    elapsedSec: answer.levels[entry.id]?.elapsedSec ?? 0,
    failedRuns: answer.levels[entry.id]?.failedRuns ?? 0,
  }));
  const earlier = item.levels.slice(0, Math.min(answer.current, item.levels.length));
  const done = answer.current >= item.levels.length;
  const titles = titlesOf(level.testMeta, locale);

  const header = (
    <div className="dj-dojo-ladder__head">
      <LevelStepper levels={steps} />
      {!done && !reveal ? (
        <Countdown
          remainingSeconds={remainingSeconds}
          totalSeconds={level.timeboxMin * 60}
          paused={paused}
          labels={{
            name: tCountdown("name", { level: answer.current + 1 }),
            warning: tCountdown("warning"),
            overtime: tCountdown("overtime"),
            paused: tCountdown("paused"),
            announceWarning: tCountdown("announceWarning"),
            announceOvertime: tCountdown("announceOvertime"),
          }}
        />
      ) : null}
    </div>
  );

  if (platform === "no-runner") {
    return (
      <div className="dj-dojo-item" data-type="ladder" data-platform="no-runner">
        <LevelStepper levels={steps} />
        <NeedsRunnerNotice />
      </div>
    );
  }

  const tabs: FileTab[] = [
    ...answer.files.map((file) => ({ value: file.path, label: file.path, file, editable: true })),
    ...(reveal ? item.levels.at(-1)!.solution.map((file) => ({ value: `solution:${file.path}`, label: t("solutionTab", { path: file.path }), file, editable: false })) : []),
  ];

  return (
    <div className="dj-dojo-item dj-dojo-ladder" data-type="ladder">
      {header}
      {earlier.length ? (
        <details className="dj-dojo-details">
          <summary className="dj-type-label">{t("earlierLevels", { count: earlier.length })}</summary>
          <div className="dj-dojo-ladder__earlier">
            {earlier.map((entry, index) => (
              <div key={entry.id} className="dj-dojo-callout">
                <span className="dj-type-caption dj-dojo-callout__label">{t("levelHeading", { number: index + 1, title: pickL10n(entry.title, locale as never) })}</span>
                <Markdown>{pickL10n(entry.prompt, locale as never)}</Markdown>
              </div>
            ))}
          </div>
        </details>
      ) : null}
      {!done ? (
        <div className="dj-dojo-callout" data-tone="question">
          <span className="dj-type-caption dj-dojo-callout__label">{t("levelHeading", { number: answer.current + 1, title: pickL10n(level.title, locale as never) })}</span>
          <Markdown>{pickL10n(level.prompt, locale as never)}</Markdown>
          {onSkipLevel && !locked ? (
            <div className="dj-dojo-ladder__skip">
              <Button variant="ghost" size="sm" onClick={onSkipLevel}>
                <SkipForward aria-hidden="true" />
                {answer.current === item.levels.length - 1 ? t("skipLast") : t("skipLevel")}
              </Button>
            </div>
          ) : null}
        </div>
      ) : null}
      <div className="dj-dojo-implement">
        <div className="dj-dojo-implement__editor">
          <DojoFileTabs
            tabs={tabs}
            locked={locked || done}
            result={result}
            ariaLabel={t("filesLabel")}
            onEdit={(path, content) => onAnswerChange({ ...answer, files: editFile(answer.files, path, content) })}
          />
        </div>
        <div className="dj-dojo-implement__results">
          <RuntimeStatus status={running ? { state: "running" } : sandbox} onRetry={onRetrySandbox} />
          <TestResultList title={t("levelTests", { number: Math.min(answer.current, item.levels.length - 1) + 1 })} result={result} running={running} testTitles={titles} />
        </div>
      </div>
    </div>
  );
}
