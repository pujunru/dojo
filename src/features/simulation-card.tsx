"use client";

import * as React from "react";
import { Play, Swords, Timer } from "lucide-react";
import { useTranslations } from "use-intl";
import { Button } from "../ui/button";
import { cn } from "../lib/utils";

export type SimulationCardProps = {
  /** Item prompt and scenario (data). */
  title: string;
  summary: string;
  minutes: number;
  /** e.g. the item's skin (data). */
  tag?: string;
  /** Undefined while another session is starting. */
  onStart?: () => void;
  className?: string;
};

/** Launch card for a timed staged case (`case` with `simulation`): one item, a countdown, no code runner needed. */
export function SimulationCard({ title, summary, minutes, tag, onStart, className }: SimulationCardProps) {
  const t = useTranslations("dojo.simulation");
  const titleId = React.useId();
  return (
    <article className={cn("dj-dojo-mock", className)} data-state="ready" aria-labelledby={titleId}>
      <header className="dj-dojo-mock__header">
        <span className="dj-practice-milestone-tile" data-tone="magenta" aria-hidden="true"><Swords /></span>
        <div className="dj-dojo-mock__identity">
          <span className="dj-type-caption dj-dojo-muted">{t("eyebrow")}</span>
          <h3 className="dj-type-heading-md" id={titleId}>{title}</h3>
        </div>
      </header>
      <p className="dj-type-body-sm dj-dojo-mock__summary">{summary}</p>
      <p className="dj-dojo-mock__meta dj-type-caption">
        <span><Timer aria-hidden="true" />{t("minutes", { count: minutes })}</span>
        {tag ? <span translate="no">{tag}</span> : null}
      </p>
      <div className="dj-dojo-mock__actions">
        <Button onClick={onStart} disabled={!onStart}><Play aria-hidden="true" />{t("start")}</Button>
      </div>
    </article>
  );
}
