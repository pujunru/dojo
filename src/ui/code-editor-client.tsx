"use client";

import { useEffect, useId, useRef, useState } from "react";
import { defaultKeymap, history, historyKeymap, indentWithTab } from "@codemirror/commands";
import { bracketMatching, HighlightStyle, indentOnInput, indentUnit, syntaxHighlighting } from "@codemirror/language";
import { Annotation, Compartment, EditorState, RangeSetBuilder, StateEffect, StateField, type Extension } from "@codemirror/state";
import {
  Decoration,
  type DecorationSet,
  drawSelection,
  EditorView,
  gutter,
  GutterMarker,
  highlightActiveLine,
  highlightActiveLineGutter,
  keymap,
  lineNumbers as lineNumbersExtension,
  ViewPlugin,
  type ViewUpdate,
  WidgetType,
} from "@codemirror/view";
import { tags } from "@lezer/highlight";
import type { CodeEditorBlank, CodeEditorDiagnostic, CodeEditorProps } from "./code-editor";

export type CodeEditorClientProps = Omit<CodeEditorProps, "loading" | "loadingLabel" | "minHeight" | "maxHeight" | "className" | "footer" | "id"> & {
  onReady?: () => void;
};

/* ---------- Theme: every color is a design token ---------- */

const dojoTheme = EditorView.theme({
  "&": { backgroundColor: "transparent", color: "var(--foreground)" },
  ".cm-content": { caretColor: "var(--foreground)", padding: "var(--space-2) 0" },
  ".cm-line": { padding: "0 var(--space-4) 0 var(--space-2)" },
  ".cm-cursor, .cm-dropCursor": { borderLeftColor: "var(--foreground)", borderLeftWidth: "2px" },
  "&.cm-focused .cm-selectionBackground, .cm-selectionBackground, .cm-content ::selection": {
    backgroundColor: "color-mix(in srgb, var(--stage-blue) 26%, transparent)",
  },
  ".cm-gutters": {
    backgroundColor: "var(--dj-practice-code-gutter)",
    color: "var(--muted-foreground)",
    borderRight: "1px solid var(--border)",
  },
  ".cm-lineNumbers .cm-gutterElement": { padding: "0 var(--space-2) 0 var(--space-3)", minWidth: "2.5rem" },
  ".cm-activeLine": { backgroundColor: "color-mix(in srgb, var(--foreground) 4%, transparent)" },
  ".cm-activeLineGutter": { backgroundColor: "color-mix(in srgb, var(--foreground) 7%, transparent)", color: "var(--foreground)" },
  ".cm-matchingBracket": { backgroundColor: "color-mix(in srgb, var(--stage-indigo) 22%, transparent)", outline: "1px solid var(--stage-indigo)" },
  ".cm-dj-marks .cm-gutterElement": { display: "flex", alignItems: "center", justifyContent: "center", width: "1.5rem" },
});

const dojoHighlight = HighlightStyle.define([
  { tag: [tags.keyword, tags.controlKeyword, tags.definitionKeyword, tags.moduleKeyword, tags.operatorKeyword], color: "var(--dj-practice-syntax-keyword)" },
  { tag: [tags.string, tags.special(tags.string)], color: "var(--dj-practice-syntax-string)" },
  { tag: [tags.number, tags.bool, tags.null], color: "var(--dj-practice-syntax-number)" },
  { tag: [tags.comment, tags.lineComment, tags.blockComment], color: "var(--dj-practice-syntax-comment)", fontStyle: "italic" },
  { tag: [tags.function(tags.variableName), tags.function(tags.definition(tags.variableName)), tags.function(tags.propertyName)], color: "var(--dj-practice-syntax-function)" },
  { tag: [tags.className, tags.typeName, tags.definition(tags.className)], color: "var(--dj-practice-syntax-type)" },
  { tag: [tags.operator, tags.punctuation], color: "var(--dj-practice-syntax-operator)" },
  { tag: tags.self, color: "var(--dj-practice-syntax-keyword)", fontStyle: "italic" },
  // Markdown files (.md): structure, not code colours.
  { tag: tags.heading, fontWeight: "600", color: "var(--foreground)" },
  { tag: tags.strong, fontWeight: "600" },
  { tag: tags.emphasis, fontStyle: "italic" },
  { tag: [tags.link, tags.url], color: "var(--dj-practice-syntax-function)" },
  { tag: tags.monospace, color: "var(--dj-practice-syntax-string)" },
  { tag: [tags.processingInstruction, tags.list, tags.quote], color: "var(--dj-practice-syntax-operator)" },
]);

/* ---------- State: selected lines, diagnostics, blanks ---------- */

const external = Annotation.define<boolean>();

const setSelectedLines = StateEffect.define<readonly number[] | null>();
const selectedLinesField = StateField.define<readonly number[] | null>({
  create: () => null,
  update(value, tr) {
    for (const effect of tr.effects) if (effect.is(setSelectedLines)) return effect.value;
    return value;
  },
});

const setDiagnostics = StateEffect.define<readonly CodeEditorDiagnostic[]>();

class DiagnosticWidget extends WidgetType {
  constructor(readonly message: string, readonly severity: "error" | "warning") {
    super();
  }
  eq(other: DiagnosticWidget) {
    return other.message === this.message && other.severity === this.severity;
  }
  toDOM() {
    const element = document.createElement("div");
    element.className = "cm-dj-diagnostic-message";
    element.dataset.severity = this.severity;
    element.textContent = this.message;
    return element;
  }
}

type DiagnosticsState = { list: readonly CodeEditorDiagnostic[]; decorations: DecorationSet };

function buildDiagnostics(state: EditorState, list: readonly CodeEditorDiagnostic[]): DecorationSet {
  const builder = new RangeSetBuilder<Decoration>();
  const sorted = [...list].filter((item) => item.line >= 1 && item.line <= state.doc.lines).sort((a, b) => a.line - b.line);
  for (const item of sorted) {
    const line = state.doc.line(item.line);
    const severity = item.severity ?? "error";
    builder.add(line.from, line.from, Decoration.line({ class: severity === "error" ? "cm-dj-line-error" : "cm-dj-line-warning" }));
    builder.add(line.to, line.to, Decoration.widget({ widget: new DiagnosticWidget(item.message, severity), block: true, side: 1 }));
  }
  return builder.finish();
}

const diagnosticsField = StateField.define<DiagnosticsState>({
  create: () => ({ list: [], decorations: Decoration.none }),
  update(value, tr) {
    for (const effect of tr.effects) {
      if (effect.is(setDiagnostics)) return { list: effect.value, decorations: buildDiagnostics(tr.state, effect.value) };
    }
    return tr.docChanged ? { list: value.list, decorations: value.decorations.map(tr.changes) } : value;
  },
  provide: (field) => EditorView.decorations.from(field, (value) => value.decorations),
});

const setBlanks = StateEffect.define<readonly CodeEditorBlank[]>();

class EmptyBlankWidget extends WidgetType {
  eq() {
    return true;
  }
  toDOM() {
    const element = document.createElement("span");
    element.className = "cm-dj-blank-empty";
    element.setAttribute("aria-hidden", "true");
    return element;
  }
}

const blanksField = StateField.define<readonly CodeEditorBlank[]>({
  create: () => [],
  update(value, tr) {
    for (const effect of tr.effects) if (effect.is(setBlanks)) return effect.value;
    if (!tr.docChanged) return value;
    return value.map((blank) => {
      const from = tr.changes.mapPos(blank.from, -1);
      return { ...blank, from, to: Math.max(from, tr.changes.mapPos(blank.to, 1)) };
    });
  },
  provide: (field) =>
    EditorView.decorations.from(field, (blanks) => {
      const builder = new RangeSetBuilder<Decoration>();
      for (const blank of [...blanks].sort((a, b) => a.from - b.from)) {
        if (blank.to > blank.from) {
          builder.add(blank.from, blank.to, Decoration.mark({ class: "cm-dj-blank", attributes: { "data-blank-id": blank.id } }));
        } else {
          builder.add(blank.from, blank.from, Decoration.widget({ widget: new EmptyBlankWidget(), side: 1 }));
        }
      }
      return builder.finish();
    }),
});

/* ---------- Gutter markers ---------- */

const CHECK_SVG = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"><path d="M20 6 9 17l-5-5"/></svg>';
const CIRCLE_SVG = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="8"/></svg>';

class SelectMarker extends GutterMarker {
  constructor(readonly selected: boolean) {
    super();
  }
  eq(other: SelectMarker) {
    return other.selected === this.selected;
  }
  toDOM() {
    const element = document.createElement("span");
    element.className = "cm-dj-line-select-marker";
    element.dataset.selected = String(this.selected);
    element.setAttribute("aria-hidden", "true");
    element.innerHTML = this.selected ? CHECK_SVG : CIRCLE_SVG;
    return element;
  }
}

class DiagnosticMarker extends GutterMarker {
  constructor(readonly severity: "error" | "warning") {
    super();
  }
  eq(other: DiagnosticMarker) {
    return other.severity === this.severity;
  }
  toDOM() {
    const element = document.createElement("span");
    element.className = "cm-dj-diagnostic-marker";
    element.dataset.severity = this.severity;
    element.setAttribute("aria-hidden", "true");
    element.textContent = this.severity === "error" ? "!" : "?";
    return element;
  }
}

const marksGutter = gutter({
  class: "cm-dj-marks",
  lineMarker(view, line) {
    const lineNumber = view.state.doc.lineAt(line.from).number;
    const selected = view.state.field(selectedLinesField, false);
    if (selected) return new SelectMarker(selected.includes(lineNumber));
    const diagnostic = view.state.field(diagnosticsField, false)?.list.find((item) => item.line === lineNumber);
    return diagnostic ? new DiagnosticMarker(diagnostic.severity ?? "error") : null;
  },
  lineMarkerChange: (update) =>
    update.transactions.some((tr) => tr.effects.some((effect) => effect.is(setSelectedLines) || effect.is(setDiagnostics))),
  initialSpacer: () => new SelectMarker(false),
});

/* ---------- Line-selection decorations (selected + keyboard cursor line) ---------- */

const lineSelectionDecorations = ViewPlugin.fromClass(
  class {
    decorations: DecorationSet;
    constructor(view: EditorView) {
      this.decorations = this.build(view);
    }
    update(update: ViewUpdate) {
      if (update.docChanged || update.selectionSet || update.focusChanged || update.transactions.some((tr) => tr.effects.some((effect) => effect.is(setSelectedLines)))) {
        this.decorations = this.build(update.view);
      }
    }
    build(view: EditorView) {
      const selected = view.state.field(selectedLinesField, false) ?? [];
      const cursorLine = view.hasFocus ? view.state.doc.lineAt(view.state.selection.main.head).number : -1;
      const builder = new RangeSetBuilder<Decoration>();
      for (let number = 1; number <= view.state.doc.lines; number += 1) {
        const classes = [selected.includes(number) ? "cm-dj-line-selected" : "", number === cursorLine ? "cm-dj-line-cursor" : ""].filter(Boolean);
        if (classes.length) {
          const line = view.state.doc.line(number);
          builder.add(line.from, line.from, Decoration.line({ class: classes.join(" ")}));
        }
      }
      return builder.finish();
    }
  },
  { decorations: (plugin) => plugin.decorations },
);

/* ---------- Languages ---------- */

const languageCache = new Map<string, Promise<Extension>>();

function loadLanguage(language: "python" | "markdown" | "plain"): Promise<Extension> {
  if (language === "plain") return Promise.resolve([]);
  let pending = languageCache.get(language);
  if (!pending) {
    pending = language === "python"
      ? import("@codemirror/lang-python").then((m) => m.python())
      : import("@codemirror/lang-markdown").then((m) => m.markdown());
    pending.catch(() => languageCache.delete(language));
    languageCache.set(language, pending);
  }
  return pending;
}

/* ---------- Component ---------- */

export function CodeEditorClient({
  value,
  language = "python",
  onChange,
  ariaLabel,
  readOnly = false,
  disabled = false,
  lineSelection,
  diagnostics,
  blanks,
  onBlanksChange,
  lineNumbers = true,
  onReady,
}: CodeEditorClientProps) {
  const hostRef = useRef<HTMLDivElement>(null);
  const viewRef = useRef<EditorView | null>(null);
  const configRef = useRef(new Compartment());
  const languageRef = useRef(new Compartment());
  const instructionsId = useId();
  const [announcement, setAnnouncement] = useState("");

  // Latest callbacks without re-creating the view.
  const latest = useRef({ onChange, onBlanksChange, lineSelection });
  latest.current = { onChange, onBlanksChange, lineSelection };

  const toggleLine = (view: EditorView, lineNumber: number) => {
    const selection = latest.current.lineSelection;
    if (!selection) return false;
    const current = selection.selected;
    const isSelected = current.includes(lineNumber);
    const next = selection.mode === "single" ? (isSelected ? [] : [lineNumber]) : isSelected ? current.filter((line) => line !== lineNumber) : [...current, lineNumber].sort((a, b) => a - b);
    selection.onChange(next);
    setAnnouncement(selection.describeChange(lineNumber, !isSelected));
    void view;
    return true;
  };
  const toggleRef = useRef(toggleLine);
  toggleRef.current = toggleLine;

  const lineSelectionActive = Boolean(lineSelection);

  const dynamicConfig = (): Extension => {
    const editable = !disabled;
    const locked = disabled || readOnly || lineSelectionActive;
    const contentAttributes: Record<string, string> = { "aria-label": ariaLabel };
    if (disabled) contentAttributes["aria-disabled"] = "true";
    if (locked) contentAttributes["aria-readonly"] = "true";
    if (lineSelectionActive) contentAttributes["aria-describedby"] = instructionsId;
    return [
      EditorView.editable.of(editable),
      EditorState.readOnly.of(locked),
      EditorView.contentAttributes.of(contentAttributes),
      lineNumbers ? lineNumbersExtension() : [],
      lineSelectionActive || (diagnostics?.length ?? 0) > 0 ? marksGutter : [],
      lineSelectionActive
        ? [
            lineSelectionDecorations,
            keymap.of([
              { key: "Space", run: (view) => toggleRef.current(view, view.state.doc.lineAt(view.state.selection.main.head).number) },
              { key: "Enter", run: (view) => toggleRef.current(view, view.state.doc.lineAt(view.state.selection.main.head).number) },
            ]),
            EditorView.domEventHandlers({
              click(event, view) {
                const position = view.posAtCoords({ x: event.clientX, y: event.clientY });
                if (position == null) return false;
                return toggleRef.current(view, view.state.doc.lineAt(position).number);
              },
            }),
          ]
        : [],
      locked ? [] : [highlightActiveLine(), highlightActiveLineGutter()],
    ];
  };

  // Create the view once.
  useEffect(() => {
    if (!hostRef.current) return;
    const view = new EditorView({
      parent: hostRef.current,
      state: EditorState.create({
        doc: value,
        extensions: [
          history(),
          drawSelection(),
          indentOnInput(),
          bracketMatching(),
          // Filled in once the language pack loads (see below); one view per file.
          languageRef.current.of([]),
          language === "plain" ? [] : syntaxHighlighting(dojoHighlight),
          dojoTheme,
          EditorState.tabSize.of(4),
          // PEP 8: one indent level is four spaces. CodeMirror's default unit
          // is two, so Enter after `for ...:` landed at the wrong column.
          indentUnit.of("    "),
          // Tab indents; Escape then Tab moves focus out (CodeMirror tab-focus mode).
          keymap.of([...defaultKeymap, ...historyKeymap, indentWithTab]),
          selectedLinesField,
          diagnosticsField,
          blanksField,
          configRef.current.of(dynamicConfig()),
          EditorView.updateListener.of((update) => {
            const isExternal = update.transactions.some((tr) => tr.annotation(external));
            if (update.docChanged && !isExternal) {
              latest.current.onChange?.(update.state.doc.toString());
              const mapped = update.state.field(blanksField);
              if (mapped.length) latest.current.onBlanksChange?.([...mapped]);
            }
          }),
        ],
      }),
    });
    viewRef.current = view;
    onReady?.();
    return () => {
      view.destroy();
      viewRef.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Language packs are separate chunks: a page with only Python never loads Markdown (and its HTML/JS grammars).
  useEffect(() => {
    let live = true;
    void loadLanguage(language).then((extension) => {
      if (live) viewRef.current?.dispatch({ effects: languageRef.current.reconfigure(extension) });
    });
    return () => {
      live = false;
    };
  }, [language]);

  // Controlled value.
  useEffect(() => {
    const view = viewRef.current;
    if (!view) return;
    const current = view.state.doc.toString();
    if (current !== value) {
      view.dispatch({ changes: { from: 0, to: current.length, insert: value }, annotations: external.of(true) });
    }
  }, [value]);

  // Reconfigure modes.
  useEffect(() => {
    viewRef.current?.dispatch({ effects: configRef.current.reconfigure(dynamicConfig()) });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [disabled, readOnly, lineSelectionActive, lineNumbers, ariaLabel, (diagnostics?.length ?? 0) > 0]);

  const selectedKey = lineSelection ? lineSelection.selected.join(",") : null;
  useEffect(() => {
    const view = viewRef.current;
    if (!view) return;
    view.dispatch({ effects: setSelectedLines.of(lineSelection ? [...lineSelection.selected] : null) });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedKey]);

  const diagnosticsKey = JSON.stringify(diagnostics ?? []);
  useEffect(() => {
    viewRef.current?.dispatch({ effects: setDiagnostics.of(diagnostics ?? []) });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [diagnosticsKey]);

  const blanksKey = JSON.stringify(blanks ?? []);
  useEffect(() => {
    const view = viewRef.current;
    if (!view) return;
    const current = JSON.stringify(view.state.field(blanksField));
    if (current !== blanksKey) view.dispatch({ effects: setBlanks.of(blanks ?? []) });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [blanksKey]);

  return (
    <>
      <div ref={hostRef} className="dj-code-editor__host" dir="ltr" />
      {lineSelection ? (
        <>
          <span id={instructionsId} className="dj-practice-sr-only">{lineSelection.instructions}</span>
          <span className="dj-practice-sr-only" role="status" aria-live="polite">{announcement}</span>
        </>
      ) : null}
    </>
  );
}
