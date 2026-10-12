"use client";

import { Fragment, useEffect, useMemo, useRef, useState, type KeyboardEvent, type ReactNode } from "react";
import { AlertTriangle, Check, FileCode, MessageSquare, X } from "lucide-react";
import { cn } from "../lib/utils";

export type DiffLineKind = "add" | "del" | "context";

export type DiffLine = {
  kind: DiffLineKind;
  oldLine?: number;
  newLine?: number;
  content: string;
  /** Stable anchor for inline comments: `<path>#R<new>` or `<path>#L<old>` for deletions. */
  anchor: string;
};

export type DiffHunk = { header: string; lines: DiffLine[] };
export type DiffFile = { oldPath: string; newPath: string; hunks: DiffHunk[] };

function stripPrefix(path: string) {
  const trimmed = path.trim().split("\t")[0] ?? "";
  if (trimmed === "/dev/null") return "";
  return trimmed.replace(/^[ab]\//, "");
}

/** Parses a unified diff (git or plain `diff -u`) into files, hunks and anchored lines. */
export function parseUnifiedDiff(diff: string): DiffFile[] {
  const files: DiffFile[] = [];
  let file: DiffFile | null = null;
  let hunk: DiffHunk | null = null;
  let oldLine = 0;
  let newLine = 0;
  let oldRemaining = 0;
  let newRemaining = 0;

  const startFile = () => {
    file = { oldPath: "", newPath: "", hunks: [] };
    files.push(file);
    return file;
  };

  for (const raw of diff.replace(/\r\n/g, "\n").split("\n")) {
    const inHunk = hunk !== null && (oldRemaining > 0 || newRemaining > 0);
    if (inHunk) {
      const current = file as unknown as DiffFile;
      const path = current.newPath || current.oldPath;
      const marker = raw[0];
      const content = raw.slice(1);
      if (marker === "+") {
        hunk!.lines.push({ kind: "add", newLine, content, anchor: `${path}#R${newLine}` });
        newLine += 1;
        newRemaining -= 1;
      } else if (marker === "-") {
        hunk!.lines.push({ kind: "del", oldLine, content, anchor: `${current.oldPath || path}#L${oldLine}` });
        oldLine += 1;
        oldRemaining -= 1;
      } else if (marker === " " || raw === "") {
        hunk!.lines.push({ kind: "context", oldLine, newLine, content, anchor: `${path}#R${newLine}` });
        oldLine += 1;
        newLine += 1;
        oldRemaining -= 1;
        newRemaining -= 1;
      }
      // "\ No newline at end of file" and anything else is ignored.
      continue;
    }
    if (raw.startsWith("diff --git ")) {
      startFile();
      hunk = null;
    } else if (raw.startsWith("--- ")) {
      const current: DiffFile = file && !(file as DiffFile).hunks.length && !(file as DiffFile).oldPath ? file : startFile();
      current.oldPath = stripPrefix(raw.slice(4));
      hunk = null;
    } else if (raw.startsWith("+++ ")) {
      (file ?? startFile()).newPath = stripPrefix(raw.slice(4));
    } else {
      const header = /^@@ -(\d+)(?:,(\d+))? \+(\d+)(?:,(\d+))? @@/.exec(raw);
      if (header) {
        oldLine = Number(header[1]);
        oldRemaining = header[2] === undefined ? 1 : Number(header[2]);
        newLine = Number(header[3]);
        newRemaining = header[4] === undefined ? 1 : Number(header[4]);
        hunk = { header: raw, lines: [] };
        (file ?? startFile()).hunks.push(hunk);
      }
    }
  }
  return files;
}

export type DiffReveal = Record<string, "hit" | "missed" | "false-positive">;

export type DiffViewerLabels = {
  /** Accessible name for one line, e.g. "Added line 12: return total". */
  lineName: (line: DiffLine) => string;
  commented: string;
  hit: string;
  missed: string;
  falsePositive: string;
  empty: string;
};

export type DiffViewerProps = {
  diff: string | DiffFile[];
  labels: DiffViewerLabels;
  /** Accessible name for the whole diff. */
  ariaLabel: string;
  selectedAnchor?: string | null;
  onSelectLine?: (anchor: string, line: DiffLine) => void;
  commentedAnchors?: readonly string[];
  reveal?: DiffReveal;
  /** Inline content under a line (comment thread, composer), keyed by anchor. */
  renderLineAddon?: (anchor: string, line: DiffLine) => ReactNode;
  className?: string;
};

/**
 * Unified diff with line anchors for review exercises. Lines are keyboard
 * selectable (↑/↓/Home/End move, Enter/Space select); code scrolls horizontally
 * inside the viewer while line numbers stay pinned. Always rendered LTR.
 */
export function DiffViewer({ diff, labels, ariaLabel, selectedAnchor, onSelectLine, commentedAnchors = [], reveal, renderLineAddon, className }: DiffViewerProps) {
  const files = useMemo(() => (typeof diff === "string" ? parseUnifiedDiff(diff) : diff), [diff]);
  const flat = useMemo(() => files.flatMap((file) => file.hunks.flatMap((hunk) => hunk.lines)), [files]);
  const [focusAnchor, setFocusAnchor] = useState<string | null>(selectedAnchor ?? flat[0]?.anchor ?? null);
  const rowRefs = useRef(new Map<string, HTMLDivElement>());
  const rootRef = useRef<HTMLDivElement>(null);
  const selectable = Boolean(onSelectLine);

  // Inline addons stay within the visible width while the code scrolls.
  useEffect(() => {
    const root = rootRef.current;
    if (!root || typeof ResizeObserver === "undefined") return;
    const observer = new ResizeObserver(([entry]) => {
      root.style.setProperty("--dj-diff-viewport", `${entry!.contentRect.width}px`);
    });
    observer.observe(root);
    return () => observer.disconnect();
  }, []);

  const focusLine = (anchor: string) => {
    setFocusAnchor(anchor);
    rowRefs.current.get(anchor)?.focus();
  };

  const onKeyDown = (event: KeyboardEvent<HTMLDivElement>, index: number, line: DiffLine) => {
    let target = -1;
    if (event.key === "ArrowDown") target = Math.min(flat.length - 1, index + 1);
    else if (event.key === "ArrowUp") target = Math.max(0, index - 1);
    else if (event.key === "Home") target = 0;
    else if (event.key === "End") target = flat.length - 1;
    else if (event.key === "Enter" || event.key === " ") {
      event.preventDefault();
      onSelectLine?.(line.anchor, line);
      return;
    }
    if (target >= 0) {
      event.preventDefault();
      focusLine(flat[target]!.anchor);
    }
  };

  if (flat.length === 0) {
    return (
      <div className={cn("dj-diff", className)} aria-label={ariaLabel} role="region">
        <p className="dj-diff__empty dj-type-body-sm">{labels.empty}</p>
      </div>
    );
  }

  let flatIndex = -1;
  return (
    <div ref={rootRef} className={cn("dj-diff", className)} role="region" aria-label={ariaLabel}>
      {files.map((file, fileIndex) => (
        <section key={`${file.newPath}-${fileIndex}`} className="dj-diff__file" aria-label={file.newPath || file.oldPath}>
          {file.newPath || file.oldPath ? (
            <header className="dj-diff__file-header dj-type-data" dir="ltr">
              <FileCode aria-hidden="true" width={16} height={16} />
              <span>{file.oldPath && file.newPath && file.oldPath !== file.newPath ? `${file.oldPath} → ${file.newPath}` : file.newPath || file.oldPath}</span>
            </header>
          ) : null}
          <div className="dj-diff__scroll" dir="ltr">
            <ol className="dj-diff__lines">
              {file.hunks.map((hunk, hunkIndex) => (
                <Fragment key={hunkIndex}>
                  <li className="dj-diff__hunk" aria-hidden="true">{hunk.header}</li>
                  {hunk.lines.map((line) => {
                    flatIndex += 1;
                    const index = flatIndex;
                    const selected = selectedAnchor === line.anchor;
                    const commented = commentedAnchors.includes(line.anchor);
                    const verdict = reveal?.[line.anchor];
                    const addon = renderLineAddon?.(line.anchor, line);
                    const stateText = [commented ? labels.commented : "", verdict === "hit" ? labels.hit : verdict === "missed" ? labels.missed : verdict === "false-positive" ? labels.falsePositive : ""].filter(Boolean).join(", ");
                    return (
                      <li key={line.anchor + index} className="dj-diff__entry">
                        <div
                          ref={(element) => {
                            if (element) rowRefs.current.set(line.anchor, element);
                            else rowRefs.current.delete(line.anchor);
                          }}
                          className="dj-diff__line"
                          id={`diff-${line.anchor}`}
                          data-anchor={line.anchor}
                          data-kind={line.kind}
                          data-selectable={selectable ? "true" : undefined}
                          data-selected={selected ? "true" : undefined}
                          data-commented={commented ? "true" : undefined}
                          data-reveal={verdict}
                          role={selectable ? "button" : undefined}
                          aria-pressed={selectable ? selected : undefined}
                          aria-label={`${labels.lineName(line)}${stateText ? ` — ${stateText}` : ""}`}
                          tabIndex={selectable ? (focusAnchor === line.anchor ? 0 : -1) : undefined}
                          onFocus={() => setFocusAnchor(line.anchor)}
                          onClick={selectable ? () => onSelectLine?.(line.anchor, line) : undefined}
                          onKeyDown={selectable ? (event) => onKeyDown(event, index, line) : undefined}
                        >
                          <span className="dj-diff__num" data-side="old" aria-hidden="true">{line.oldLine ?? ""}</span>
                          <span className="dj-diff__num" data-side="new" aria-hidden="true">{line.newLine ?? ""}</span>
                          <span className="dj-diff__flag" aria-hidden="true">
                            {verdict === "hit" ? <Check /> : verdict === "missed" ? <AlertTriangle /> : verdict === "false-positive" ? <X /> : commented ? <MessageSquare /> : null}
                          </span>
                          <span className="dj-diff__sign" aria-hidden="true">{line.kind === "add" ? "+" : line.kind === "del" ? "−" : ""}</span>
                          <span className="dj-diff__code" aria-hidden="true">{line.content || " "}</span>
                        </div>
                        {addon ? <div className="dj-diff__addon">{addon}</div> : null}
                      </li>
                    );
                  })}
                </Fragment>
              ))}
            </ol>
          </div>
        </section>
      ))}
    </div>
  );
}
