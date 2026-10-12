"use client";

import * as React from "react";
import { CheckCircle2, CircleDashed, CodeXml, XCircle } from "lucide-react";
import { useTranslations } from "use-intl";
import ReactMarkdown from "react-markdown";
import { CodeEditor, codeLanguageForPath, type CodeEditorDiagnostic, type CodeEditorLineSelection } from "../ui/code-editor";
import { cn } from "../lib/utils";
import type { PyFile } from "./types";

/** One read-only (or line-pickable) source file with its path as caption. */
export function DojoCodeFile({
  file,
  lineSelection,
  diagnostics,
  maxHeight = "26rem",
  className,
}: {
  file: PyFile;
  lineSelection?: CodeEditorLineSelection;
  diagnostics?: readonly CodeEditorDiagnostic[];
  maxHeight?: string;
  className?: string;
}) {
  const t = useTranslations("dojo.editor");
  return (
    <figure className={cn("dj-dojo-code", className)}>
      <figcaption className="dj-dojo-code__path dj-type-caption" translate="no">{file.path}</figcaption>
      <CodeEditor
        value={file.content}
        language={codeLanguageForPath(file.path)}
        readOnly
        lineSelection={lineSelection}
        diagnostics={diagnostics}
        ariaLabel={t("readOnlyLabel", { path: file.path })}
        loadingLabel={t("loading")}
        minHeight="0"
        maxHeight={maxHeight}
      />
    </figure>
  );
}

/** Clear "can't run here" state for items whose answer must run in a code runner this build lacks. */
export function NeedsRunnerNotice({ className }: { className?: string }) {
  const t = useTranslations("dojo.needsRunner");
  return (
    <div className={cn("dj-dojo-needs-runner", className)} role="note">
      <span className="dj-practice-milestone-tile" data-tone="blue" aria-hidden="true"><CodeXml /></span>
      <div className="dj-dojo-needs-runner__text">
        <span className="dj-type-label">{t("title")}</span>
        <span className="dj-type-body-sm dj-dojo-muted">{t("body")}</span>
      </div>
    </div>
  );
}

export type MarkTone = "correct" | "partial" | "incorrect";
const MARK_ICON = { correct: CheckCircle2, partial: CircleDashed, incorrect: XCircle } as const;

/** Inline verdict mark: icon + text, colored by the feedback channel. */
export function VerdictMark({ tone, children, className }: { tone: MarkTone; children: React.ReactNode; className?: string }) {
  const Icon = MARK_ICON[tone];
  return (
    <span className={cn("dj-dojo-mark dj-type-caption", className)} data-tone={tone}>
      <Icon aria-hidden="true" />
      {children}
    </span>
  );
}

/** Two answers compared side by side after a reveal (predict output, fill-blank). */
export function AnswerCompare({
  yours,
  expected,
  correct,
}: {
  yours: React.ReactNode;
  expected: React.ReactNode;
  correct: boolean;
}) {
  const t = useTranslations("dojo.items");
  return (
    <div className="dj-dojo-compare" data-correct={correct ? "true" : "false"}>
      <div className="dj-dojo-compare__cell" data-role="yours">
        <span className="dj-dojo-compare__label">
          <span className="dj-type-caption">{t("yourAnswer")}</span>
          <VerdictMark tone={correct ? "correct" : "incorrect"}>{correct ? t("matches") : t("differs")}</VerdictMark>
        </span>
        {yours}
      </div>
      {!correct ? (
        <div className="dj-dojo-compare__cell" data-role="expected">
          <span className="dj-dojo-compare__label"><span className="dj-type-caption">{t("expected")}</span></span>
          {expected}
        </div>
      ) : null}
    </div>
  );
}

/** Monospace, whitespace-preserving output (data). */
export function OutputText({ text, empty }: { text: string; empty?: string }) {
  return text ? <pre className="dj-dojo-output__pre" translate="no">{text}</pre> : <span className="dj-type-body-sm dj-dojo-muted">{empty}</span>;
}

/**
 * Inline Markdown for short content strings (option labels, rubric criteria):
 * code spans, bold and italics only, never block elements.
 */
export function InlineMarkdown({ children }: { children: string }) {
  return (
    <ReactMarkdown
      allowedElements={["p", "code", "strong", "em"]}
      unwrapDisallowed
      skipHtml
      components={{
        p: ({ children: inner }) => <>{inner}</>,
        code: ({ children: inner }) => <code className="dj-dojo-inline-code" translate="no">{inner}</code>,
      }}
    >
      {children}
    </ReactMarkdown>
  );
}
