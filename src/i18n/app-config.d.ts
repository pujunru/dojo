import type { Locale } from "./config";
import type messages from "./messages/en-US.json";

declare module "use-intl" {
  interface AppConfig {
    Locale: Locale;
    Messages: typeof messages;
  }
}
