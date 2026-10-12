"use client";

import * as React from "react";
import { useTranslations } from "use-intl";
import { Check } from "lucide-react";
import { cn } from "../lib/utils";

export type SeriesOption = {
  id: string;
  /** Data from the series config, already picked for the locale. */
  title: string;
  description?: string;
  /** Optional progress line, e.g. units complete. */
  progress?: { done: number; total: number };
};

export type SeriesSwitcherProps = {
  series: readonly SeriesOption[];
  activeId: string;
  onSelect: (id: string) => void;
  disabled?: boolean;
  className?: string;
};

/**
 * Picks which curriculum (series) the dojo shows: its path, skills and review
 * queue. XP, streak and the daily goal are shared across series, so they stay
 * in the header above this. Renders nothing with fewer than two series.
 *
 * A radiogroup of cards: arrow keys move between series, Enter/Space select.
 */
export function SeriesSwitcher({ series, activeId, onSelect, disabled = false, className }: SeriesSwitcherProps) {
  const t = useTranslations("dojo.series");
  const refs = React.useRef(new Map<string, HTMLButtonElement>());
  if (series.length < 2) return null;

  const move = (from: number, delta: number) => {
    const next = series[(from + delta + series.length) % series.length];
    refs.current.get(next.id)?.focus();
    onSelect(next.id);
  };

  return (
    <div role="radiogroup" aria-label={t("label")} className={cn("dj-dojo-series", className)}>
      {series.map((entry, index) => {
        const active = entry.id === activeId;
        return (
          <button
            key={entry.id}
            ref={(el) => { if (el) refs.current.set(entry.id, el); else refs.current.delete(entry.id); }}
            type="button"
            role="radio"
            aria-checked={active}
            tabIndex={active ? 0 : -1}
            disabled={disabled}
            className="dj-dojo-series__option"
            data-active={active || undefined}
            onClick={() => { if (!active) onSelect(entry.id); }}
            onKeyDown={(event) => {
              if (event.key === "ArrowRight" || event.key === "ArrowDown") { event.preventDefault(); move(index, 1); }
              else if (event.key === "ArrowLeft" || event.key === "ArrowUp") { event.preventDefault(); move(index, -1); }
            }}
          >
            <span className="dj-dojo-series__text">
              <span className="dj-type-label dj-dojo-series__title">{entry.title}</span>
              {entry.description ? <span className="dj-type-caption dj-dojo-series__description">{entry.description}</span> : null}
              {entry.progress ? (
                <span className="dj-type-caption dj-dojo-series__progress">
                  {t("progress", { done: entry.progress.done, total: entry.progress.total })}
                </span>
              ) : null}
            </span>
            <span className="dj-dojo-series__mark" aria-hidden="true">{active ? <Check /> : null}</span>
          </button>
        );
      })}
    </div>
  );
}
