/**
 * UI languages. Content is authored per locale too (`L10n`), so adding a
 * locale means a message catalog here and the same key in every L10n field.
 */
export const locales = ["en-US", "zh-CN"] as const;
export type Locale = (typeof locales)[number];

export const defaultLocale: Locale = "en-US";

export function isLocale(value: unknown): value is Locale {
  return typeof value === "string" && (locales as readonly string[]).includes(value);
}

export function isEnglishLocale(locale: Locale): boolean {
  return locale === "en-US";
}

/** The best supported locale for the browser's language list. */
export function resolveBrowserLocale(languages: readonly string[]): Locale {
  for (const tag of languages) {
    if (isLocale(tag)) return tag;
    const lang = tag.split("-")[0]?.toLowerCase();
    const match = locales.find((l) => l.split("-")[0].toLowerCase() === lang);
    if (match) return match;
  }
  return defaultLocale;
}
