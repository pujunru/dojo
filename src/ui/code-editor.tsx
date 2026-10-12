"use client";

import { lazy, Suspense, useState, type CSSProperties, type ReactNode } from "react";
import { cn } from "../lib/utils";

/** A diagnostic attached to a 1-based line, e.g. from a test traceback. */
export type CodeEditorDiagnostic = {
  line: number;
  message: string;
  severity?: "error" | "warning";
};

/**
 * A fill-in-the-blank region, as document offsets into `value`. The editor maps
 * the ranges through edits, so typing inside a blank keeps it highlighted.
 * Use `findBlankMarkers` to derive ranges from `__BLANK:id__` placeholders.
 */
export type CodeEditorBlank = {
  id: string;
  from: number;
  to: number;
};

export type CodeEditorLineSelection = {
  /** `single` behaves like a radio group of lines, `multiple` like checkboxes. */
  mode: "single" | "multiple";
  /** Selected 1-based line numbers. */
  selected: readonly number[];
  onChange: (lines: number[]) => void;
  /** Announced when a line is toggled, e.g. "Line 4 selected". Translated by the caller. */
  describeChange: (line: number, selected: boolean) => string;
  /** Screen-reader instructions for the line picker. Translated by the caller. */
  instructions: string;
};

/** How the editor reads its text: Python is highlighted, Markdown gets heading/emphasis styling, plain is untouched. */
export type CodeEditorLanguage = "python" | "markdown" | "plain";

/** The display language for a file path, by extension: `.md` Markdown, `.py` (and no extension) Python, anything else plain. */
export function codeLanguageForPath(path: string): CodeEditorLanguage {
  const ext = /\.([a-z0-9]+)$/i.exec(path)?.[1]?.toLowerCase();
  if (!ext || ext === "py" || ext === "pyi") return "python";
  if (ext === "md" || ext === "markdown") return "markdown";
  return "plain";
}

export type CodeEditorProps = {
  value: string;
  /** Defaults to Python. Use `codeLanguageForPath` to pick it from a file name. */
  language?: CodeEditorLanguage;
  onChange?: (value: string) => void;
  /** Accessible name of the editor. Translated by the caller. */
  ariaLabel: string;
  /** Shown to assistive tech while the editor bundle loads. */
  loadingLabel: string;
  readOnly?: boolean;
  disabled?: boolean;
  /** Force the skeleton (e.g. while the caller is still fetching the code). */
  loading?: boolean;
  /** Turns the editor into a read-only line picker (spot-the-bug, review). */
  lineSelection?: CodeEditorLineSelection;
  diagnostics?: readonly CodeEditorDiagnostic[];
  blanks?: readonly CodeEditorBlank[];
  onBlanksChange?: (blanks: CodeEditorBlank[]) => void;
  lineNumbers?: boolean;
  minHeight?: string;
  maxHeight?: string;
  /** Optional caller-owned status row under the code (e.g. keyboard hint). */
  footer?: ReactNode;
  className?: string;
  id?: string;
};

const BLANK_MARKER = /(?:#\s*)?__BLANK:([A-Za-z0-9_-]+)__/g;

/** Finds `__BLANK:id__` placeholders (optionally written as a `# __BLANK:id__` comment). */
export function findBlankMarkers(value: string): CodeEditorBlank[] {
  const blanks: CodeEditorBlank[] = [];
  for (const match of value.matchAll(BLANK_MARKER)) {
    const from = match.index ?? 0;
    blanks.push({ id: match[1]!, from, to: from + match[0].length });
  }
  return blanks;
}

type EditorFrameStyle = CSSProperties & {
  "--dj-code-editor-min-height"?: string;
  "--dj-code-editor-max-height"?: string;
};

export function CodeEditorSkeleton({ lines = 6 }: { lines?: number }) {
  const widths = ["62%", "48%", "80%", "36%", "70%", "54%", "44%", "66%"];
  return (
    <div className="dj-code-editor__skeleton" aria-hidden="true">
      {Array.from({ length: lines }, (_, index) => (
        <span key={index} className="dj-code-editor__skeleton-line" style={{ width: widths[index % widths.length] }} />
      ))}
    </div>
  );
}

// The CodeMirror bundle loads on first use, so pages without code stay light.
const CodeEditorClient = lazy(() => import("./code-editor-client").then((module) => ({ default: module.CodeEditorClient })));

/**
 * Code editor (CodeMirror 6), Python by default. The CodeMirror bundle is
 * code-split and loads on first use. Code is always rendered LTR, even inside an RTL container.
 */
export function CodeEditor({ loading = false, loadingLabel, minHeight, maxHeight, className, footer, id, disabled, ...props }: CodeEditorProps) {
  const [ready, setReady] = useState(false);
  const style: EditorFrameStyle = {
    "--dj-code-editor-min-height": minHeight,
    "--dj-code-editor-max-height": maxHeight,
  };
  const busy = loading || !ready;

  return (
    <div
      id={id}
      className={cn("dj-code-editor", className)}
      style={style}
      data-disabled={disabled ? "true" : undefined}
      aria-busy={busy}
    >
      {busy ? <span className="dj-practice-sr-only" role="status">{loadingLabel}</span> : null}
      {loading ? (
        <CodeEditorSkeleton />
      ) : (
        <Suspense fallback={<CodeEditorSkeleton />}>
          <CodeEditorClient {...props} disabled={disabled} onReady={() => setReady(true)} />
        </Suspense>
      )}
      {footer ? <div className="dj-code-editor__status dj-type-caption">{footer}</div> : null}
    </div>
  );
}
