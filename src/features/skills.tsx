"use client";

import * as React from "react";
import { CalendarClock, LifeBuoy, Play, RotateCcw } from "lucide-react";
import { useFormatter, useTranslations } from "use-intl";
import { Button } from "../ui/button";
import { cn } from "../lib/utils";
import type { MasteryLevel } from "../ui/mastery-crown";

/* ───────────────────────── KcHeatmap ───────────────────────── */

export type KcBand = "unseen" | "weak" | "fading" | "solid" | "strong";

/** p bands used by the heatmap; R_CRACK (0.5) and R_DUE (0.7) are the first two cuts. */
export function kcBand(p: number | null): KcBand {
  if (p === null) return "unseen";
  if (p < 0.5) return "weak";
  if (p < 0.7) return "fading";
  if (p < 0.9) return "solid";
  return "strong";
}

export const KC_BANDS: readonly KcBand[] = ["unseen", "weak", "fading", "solid", "strong"];

export type KcHeatmapCell = {
  id: string;
  /** Locale-resolved KC title (curriculum data). */
  title: string;
  /** Current recall probability, null when never practised. */
  p: number | null;
  mastery: MasteryLevel;
  due?: boolean;
};

export type KcHeatmapRow = { unitId: string; title: string; cells: readonly KcHeatmapCell[] };

export type KcHeatmapProps = {
  rows: readonly KcHeatmapRow[];
  selectedKcId?: string | null;
  onSelectKc?: (kcId: string) => void;
  className?: string;
};

/**
 * Units × KCs. Each cell encodes the recall band three ways: a green ramp,
 * a fill pattern (hatched = weak, dotted = fading, outlined = unseen) and the
 * mastery numeral; due cells add a corner flag. Legend repeats all three.
 */
export function KcHeatmap({ rows, selectedKcId, onSelectKc, className }: KcHeatmapProps) {
  const t = useTranslations("dojo.heatmap");
  const format = useFormatter();
  const percent = (value: number) => format.number(value, { style: "percent" });
  const titleId = React.useId();
  const empty = rows.every((row) => row.cells.every((cell) => cell.p === null));

  return (
    <section className={cn("dj-dojo-heatmap", className)} aria-labelledby={titleId} data-panel>
      <header className="dj-dojo-heatmap__header">
        <h2 className="dj-type-heading-lg" id={titleId}>{t("title")}</h2>
        <ul className="dj-dojo-heatmap__legend" aria-label={t("legend")}>
          {KC_BANDS.map((band) => (
            <li key={band} className="dj-dojo-heatmap__legend-item">
              <span className="dj-dojo-heatmap__swatch" data-band={band} aria-hidden="true" />
              <span className="dj-type-caption">{t(`band.${band}`)}</span>
              <span className="dj-type-caption dj-dojo-muted">{t(`bandRange.${band}`)}</span>
            </li>
          ))}
          <li className="dj-dojo-heatmap__legend-item">
            <span className="dj-dojo-heatmap__swatch" data-band="solid" data-due="true" aria-hidden="true" />
            <span className="dj-type-caption">{t("due")}</span>
          </li>
        </ul>
      </header>
      {empty ? <p className="dj-type-body-sm dj-dojo-muted dj-dojo-heatmap__empty">{t("empty")}</p> : null}
      <div className="dj-dojo-heatmap__rows" role="list">
        {rows.map((row) => (
          <div key={row.unitId} className="dj-dojo-heatmap__row" role="listitem">
            <div className="dj-dojo-heatmap__unit">
              <span className="dj-type-label">{row.title}</span>
              <span className="dj-type-caption dj-dojo-muted">{t("kcCount", { count: row.cells.length })}</span>
            </div>
            <ul className="dj-dojo-heatmap__cells" aria-label={row.title}>
              {row.cells.map((cell) => {
                const band = kcBand(cell.p);
                const label = cell.p === null
                  ? t("cellUnseen", { title: cell.title })
                  : t("cellAria", { title: cell.title, band: t(`band.${band}`), p: percent(cell.p), mastery: cell.mastery, due: cell.due ? "yes" : "no" });
                return (
                  <li key={cell.id}>
                    <button
                      type="button"
                      className="dj-dojo-heatmap__cell"
                      data-band={band}
                      data-due={cell.due ? "true" : undefined}
                      aria-pressed={selectedKcId === cell.id}
                      aria-label={label}
                      title={label}
                      onClick={onSelectKc ? () => onSelectKc(cell.id) : undefined}
                      disabled={!onSelectKc}
                    >
                      <span aria-hidden="true" className="dj-dojo-heatmap__numeral">{band === "unseen" ? "·" : cell.mastery}</span>
                    </button>
                  </li>
                );
              })}
            </ul>
          </div>
        ))}
      </div>
    </section>
  );
}

/* ───────────────────────── ReviewQueueList ───────────────────────── */

export type ReviewQueueEntry = {
  kcId: string;
  title: string;
  unitTitle: string;
  /** Current recall probability (0..1). */
  p: number;
  /** ISO instant: when the KC falls due (or did). For remedial entries, when remediation ends. */
  at: string;
  state: "due" | "upcoming" | "remedial";
};

export type ReviewQueueListProps = {
  entries: readonly ReviewQueueEntry[];
  /** Reference instant for relative times (keeps server and client output identical). */
  now: Date;
  onPracticeAll?: () => void;
  onPracticeKc?: (kcId: string) => void;
  className?: string;
};

const GROUP_ORDER = ["remedial", "due", "upcoming"] as const;
const GROUP_ICON = { remedial: LifeBuoy, due: CalendarClock, upcoming: RotateCcw } as const;

/** Due KCs sorted by p ascending, then remedial and upcoming groups; one "review only" action. */
export function ReviewQueueList({ entries, now, onPracticeAll, onPracticeKc, className }: ReviewQueueListProps) {
  const t = useTranslations("dojo.review");
  const format = useFormatter();
  const percent = (value: number) => format.number(value, { style: "percent" });
  const titleId = React.useId();
  const actionable = entries.filter((entry) => entry.state !== "upcoming").length;

  return (
    <section className={cn("dj-dojo-review", className)} aria-labelledby={titleId} data-panel>
      <header className="dj-dojo-review__header">
        <h2 className="dj-type-heading-lg" id={titleId}>{t("title")}</h2>
        <Button onClick={onPracticeAll} disabled={!onPracticeAll || actionable === 0}>
          <Play aria-hidden="true" />
          {t("practiceAll", { count: actionable })}
        </Button>
      </header>
      {entries.length === 0 ? (
        <div className="dj-dojo-empty">
          <span className="dj-practice-milestone-tile" data-tone="neutral" aria-hidden="true"><CalendarClock /></span>
          <span className="dj-type-label">{t("emptyTitle")}</span>
          <span className="dj-type-body-sm dj-dojo-muted">{t("emptyBody")}</span>
        </div>
      ) : null}
      {GROUP_ORDER.map((group) => {
        const list = entries.filter((entry) => entry.state === group).sort((a, b) => a.p - b.p);
        if (!list.length) return null;
        const Icon = GROUP_ICON[group];
        return (
          <section key={group} className="dj-dojo-review__group" data-group={group} aria-label={t(`group.${group}`)}>
            <h3 className="dj-dojo-review__group-title dj-type-heading-sm">
              <Icon aria-hidden="true" />
              {t(`group.${group}`)}
              <span className="dj-dojo-chip dj-type-caption" data-state="count">{list.length}</span>
            </h3>
            <ul className="dj-dojo-review__list">
              {list.map((entry) => {
                const when = format.relativeTime(new Date(entry.at), now);
                return (
                  <li key={entry.kcId} className="dj-dojo-review__row">
                    <div className="dj-dojo-review__identity">
                      <span className="dj-type-label">{entry.title}</span>
                      <span className="dj-type-caption dj-dojo-muted">{entry.unitTitle}</span>
                    </div>
                    <div className="dj-dojo-review__recall">
                      <span className="dj-dojo-review__meter" aria-hidden="true"><span data-band={kcBand(entry.p)} style={{ inlineSize: `${entry.p * 100}%` }} /></span>
                      <span className="dj-type-caption">{t("recall", { value: percent(entry.p) })}</span>
                    </div>
                    <span className="dj-dojo-review__when dj-type-caption">
                      {group === "remedial" ? t("remedialUntil", { when }) : group === "due" ? t("dueSince", { when }) : t("dueIn", { when })}
                    </span>
                    {onPracticeKc ? (
                      <Button variant="ghost" size="sm" onClick={() => onPracticeKc(entry.kcId)} aria-label={t("practiceOneAria", { title: entry.title })}>
                        {t("practiceOne")}
                      </Button>
                    ) : null}
                  </li>
                );
              })}
            </ul>
          </section>
        );
      })}
    </section>
  );
}
