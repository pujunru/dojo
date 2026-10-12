---
name: dojo-i18n
description: Add, change or review user-visible copy in Dojo (UI strings, accessibility labels, number/date/plural formatting, locale handling) and keep the English and Chinese catalogs in sync. Use whenever a change touches text the learner sees, adds a locale, or formats a value for display.
---

# Dojo i18n

Dojo's UI copy is in `src/i18n/messages/<locale>.json` (`en-US` is the default
and the type source; `zh-CN` must match it key for key). Content prose is
bilingual in the content itself (`L10n` fields, see `docs/CONTENT.md`), not in
the catalogs.

## Rules

- **No literal UI strings in components.** Every visible string, `aria-label`,
  `title` and placeholder comes from `useTranslations("<namespace>")`
  (`use-intl`). Components receive data, never pre-translated sentences from
  the app, unless the prop is explicitly content (item prompts, titles).
- **Namespaces**: `dojo.*` for feature components (`src/features`), `app.*`
  for the page and its errors (`src/app`), `shell.*` for the app shell and the
  learner-data panel. Add keys next to their siblings.
- **ICU messages** for anything variable: `{count, plural, one {# answer}
  other {# answers}}`, `{name}`. Never concatenate translated fragments; never
  build plurals in code. Chinese uses `{count, plural, other {…}}`.
- **Format with the formatter**: `useFormatter()` for numbers, percents,
  lists, dates and relative time. Never `toFixed` or string-glue for display.
- **Data stays data**: code, identifiers, test ids, file names and program
  output are shown as-is (wrap in `translate="no"` where relevant) in both
  languages.
- **Write each language natively.** Don't translate word for word; keep
  technical terms in English inside Chinese where an engineer would.
- **Errors are codes.** The store and the data layer return stable codes
  (`NETWORK`, `STORAGE`, …); the app maps them through `app.errors.<CODE>`.

## Adding a locale

1. Add it to `locales` in `src/i18n/config.ts` and a label in `src/app/app.tsx`.
2. Copy `en-US.json` to `<locale>.json` and translate every value.
3. Add the catalog to `src/i18n/messages.ts` and the Storybook locale toolbar
   picks it up from `locales`.
4. Content: every `L10n` field needs the new key; the content schema rejects
   items that miss it (see `LIMITS` and `l10n()` in `src/core/content-schema.ts`).

## Verify

```sh
npm run check:i18n     # same keys, no empty values, matching placeholders
npm run typecheck      # keys are typed from en-US.json
```

Then look at the changed component in Storybook in both locales at 360 px:
Chinese and English differ in length a lot, and nothing may clip or overlap.
