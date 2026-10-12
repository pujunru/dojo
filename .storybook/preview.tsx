import type { Preview } from "@storybook/react-vite";
import { IntlProvider } from "use-intl";
import { defaultLocale, isLocale, locales, type Locale } from "../src/i18n/config";
import { messagesFor } from "../src/i18n/messages";
import "../src/styles/app.css";

/** The app is mobile-only: stories default to a phone, with a tablet and a desktop for checks. */
export const viewports = {
  "workspace-mobile": { name: "Phone · 390 × 844", styles: { width: "390px", height: "844px" }, type: "mobile" },
  "phone-small": { name: "Small phone · 360 × 740", styles: { width: "360px", height: "740px" }, type: "mobile" },
  tablet: { name: "Tablet · 768 × 1024", styles: { width: "768px", height: "1024px" }, type: "tablet" },
  desktop: { name: "Desktop · 1280 × 800", styles: { width: "1280px", height: "800px" }, type: "desktop" },
} as const;

const LABELS: Record<Locale, string> = { "en-US": "English", "zh-CN": "简体中文" };

const preview: Preview = {
  globalTypes: {
    theme: {
      description: "Color theme",
      toolbar: { title: "Theme", icon: "circlehollow", items: [{ value: "light", title: "Light", icon: "sun" }, { value: "dark", title: "Dark", icon: "moon" }], dynamicTitle: true },
    },
    locale: {
      description: "Locale",
      toolbar: { title: "Locale", icon: "globe", items: locales.map((value) => ({ value, title: LABELS[value] })), dynamicTitle: true },
    },
  },
  initialGlobals: { theme: "light", locale: defaultLocale, viewport: "workspace-mobile" },
  parameters: {
    layout: "fullscreen",
    viewport: { options: viewports },
    a11y: { context: "#storybook-root" },
  },
  decorators: [
    (Story, context) => {
      const mode = context.globals.theme === "dark" ? "dark" : "light";
      const locale: Locale = isLocale(context.globals.locale) ? context.globals.locale : defaultLocale;
      return (
        <IntlProvider locale={locale} messages={messagesFor(locale)} timeZone="UTC">
          <div lang={locale} data-dj-theme={mode} className={`theme-${mode} min-h-dvh text-foreground`}>
            <Story />
          </div>
        </IntlProvider>
      );
    },
  ],
};

export default preview;
