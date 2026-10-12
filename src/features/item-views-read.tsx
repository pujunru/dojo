"use client";

import * as React from "react";
import { useLocale, useTranslations } from "use-intl";
import { ChoiceCardGroup } from "../ui/choice-card-group";
import { CodeEditor, codeLanguageForPath, type CodeEditorBlank, type CodeEditorDiagnostic } from "../ui/code-editor";
import { Input } from "../ui/input";
import { ReorderList, type ReorderItem, type ReorderReveal, type ReorderValue } from "../ui/reorder-list";
import { Textarea } from "../ui/textarea";
import {
  pickL10n,
  type ChooseDesignItem,
  type FillBlankItem,
  type ParsonsItem,
  type PredictItem,
  type SpotBugItem,
} from "../core/content-schema";
import { normalizeBlank, normalizeOutput } from "../core/grading";
import { Markdown } from "../ui/markdown";
import { AnswerCompare, DojoCodeFile, InlineMarkdown, OutputText, VerdictMark } from "./item-parts";
import type { DojoItemViewBaseProps, PyFile } from "./types";

/* ───────────────────────── Predict ───────────────────────── */

/** Same shape as `scorePredict`'s `answer`. */
export type PredictAnswer = { stdout?: string; choice?: number; excType?: string };
export type PredictItemViewProps = DojoItemViewBaseProps<PredictItem, PredictAnswer>;

export const emptyPredictAnswer = (): PredictAnswer => ({});

export function isPredictAnswerComplete(item: PredictItem, answer: PredictAnswer) {
  if (item.answer.mode === "stdout") return typeof answer.stdout === "string" && answer.stdout.trim().length > 0;
  if (item.answer.mode === "choice") return typeof answer.choice === "number";
  return typeof answer.excType === "string" && answer.excType.trim().length > 0;
}

/** Read the code, predict stdout / pick the output / name the exception. */
export function PredictItemView({ item, answer, onAnswerChange, reveal, disabled = false }: PredictItemViewProps) {
  const t = useTranslations("dojo.items.predict");
  const locale = useLocale();
  const locked = disabled || Boolean(reveal);
  const files = [...item.files].sort((a, b) => (a.path === item.entry ? -1 : b.path === item.entry ? 1 : 0));
  const id = React.useId();

  let answerSurface: React.ReactNode;
  if (item.answer.mode === "choice") {
    const expected = item.answer;
    answerSurface = (
      <ChoiceCardGroup
        mode="single"
        legend={t("choiceLegend")}
        showLegend
        options={expected.options.map((option, index) => ({ value: String(index), label: t("optionLabel", { letter: String.fromCharCode(65 + index) }), code: option }))}
        value={typeof answer.choice === "number" ? [String(answer.choice)] : []}
        onChange={(value) => onAnswerChange({ ...answer, choice: Number(value[0]) })}
        disabled={disabled}
        reveal={reveal ? { correct: [String(expected.correct)] } : undefined}
        revealLabels={{ correct: t("reveal.correct"), incorrect: t("reveal.incorrect"), missed: t("reveal.missed") }}
        columns={expected.options.every((option) => option.length < 40) ? 2 : 1}
      />
    );
  } else if (item.answer.mode === "stdout") {
    const expected = item.answer.stdout;
    const correct = normalizeOutput(answer.stdout ?? "") === normalizeOutput(expected);
    answerSurface = reveal ? (
      <AnswerCompare correct={correct} yours={<OutputText text={answer.stdout ?? ""} empty={t("noAnswer")} />} expected={<OutputText text={expected} />} />
    ) : (
      <div className="dj-dojo-field">
        <label className="dj-type-label" htmlFor={`${id}-stdout`}>{t("outputLabel")}</label>
        <Textarea
          id={`${id}-stdout`}
          className="dj-dojo-mono-input"
          value={answer.stdout ?? ""}
          onChange={(event) => onAnswerChange({ ...answer, stdout: event.target.value })}
          placeholder={t("outputPlaceholder")}
          disabled={locked}
          spellCheck={false}
          autoCapitalize="off"
          autoCorrect="off"
          rows={4}
        />
        <span className="dj-type-caption dj-dojo-muted">{t("outputHint")}</span>
      </div>
    );
  } else {
    const expected = item.answer.excType;
    const correct = (answer.excType ?? "").trim() === expected.trim();
    answerSurface = reveal ? (
      <AnswerCompare correct={correct} yours={<OutputText text={answer.excType ?? ""} empty={t("noAnswer")} />} expected={<OutputText text={expected} />} />
    ) : (
      <div className="dj-dojo-field">
        <label className="dj-type-label" htmlFor={`${id}-exc`}>{t("exceptionLabel")}</label>
        <Input
          id={`${id}-exc`}
          className="dj-dojo-mono-input"
          value={answer.excType ?? ""}
          onChange={(event) => onAnswerChange({ ...answer, excType: event.target.value })}
          placeholder={t("exceptionPlaceholder")}
          disabled={locked}
          spellCheck={false}
          autoCapitalize="off"
          autoCorrect="off"
        />
      </div>
    );
  }

  return (
    <div className="dj-dojo-item" data-type="predict">
      <div className="dj-dojo-item__code">
        {files.map((file) => <DojoCodeFile key={file.path} file={file} />)}
      </div>
      {item.schedule ? (
        <div className="dj-dojo-callout">
          <span className="dj-type-caption dj-dojo-callout__label">{t("schedule")}</span>
          <Markdown>{pickL10n(item.schedule, locale)}</Markdown>
        </div>
      ) : null}
      {answerSurface}
    </div>
  );
}

/* ───────────────────────── Spot the bug ───────────────────────── */

export type SpotBugAnswer = { selected: { path: string; line: number }[] };
export type SpotBugItemViewProps = DojoItemViewBaseProps<SpotBugItem, SpotBugAnswer>;

export const emptySpotBugAnswer = (): SpotBugAnswer => ({ selected: [] });
export const isSpotBugAnswerComplete = (answer: SpotBugAnswer) => answer.selected.length > 0;

/** Per-line reveal for spot-bug, using the grader's tolerance rule. */
export function spotBugReveal(item: Pick<SpotBugItem, "bugs" | "tolerance">, answer: SpotBugAnswer) {
  const tol = Math.max(0, item.tolerance);
  const near = (path: string, line: number, bug: SpotBugItem["bugs"][number]) =>
    bug.path === path && bug.lines.some((bugLine) => Math.abs(bugLine - line) <= tol);
  const found = item.bugs.map((bug) => ({ bug, found: answer.selected.some((sel) => near(sel.path, sel.line, bug)) }));
  const falsePositives = answer.selected.filter((sel) => !item.bugs.some((bug) => near(sel.path, sel.line, bug)));
  return { found, falsePositives };
}

/** Pick the faulty line(s) in read-only code; reveal marks found, missed and wrong picks. */
export function SpotBugItemView({ item, answer, onAnswerChange, reveal, disabled = false }: SpotBugItemViewProps) {
  const t = useTranslations("dojo.items.spotBug");
  const result = reveal ? spotBugReveal(item, answer) : null;

  const diagnosticsFor = (path: string): CodeEditorDiagnostic[] => {
    if (!result) return [];
    const list: CodeEditorDiagnostic[] = [];
    for (const { bug, found } of result.found) {
      if (bug.path !== path) continue;
      for (const line of bug.lines) list.push({ line, message: found ? t("diagnosticFound") : t("diagnosticMissed"), severity: found ? "warning" : "error" });
    }
    for (const sel of result.falsePositives) if (sel.path === path) list.push({ line: sel.line, message: t("diagnosticFalse"), severity: "warning" });
    return list;
  };

  const foundCount = result ? result.found.filter((entry) => entry.found).length : 0;

  return (
    <div className="dj-dojo-item" data-type="spot-bug">
      <p className="dj-type-body-sm dj-dojo-muted">{t("instructions")}</p>
      <div className="dj-dojo-item__code">
        {item.files.map((file) => {
          const selected = answer.selected.filter((sel) => sel.path === file.path).map((sel) => sel.line);
          return (
            <DojoCodeFile
              key={file.path}
              file={file}
              maxHeight="none"
              diagnostics={diagnosticsFor(file.path)}
              lineSelection={{
                mode: "multiple",
                selected,
                onChange: (lines) => {
                  if (disabled || reveal) return;
                  const others = answer.selected.filter((sel) => sel.path !== file.path);
                  onAnswerChange({ selected: [...others, ...lines.map((line) => ({ path: file.path, line }))] });
                },
                describeChange: (line, isSelected) => (isSelected ? t("lineSelected", { line }) : t("lineCleared", { line })),
                instructions: t("keyboard"),
              }}
            />
          );
        })}
      </div>
      {result ? (
        <ul className="dj-dojo-reveal-list" aria-label={t("revealTitle")}>
          {result.found.map(({ bug, found }, index) => (
            <li key={`${bug.path}-${index}`}>
              <VerdictMark tone={found ? "correct" : "incorrect"}>{found ? t("found") : t("missed")}</VerdictMark>
              <span className="dj-type-body-sm" translate="no">{t("bugAt", { path: bug.path, lines: bug.lines.join(", ") })}</span>
            </li>
          ))}
          {result.falsePositives.map((sel) => (
            <li key={`fp-${sel.path}-${sel.line}`}>
              <VerdictMark tone="partial">{t("falsePositive")}</VerdictMark>
              <span className="dj-type-body-sm" translate="no">{t("lineAt", { path: sel.path, line: sel.line })}</span>
            </li>
          ))}
          <li className="dj-dojo-reveal-list__summary dj-type-caption">{t("foundSummary", { found: foundCount, total: item.bugs.length })}</li>
        </ul>
      ) : (
        <p className="dj-type-caption dj-dojo-muted" aria-live="polite">{t("selectedSummary", { count: answer.selected.length })}</p>
      )}
    </div>
  );
}

/* ───────────────────────── Fill in the blank ───────────────────────── */

export type FillBlankFileAnswer = { path: string; code: string; blanks: CodeEditorBlank[] };
export type FillBlankAnswer = { files: FillBlankFileAnswer[] };
export type FillBlankItemViewProps = DojoItemViewBaseProps<FillBlankItem, FillBlankAnswer>;

const TEMPLATE_BLANK = /#\s*__BLANK:([a-z0-9_-]+)__/g;

/** Strips `# __BLANK:id__` markers so every blank starts empty, recording its range. */
export function emptyFillBlankAnswer(item: Pick<FillBlankItem, "template">): FillBlankAnswer {
  return {
    files: item.template.map((file) => {
      const blanks: CodeEditorBlank[] = [];
      let code = "";
      let last = 0;
      for (const match of file.content.matchAll(TEMPLATE_BLANK)) {
        const index = match.index ?? 0;
        code += file.content.slice(last, index);
        blanks.push({ id: match[1]!, from: code.length, to: code.length });
        last = index + match[0].length;
      }
      code += file.content.slice(last);
      return { path: file.path, code, blanks };
    }),
  };
}

/** Blank id → typed text: the `answers` input of `scoreFillBlank`. */
export function fillBlankValues(answer: FillBlankAnswer): Record<string, string> {
  const values: Record<string, string> = {};
  for (const file of answer.files) for (const blank of file.blanks) values[blank.id] = file.code.slice(blank.from, blank.to);
  return values;
}

/** Files with blanks filled in, for the optional test run. */
export const fillBlankFiles = (answer: FillBlankAnswer): PyFile[] => answer.files.map((file) => ({ path: file.path, content: file.code }));

export function isFillBlankAnswerComplete(answer: FillBlankAnswer) {
  return Object.values(fillBlankValues(answer)).every((value) => value.trim().length > 0) && answer.files.some((file) => file.blanks.length > 0);
}

/** Type into the highlighted blanks; reveal shows each blank against the accepted answer. */
export function FillBlankItemView({ item, answer, onAnswerChange, reveal, disabled = false }: FillBlankItemViewProps) {
  const t = useTranslations("dojo.items.fillBlank");
  const tEditor = useTranslations("dojo.editor");
  const locked = disabled || Boolean(reveal);
  const values = fillBlankValues(answer);
  const filled = Object.values(values).filter((value) => value.trim()).length;

  // The editor reports the new text and the remapped blanks in the same tick;
  // merging each into the latest answer (not the render's) keeps both.
  const latest = React.useRef(answer);
  latest.current = answer;
  const update = (path: string, patch: Partial<FillBlankFileAnswer>) => {
    const next = { files: latest.current.files.map((file) => (file.path === path ? { ...file, ...patch } : file)) };
    latest.current = next;
    onAnswerChange(next);
  };

  return (
    <div className="dj-dojo-item" data-type="fill-blank">
      <div className="dj-dojo-item__code">
        {answer.files.map((file) => (
          <figure key={file.path} className="dj-dojo-code">
            <figcaption className="dj-dojo-code__path dj-type-caption" translate="no">{file.path}</figcaption>
            <CodeEditor
              value={file.code}
              language={codeLanguageForPath(file.path)}
              onChange={locked ? undefined : (code) => update(file.path, { code })}
              blanks={file.blanks}
              onBlanksChange={locked ? undefined : (blanks) => update(file.path, { blanks })}
              readOnly={locked}
              ariaLabel={t("editorLabel", { path: file.path })}
              loadingLabel={tEditor("loading")}
              minHeight="0"
              footer={locked ? undefined : <span>{tEditor("keyboardHint")}</span>}
            />
          </figure>
        ))}
      </div>
      {reveal ? (
        <ul className="dj-dojo-reveal-list" aria-label={t("revealTitle")}>
          {item.blanks.map((blank) => {
            const given = values[blank.id] ?? "";
            const ok = blank.accept.some((accepted) => normalizeBlank(accepted) === normalizeBlank(given));
            return (
              <li key={blank.id} className="dj-dojo-blank-result">
                <VerdictMark tone={ok ? "correct" : "incorrect"}>{t("blankName", { id: blank.id })}</VerdictMark>
                <code className="dj-dojo-blank-result__given" data-ok={ok ? "true" : "false"} translate="no">{given.trim() || t("empty")}</code>
                {!ok ? (
                  <span className="dj-dojo-blank-result__accepted">
                    <span className="dj-type-caption dj-dojo-muted">{t("accepted")}</span>
                    <code translate="no">{blank.accept[0]}</code>
                  </span>
                ) : null}
              </li>
            );
          })}
        </ul>
      ) : (
        <p className="dj-type-caption dj-dojo-muted" aria-live="polite">{t("progress", { filled, total: item.blanks.length })}</p>
      )}
    </div>
  );
}

/* ───────────────────────── Parsons ───────────────────────── */

export type ParsonsAnswer = ReorderValue;
export type ParsonsItemViewProps = DojoItemViewBaseProps<ParsonsItem, ParsonsAnswer>;

/** All lines plus distractors in the pool, deterministically shuffled by `seed`. */
export function emptyParsonsAnswer(item: Pick<ParsonsItem, "lines" | "distractors" | "requireIndent">, seed = 1): ParsonsAnswer {
  const pool: ReorderItem[] = [
    ...item.lines.map((line) => ({ id: line.id, code: line.code.trim(), indent: item.requireIndent ? 0 : line.indent })),
    ...item.distractors.map((line) => ({ id: line.id, code: line.code.trim(), indent: 0 })),
  ];
  let state = seed >>> 0 || 1;
  for (let i = pool.length - 1; i > 0; i -= 1) {
    state = (state * 1664525 + 1013904223) >>> 0;
    const j = state % (i + 1);
    [pool[i], pool[j]] = [pool[j]!, pool[i]!];
  }
  return { items: [], pool };
}

/** The `order` input of `scoreParsons`. */
export const parsonsOrder = (answer: ParsonsAnswer) => answer.items.map((item) => item.id);
export const isParsonsAnswerComplete = (answer: ParsonsAnswer) => answer.items.length > 0;

/** Per-line reveal against the accepted solution sharing the longest prefix-aligned overlap. */
export type ParsonsLineNote =
  | { kind: "indent"; expected: number; actual: number }
  | { kind: "distractor"; correct?: string }
  | { kind: "position" };

export function parsonsReveal(
  item: Pick<ParsonsItem, "solutions" | "lines" | "requireIndent"> & { distractors?: ParsonsItem["distractors"] },
  answer: ParsonsAnswer,
): { reveal: ReorderReveal; solution: string[]; notes: Record<string, ParsonsLineNote> } {
  const indentOf = new Map(item.lines.map((line) => [line.id, line.indent]));
  let best = item.solutions[0] ?? [];
  let bestScore = -1;
  for (const solution of item.solutions) {
    const score = answer.items.filter((entry, index) => solution[index] === entry.id).length;
    if (score > bestScore) {
      best = solution;
      bestScore = score;
    }
  }
  const reveal: ReorderReveal = {};
  const notes: Record<string, ParsonsLineNote> = {};
  const codeOf = new Map(item.lines.map((line) => [line.id, line.code.trim()]));
  const distractorOf = new Map((item.distractors ?? []).map((d) => [d.id, d]));
  answer.items.forEach((entry, index) => {
    const distractor = distractorOf.get(entry.id);
    if (distractor) {
      reveal[entry.id] = "incorrect";
      notes[entry.id] = { kind: "distractor", correct: distractor.replaces ? codeOf.get(distractor.replaces) : undefined };
      return;
    }
    const expected = indentOf.get(entry.id) ?? 0;
    const actual = entry.indent ?? 0;
    if (best[index] !== entry.id) {
      reveal[entry.id] = "incorrect";
      notes[entry.id] = { kind: "position" };
    } else if (item.requireIndent && actual !== expected) {
      reveal[entry.id] = "indent";
      notes[entry.id] = { kind: "indent", expected, actual };
    } else {
      reveal[entry.id] = "correct";
    }
  });
  return { reveal, solution: best, notes };
}

/** Assemble the program from shuffled lines (with indentation when required). */
export function ParsonsItemView({ item, answer, onAnswerChange, reveal, disabled = false }: ParsonsItemViewProps) {
  const t = useTranslations("dojo.items.parsons");
  const result = reveal ? parsonsReveal(item, answer) : null;
  const noteTexts = (notes: Record<string, ParsonsLineNote>) =>
    Object.fromEntries(Object.entries(notes).map(([id, note]) => [
      id,
      note.kind === "indent"
        ? t("noteIndent", { expected: note.expected, actual: note.actual, spaces: note.expected * 4 })
        : note.kind === "distractor"
          ? note.correct ? t.rich("noteDistractor", { code: (chunks) => <code>{chunks}</code>, correct: note.correct }) : t("noteDistractorGeneric")
          : t("notePosition"),
    ]));
  const byId = new Map(item.lines.map((line) => [line.id, line]));
  const solutionCode = result
    ? result.solution.map((id) => {
        const line = byId.get(id);
        return line ? `${"    ".repeat(line.indent)}${line.code.trim()}` : "";
      }).join("\n")
    : "";

  return (
    <div className="dj-dojo-item" data-type="parsons">
      <ReorderList
        value={answer}
        onChange={(value) => { if (!reveal && !disabled) onAnswerChange(value); }}
        maxIndent={item.requireIndent ? 4 : 0}
        indentWidth={4}
        showPool
        reveal={result?.reveal}
        revealNotes={result ? noteTexts(result.notes) : undefined}
        disabled={disabled || Boolean(reveal)}
        labels={{
          answerRegion: t("answerRegion"),
          poolRegion: t("poolRegion"),
          instructions: item.requireIndent ? t("instructionsIndent") : t("instructions"),
          emptyAnswer: t("emptyAnswer"),
          emptyPool: t("emptyPool"),
          itemName: (entry, position, total) => t("itemName", { position, total, indent: entry.indent ?? 0, code: entry.code.trim() }),
          moved: (entry, position, total) => t("moved", { position, total, code: entry.code.trim() }),
          indented: (entry, level) => t("indented", { level, code: entry.code.trim() }),
          movedToPool: (entry) => t("movedToPool", { code: entry.code.trim() }),
          movedToAnswer: (entry, position, total) => t("movedToAnswer", { position, total, code: entry.code.trim() }),
          indentIncrease: t("indentIncrease"),
          indentDecrease: t("indentDecrease"),
          moveToPool: t("moveToPool"),
          moveToAnswer: t("moveToAnswer"),
          revealCorrect: t("revealCorrect"),
          revealIncorrect: t("revealIncorrect"),
          revealIndent: t("revealIndent"),
        }}
      />
      {item.requireIndent && !reveal ? <p className="dj-type-caption dj-dojo-parsons-indent-hint">{t("indentHint")}</p> : null}
      {reveal && reveal.verdict !== "correct" && solutionCode ? (
        <div className="dj-dojo-solution">
          <span className="dj-type-caption dj-dojo-callout__label">{t("solution")}</span>
          <DojoCodeFile file={{ path: item.module ?? "solution.py", content: solutionCode }} />
        </div>
      ) : null}
    </div>
  );
}

/* ───────────────────────── Choose design ───────────────────────── */

export type ChooseDesignAnswer = { selected: string[]; rationale: string };
export type ChooseDesignItemViewProps = DojoItemViewBaseProps<ChooseDesignItem, ChooseDesignAnswer> & {
  /** Verdicts on the written rationale (`RubricJudgement`) once the choice is checked. */
  judgement?: React.ReactNode;
};

export const emptyChooseDesignAnswer = (): ChooseDesignAnswer => ({ selected: [], rationale: "" });
export const isChooseDesignAnswerComplete = (answer: ChooseDesignAnswer) => answer.selected.length > 0;

/** Scenario + design options (single or multi), optional written rationale; reveal shows why per option. */
export function ChooseDesignItemView({ item, answer, onAnswerChange, reveal, disabled = false, judgement }: ChooseDesignItemViewProps) {
  const t = useTranslations("dojo.items.chooseDesign");
  const locale = useLocale();
  const id = React.useId();
  const locked = disabled || Boolean(reveal);

  return (
    <div className="dj-dojo-item" data-type="choose-design">
      <div className="dj-dojo-callout">
        <span className="dj-type-caption dj-dojo-callout__label">{t("scenario")}</span>
        <Markdown>{pickL10n(item.scenario, locale)}</Markdown>
      </div>
      <ChoiceCardGroup
        mode={item.multi ? "multiple" : "single"}
        legend={item.multi ? t("legendMulti") : t("legendSingle")}
        showLegend
        options={item.options.map((option) => ({ value: option.id, label: <InlineMarkdown>{pickL10n(option.text, locale)}</InlineMarkdown> }))}
        value={answer.selected}
        onChange={(selected) => onAnswerChange({ ...answer, selected })}
        disabled={disabled}
        reveal={reveal ? {
          correct: item.options.filter((option) => option.correct).map((option) => option.id),
          explanations: Object.fromEntries(item.options.map((option) => [option.id, <InlineMarkdown key={option.id}>{pickL10n(option.why, locale)}</InlineMarkdown>])),
        } : undefined}
        revealLabels={{ correct: t("reveal.correct"), incorrect: t("reveal.incorrect"), missed: t("reveal.missed") }}
      />
      {item.rationale ? (
        <div className="dj-dojo-field">
          <label className="dj-type-label" htmlFor={`${id}-why`}>{t("rationaleLabel")}</label>
          <Textarea
            id={`${id}-why`}
            value={answer.rationale}
            onChange={(event) => onAnswerChange({ ...answer, rationale: event.target.value })}
            placeholder={t("rationalePlaceholder")}
            disabled={locked || Boolean(judgement)}
            rows={3}
          />
        </div>
      ) : null}
      {judgement ?? null}
    </div>
  );
}
