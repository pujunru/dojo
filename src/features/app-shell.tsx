"use client";

import * as React from "react";
import { Database, Download, Languages, RotateCcw, Upload, X } from "lucide-react";
import { useTranslations } from "use-intl";
import { Button } from "../ui/button";
import { cn } from "../lib/utils";

export type AppShellLocale = { id: string; label: string };

export type AppShellProps = {
  title: string;
  locales: readonly AppShellLocale[];
  locale: string;
  onLocaleChange: (locale: string) => void;
  /** The learner-data panel, shown when the data button is pressed. */
  dataPanel: React.ReactNode;
  children: React.ReactNode;
  className?: string;
};

/**
 * The mobile frame: a top bar (title, language, learner data) over one
 * phone-width column. Wider screens get the same column, centred.
 */
export function AppShell({ title, locales, locale, onLocaleChange, dataPanel, children, className }: AppShellProps) {
  const t = useTranslations("shell");
  const [dataOpen, setDataOpen] = React.useState(false);
  const panelId = React.useId();
  return (
    <div className={cn("dj-shell", className)}>
      <header className="dj-shell__bar">
        <span className="dj-shell__title dj-type-heading-sm">{title}</span>
        <label className="dj-shell__locale">
          <Languages aria-hidden="true" />
          <span className="dj-practice-sr-only">{t("language")}</span>
          <select aria-label={t("language")} value={locale} onChange={(event) => onLocaleChange(event.target.value)}>
            {locales.map((entry) => <option key={entry.id} value={entry.id}>{entry.label}</option>)}
          </select>
        </label>
        <Button
          variant="ghost"
          size="icon"
          aria-label={dataOpen ? t("closeData") : t("openData")}
          aria-expanded={dataOpen}
          aria-controls={panelId}
          onClick={() => setDataOpen((open) => !open)}
        >
          {dataOpen ? <X aria-hidden="true" /> : <Database aria-hidden="true" />}
        </Button>
      </header>
      {dataOpen ? <div id={panelId} className="dj-shell__panel">{dataPanel}</div> : null}
      <main className="dj-shell__main">{children}</main>
    </div>
  );
}

export type LearnerDataPanelProps = {
  /** False when the browser refused durable storage (private mode). */
  durable: boolean;
  summary: { totalXp: number; attempts: number; kcs: number };
  onExport: () => void;
  /** Receives the chosen file; resolves to an error code, or null on success. */
  onImport: (file: File) => Promise<"format" | "version" | null>;
  onReset: () => Promise<void>;
};

/**
 * Where progress lives, and moving it: export to a JSON file, import one on
 * another device, or start over. Reset asks twice.
 */
export function LearnerDataPanel({ durable, summary, onExport, onImport, onReset }: LearnerDataPanelProps) {
  const t = useTranslations("shell.data");
  const fileRef = React.useRef<HTMLInputElement | null>(null);
  const [message, setMessage] = React.useState<{ tone: "ok" | "error"; text: string } | null>(null);
  const [confirmReset, setConfirmReset] = React.useState(false);
  return (
    <section className="dj-data-panel" aria-label={t("title")}>
      <h2 className="dj-type-heading-sm">{t("title")}</h2>
      <p className="dj-type-body-sm dj-dojo-muted">{durable ? t("whereDurable") : t("whereMemory")}</p>
      <p className="dj-type-caption dj-dojo-muted">{t("summary", summary)}</p>
      <div className="dj-data-panel__actions">
        <Button variant="outline" size="sm" onClick={onExport}><Download aria-hidden="true" />{t("export")}</Button>
        <Button variant="outline" size="sm" onClick={() => fileRef.current?.click()}><Upload aria-hidden="true" />{t("import")}</Button>
        <input
          ref={fileRef}
          type="file"
          accept="application/json,.json"
          hidden
          onChange={async (event) => {
            const file = event.target.files?.[0];
            event.target.value = "";
            if (!file) return;
            const error = await onImport(file);
            setMessage(error ? { tone: "error", text: t(`importError.${error}`) } : { tone: "ok", text: t("imported") });
          }}
        />
        {confirmReset ? (
          <>
            <Button
              variant="destructive"
              size="sm"
              onClick={async () => {
                await onReset();
                setConfirmReset(false);
                setMessage({ tone: "ok", text: t("resetDone") });
              }}
            >
              {t("resetConfirm")}
            </Button>
            <Button variant="ghost" size="sm" onClick={() => setConfirmReset(false)}>{t("cancel")}</Button>
          </>
        ) : (
          <Button variant="ghost" size="sm" onClick={() => setConfirmReset(true)}><RotateCcw aria-hidden="true" />{t("reset")}</Button>
        )}
      </div>
      {message ? <p className="dj-type-body-sm" role="status" data-tone={message.tone}>{message.text}</p> : null}
    </section>
  );
}
