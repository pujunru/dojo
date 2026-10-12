"use client";

import { useId, useRef, useState, type DragEvent, type KeyboardEvent, type ReactNode } from "react";
import { ArrowDownToLine, Check, GripVertical, IndentIncrease, ListIndentDecrease, ListIndentIncrease, Undo2, X } from "lucide-react";
import { cn } from "../lib/utils";

export type ReorderItem = {
  id: string;
  /** Code shown verbatim (monospace, LTR). */
  code: string;
  /** Indent level (0-based). Only meaningful when `maxIndent` > 0. */
  indent?: number;
};

export type ReorderValue = {
  /** The answer, in order. */
  items: ReorderItem[];
  /** Lines not used in the answer (distractors live here until moved). */
  pool: ReorderItem[];
};

/** `indent`: right line in the right place, wrong indentation. */
export type ReorderReveal = Record<string, "correct" | "incorrect" | "indent">;

/** Every string is translated by the caller; the primitive picks no locale. */
export type ReorderListLabels = {
  answerRegion: string;
  poolRegion?: string;
  /** Keyboard instructions, linked to each line through aria-describedby. */
  instructions: string;
  emptyAnswer: string;
  emptyPool?: string;
  /** Accessible name for one line, e.g. "Line 2 of 5, indent 1: return x". */
  itemName: (item: ReorderItem, position: number, total: number) => string;
  /** Live-region messages. */
  moved: (item: ReorderItem, position: number, total: number) => string;
  indented: (item: ReorderItem, level: number) => string;
  movedToPool?: (item: ReorderItem) => string;
  movedToAnswer?: (item: ReorderItem, position: number, total: number) => string;
  indentIncrease: string;
  indentDecrease: string;
  moveToPool?: string;
  moveToAnswer?: string;
  revealCorrect: string;
  revealIncorrect: string;
  /** Accessible name for the `indent` verdict; falls back to `revealIncorrect`. */
  revealIndent?: string;
};

export type ReorderListProps = {
  value: ReorderValue;
  onChange: (value: ReorderValue) => void;
  labels: ReorderListLabels;
  /** Highest indent level; 0 hides the indent controls. */
  maxIndent?: number;
  /** Characters per indent level, as the code will be assembled (Python: 4). */
  indentWidth?: number;
  /** Short per-line explanation shown under the line after reveal. */
  revealNotes?: Record<string, ReactNode>;
  /** Show the distractor pool. */
  showPool?: boolean;
  reveal?: ReorderReveal;
  disabled?: boolean;
  className?: string;
};

type Region = "items" | "pool";
type DragState = { id: string; from: Region } | null;
type DropState = { region: Region; index: number } | null;

function moveWithin<T>(list: T[], from: number, to: number) {
  const next = [...list];
  const [item] = next.splice(from, 1);
  next.splice(to, 0, item!);
  return next;
}

/**
 * Ordered list of code lines for Parsons problems. Reorder by dragging or by
 * keyboard: ↑/↓ moves focus, Alt+↑/↓ moves the line, Alt+→/← changes indent,
 * Delete moves a line to the pool and Enter moves a pool line into the answer.
 */
export function ReorderList({ value, onChange, labels, maxIndent = 0, indentWidth = 4, revealNotes, showPool = false, reveal, disabled = false, className }: ReorderListProps) {
  const instructionsId = useId();
  const [announcement, setAnnouncement] = useState("");
  const [focusId, setFocusId] = useState<string | null>(value.items[0]?.id ?? value.pool[0]?.id ?? null);
  const [drag, setDrag] = useState<DragState>(null);
  const [drop, setDrop] = useState<DropState>(null);
  const itemRefs = useRef(new Map<string, HTMLLIElement>());
  const interactive = !disabled && !reveal;

  const focusItem = (id: string) => {
    setFocusId(id);
    requestAnimationFrame(() => itemRefs.current.get(id)?.focus());
  };

  const commit = (next: ReorderValue, message: string, keepFocusOn?: string) => {
    onChange(next);
    setAnnouncement(message);
    if (keepFocusOn) focusItem(keepFocusOn);
  };

  const moveItem = (index: number, delta: number) => {
    const target = index + delta;
    if (target < 0 || target >= value.items.length) return;
    const items = moveWithin(value.items, index, target);
    commit({ ...value, items }, labels.moved(items[target]!, target + 1, items.length), items[target]!.id);
  };

  const indentItem = (index: number, delta: number) => {
    const item = value.items[index]!;
    const level = Math.min(maxIndent, Math.max(0, (item.indent ?? 0) + delta));
    if (level === (item.indent ?? 0)) return;
    const items = value.items.map((entry, entryIndex) => (entryIndex === index ? { ...entry, indent: level } : entry));
    commit({ ...value, items }, labels.indented(items[index]!, level), item.id);
  };

  const toPool = (index: number) => {
    const item = value.items[index]!;
    const items = value.items.filter((_, entryIndex) => entryIndex !== index);
    const pool = [...value.pool, { ...item, indent: 0 }];
    commit({ items, pool }, labels.movedToPool?.(item) ?? "", items[Math.min(index, items.length - 1)]?.id ?? item.id);
  };

  const toAnswer = (index: number, at = value.items.length) => {
    const item = value.pool[index]!;
    const pool = value.pool.filter((_, entryIndex) => entryIndex !== index);
    const items = [...value.items];
    items.splice(at, 0, item);
    commit({ items, pool }, labels.movedToAnswer?.(item, at + 1, items.length) ?? "", pool[Math.min(index, pool.length - 1)]?.id ?? item.id);
  };

  const onKeyDown = (event: KeyboardEvent<HTMLLIElement>, region: Region, index: number) => {
    const list = region === "items" ? value.items : value.pool;
    const vertical = event.key === "ArrowUp" ? -1 : event.key === "ArrowDown" ? 1 : 0;
    if (vertical && !event.altKey) {
      event.preventDefault();
      const next = list[index + vertical];
      if (next) focusItem(next.id);
      return;
    }
    if (!interactive) return;
    if (region === "items" && vertical && event.altKey) {
      event.preventDefault();
      moveItem(index, vertical);
    } else if (region === "items" && maxIndent > 0 && event.altKey && (event.key === "ArrowRight" || event.key === "ArrowLeft")) {
      // Code is always LTR, so Right indents regardless of page direction.
      event.preventDefault();
      indentItem(index, event.key === "ArrowRight" ? 1 : -1);
    } else if (region === "items" && showPool && (event.key === "Delete" || event.key === "Backspace")) {
      event.preventDefault();
      toPool(index);
    } else if (region === "pool" && (event.key === "Enter" || event.key === " ")) {
      event.preventDefault();
      toAnswer(index);
    }
  };

  /* ---------- Drag and drop (pointer users) ---------- */

  const onDragStart = (event: DragEvent<HTMLLIElement>, id: string, from: Region) => {
    if (!interactive) return;
    event.dataTransfer.effectAllowed = "move";
    event.dataTransfer.setData("text/plain", id);
    setDrag({ id, from });
  };

  const onDragOverItem = (event: DragEvent<HTMLLIElement>, region: Region, index: number) => {
    if (!drag) return;
    event.preventDefault();
    event.stopPropagation();
    const rect = event.currentTarget.getBoundingClientRect();
    const after = event.clientY > rect.top + rect.height / 2;
    setDrop({ region, index: index + (after ? 1 : 0) });
  };

  const onDragOverRegion = (event: DragEvent<HTMLOListElement>, region: Region) => {
    if (!drag) return;
    event.preventDefault();
    if (event.target === event.currentTarget) setDrop({ region, index: (region === "items" ? value.items : value.pool).length });
  };

  const onDrop = (event: DragEvent<HTMLOListElement>) => {
    event.preventDefault();
    if (!drag || !drop) return reset();
    const source = drag.from === "items" ? value.items : value.pool;
    const fromIndex = source.findIndex((item) => item.id === drag.id);
    if (fromIndex < 0) return reset();
    const item = source[fromIndex]!;
    let items = [...value.items];
    let pool = [...value.pool];
    if (drag.from === "items") items.splice(fromIndex, 1);
    else pool.splice(fromIndex, 1);
    let target = drop.index;
    if (drag.from === drop.region && fromIndex < target) target -= 1;
    if (drop.region === "items") {
      items.splice(target, 0, item);
      items = [...items];
    } else {
      pool.splice(target, 0, { ...item, indent: 0 });
      pool = [...pool];
    }
    const message = drop.region === "items" ? labels.moved(item, target + 1, items.length) : labels.movedToPool?.(item) ?? "";
    commit({ items, pool }, message);
    reset();
  };

  const reset = () => {
    setDrag(null);
    setDrop(null);
  };

  const renderRegion = (region: Region) => {
    const list = region === "items" ? value.items : value.pool;
    const isAnswer = region === "items";
    const headingId = `${instructionsId}-${region}`;
    return (
      <div className="dj-reorder__region">
        <span id={headingId} className="dj-reorder__region-label dj-type-caption">
          {isAnswer ? labels.answerRegion : labels.poolRegion}
        </span>
        <ol
          className="dj-reorder__list"
          data-region={isAnswer ? "answer" : "pool"}
          data-drop-target={drag && drop?.region === region ? "true" : undefined}
          aria-labelledby={headingId}
          onDragOver={(event) => onDragOverRegion(event, region)}
          onDrop={onDrop}
          onDragLeave={(event) => {
            if (!event.currentTarget.contains(event.relatedTarget as Node)) setDrop(null);
          }}
        >
          {list.length === 0 ? <li className="dj-reorder__empty dj-type-body-sm">{isAnswer ? labels.emptyAnswer : labels.emptyPool}</li> : null}
          {list.map((item, index) => {
            const indent = isAnswer ? Math.min(maxIndent, item.indent ?? 0) : 0;
            const verdict = reveal?.[item.id];
            const tabbable = focusId === item.id || (focusId === null && index === 0 && isAnswer);
            const dropHere = drag && drop?.region === region;
            return (
              <li
                key={item.id}
                ref={(element) => {
                  if (element) itemRefs.current.set(item.id, element);
                  else itemRefs.current.delete(item.id);
                }}
                className="dj-reorder__item"
                tabIndex={tabbable ? 0 : -1}
                draggable={interactive}
                aria-label={`${labels.itemName(item, index + 1, list.length)}${verdict ? ` — ${verdict === "correct" ? labels.revealCorrect : verdict === "indent" ? labels.revealIndent ?? labels.revealIncorrect : labels.revealIncorrect}` : ""}`}
                aria-describedby={instructionsId}
                aria-disabled={disabled || undefined}
                data-reveal={verdict}
                data-dragging={drag?.id === item.id ? "true" : undefined}
                data-drop-before={dropHere && drop!.index === index ? "true" : undefined}
                data-drop-after={dropHere && index === list.length - 1 && drop!.index === list.length ? "true" : undefined}
                style={{ ["--dj-reorder-indent" as string]: indent, ["--dj-reorder-indent-width" as string]: indentWidth }}
                onFocus={() => setFocusId(item.id)}
                onKeyDown={(event) => onKeyDown(event, region, index)}
                onDragStart={(event) => onDragStart(event, item.id, region)}
                onDragOver={(event) => onDragOverItem(event, region, index)}
                onDragEnd={reset}
              >
                <span className="dj-reorder__grip" aria-hidden="true">
                  {verdict ? (
                    <span className="dj-reorder__reveal">{verdict === "correct" ? <Check /> : verdict === "indent" ? <IndentIncrease /> : <X />}</span>
                  ) : (
                    <GripVertical />
                  )}
                </span>
                <span className="dj-reorder__body">
                  <span className="dj-reorder__code" dir="ltr" data-indent-guides={isAnswer && maxIndent > 0 && indent > 0 ? "true" : undefined}>
                    <code>{item.code}</code>
                  </span>
                  {verdict && revealNotes?.[item.id] ? <span className="dj-reorder__note dj-type-body-sm">{revealNotes[item.id]}</span> : null}
                </span>
                {interactive ? (
                  <span className="dj-reorder__actions">
                    {isAnswer && maxIndent > 0 ? (
                      <>
                        <button type="button" tabIndex={-1} className="dj-reorder__action" aria-label={labels.indentDecrease} title={labels.indentDecrease} disabled={indent === 0} onClick={() => indentItem(index, -1)}>
                          <ListIndentDecrease aria-hidden="true" />
                        </button>
                        <button type="button" tabIndex={-1} className="dj-reorder__action" aria-label={labels.indentIncrease} title={labels.indentIncrease} disabled={indent >= maxIndent} onClick={() => indentItem(index, 1)}>
                          <ListIndentIncrease aria-hidden="true" />
                        </button>
                      </>
                    ) : null}
                    {showPool && isAnswer && labels.moveToPool ? (
                      <button type="button" tabIndex={-1} className="dj-reorder__action" aria-label={labels.moveToPool} title={labels.moveToPool} onClick={() => toPool(index)}>
                        <Undo2 aria-hidden="true" />
                      </button>
                    ) : null}
                    {!isAnswer && labels.moveToAnswer ? (
                      <button type="button" tabIndex={-1} className="dj-reorder__action" aria-label={labels.moveToAnswer} title={labels.moveToAnswer} onClick={() => toAnswer(index)}>
                        <ArrowDownToLine aria-hidden="true" />
                      </button>
                    ) : null}
                  </span>
                ) : (
                  <span />
                )}
              </li>
            );
          })}
        </ol>
      </div>
    );
  };

  return (
    <div className={cn("dj-reorder", className)} data-disabled={disabled ? "true" : undefined}>
      <span id={instructionsId} className="dj-practice-sr-only">{labels.instructions}</span>
      {renderRegion("items")}
      {showPool ? renderRegion("pool") : null}
      <span className="dj-practice-sr-only" role="status" aria-live="polite">{announcement}</span>
    </div>
  );
}
