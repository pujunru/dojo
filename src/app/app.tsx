/**
 * The app root: language, the mobile shell and the learner-data panel around
 * the Dojo page. Registering a code runner (see `core/runner.ts`) happens
 * before this renders, in `main.tsx`.
 */
import * as React from "react";
import { IntlProvider, useTranslations } from "use-intl";
import { AppShell, LearnerDataPanel } from "../features";
import { isLocale, locales, resolveBrowserLocale, type Locale } from "../i18n/config";
import { messagesFor } from "../i18n/messages";
import { exportLearnerFile, importLearnerFile, learnerStorageDurable, learnerSummary, resetLearner } from "./api";
import DojoApp from "./dojo-app";

const LOCALE_KEY = "dojo.locale";
const LOCALE_LABELS: Record<Locale, string> = { "en-US": "English", "zh-CN": "中文" };

function initialLocale(): Locale {
  try {
    const saved = window.localStorage.getItem(LOCALE_KEY);
    if (isLocale(saved)) return saved;
  } catch {
    // Storage blocked: fall back to the browser's language.
  }
  return resolveBrowserLocale(navigator.languages ?? [navigator.language]);
}

export function App() {
  const [locale, setLocale] = React.useState<Locale>(initialLocale);
  React.useEffect(() => {
    document.documentElement.lang = locale;
    try {
      window.localStorage.setItem(LOCALE_KEY, locale);
    } catch {
      // Not remembered across visits; harmless.
    }
  }, [locale]);
  return (
    <IntlProvider locale={locale} messages={messagesFor(locale)} timeZone={Intl.DateTimeFormat().resolvedOptions().timeZone}>
      <Shell locale={locale} onLocaleChange={(next) => isLocale(next) && setLocale(next)} />
    </IntlProvider>
  );
}

function Shell({ locale, onLocaleChange }: { locale: Locale; onLocaleChange: (locale: string) => void }) {
  const t = useTranslations("app");
  // Bumped when the learner document is replaced (import / reset): remounts the page.
  const [generation, setGeneration] = React.useState(0);
  const [summary, setSummary] = React.useState({ totalXp: 0, attempts: 0, kcs: 0 });
  const refreshSummary = React.useCallback(() => void learnerSummary().then(setSummary), []);
  React.useEffect(refreshSummary, [refreshSummary, generation]);

  const dataPanel = (
    <LearnerDataPanel
      durable={learnerStorageDurable()}
      summary={summary}
      onExport={async () => {
        const blob = await exportLearnerFile();
        const url = URL.createObjectURL(blob);
        const a = document.createElement("a");
        a.href = url;
        a.download = `dojo-progress-${new Date().toISOString().slice(0, 10)}.json`;
        a.click();
        URL.revokeObjectURL(url);
      }}
      onImport={async (file) => {
        const error = await importLearnerFile(await file.text());
        if (!error) setGeneration((g) => g + 1);
        return error;
      }}
      onReset={async () => {
        await resetLearner();
        setGeneration((g) => g + 1);
      }}
    />
  );

  return (
    <AppShell
      title={t("title")}
      locales={locales.map((id) => ({ id, label: LOCALE_LABELS[id] }))}
      locale={locale}
      onLocaleChange={onLocaleChange}
      dataPanel={dataPanel}
    >
      <DojoApp key={generation} />
    </AppShell>
  );
}
