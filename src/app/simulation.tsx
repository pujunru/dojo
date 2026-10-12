"use client";

/**
 * The simulation tab: every timed staged case (`case` items with
 * `simulation`) as a SimulationCard. A case runs in the player as a
 * one-item session with a countdown. Composed only from registered
 * compositions.
 */
import * as React from "react";
import { useTranslations } from "use-intl";
import type { Locale } from "../i18n/config";
import { Alert, AlertDescription } from "../ui/alert";
import { SimulationCard } from "../features";
import { pickL10n, type CaseItem, type DojoItemIndexRow } from "../core/content-schema";
import { loadUnit } from "./api";

export function SimulationPanel({ rows, contentHash, locale, onStartCase }: {
  rows: readonly DojoItemIndexRow[];
  contentHash: string;
  locale: Locale;
  /** Starts a timed case as a one-item session; undefined while a session is starting. */
  onStartCase?: (itemId: string) => void;
}) {
  const t = useTranslations("app.simulation");
  const caseRows = React.useMemo(() => rows.filter((row) => row.type === "case" && row.simulationMinutes), [rows]);
  const [cases, setCases] = React.useState<CaseItem[] | null>(null);
  const [error, setError] = React.useState(false);

  React.useEffect(() => {
    let live = true;
    const units = [...new Set(caseRows.map((row) => row.unit))];
    Promise.all(units.map((unit) => loadUnit(contentHash, unit)))
      .then((bundles) => {
        if (live) setCases(bundles.flat().filter((item): item is CaseItem => item.type === "case" && Boolean(item.simulation)));
      })
      .catch(() => { if (live) setError(true); });
    return () => { live = false; };
  }, [contentHash, caseRows]);

  if (error) return <Alert variant="warning"><AlertDescription>{t("loadError")}</AlertDescription></Alert>;
  if (!caseRows.length) return <Alert><AlertDescription>{t("empty")}</AlertDescription></Alert>;
  if (!cases) return <Alert aria-busy="true"><AlertDescription>{t("loading")}</AlertDescription></Alert>;

  return (
    <section className="dj-dojo-simulation" aria-label={t("title")}>
      <p className="dj-type-body-sm dj-dojo-muted dj-dojo-simulation__notice">{t("body")}</p>
      <div className="dj-dojo-simulation__grid">
        {cases.map((item) => (
          <SimulationCard
            key={item.id}
            title={pickL10n(item.prompt, locale)}
            summary={pickL10n(item.scenario, locale)}
            minutes={item.simulation!.minutes}
            tag={item.skin}
            onStart={onStartCase ? () => onStartCase(item.id) : undefined}
          />
        ))}
      </div>
    </section>
  );
}
