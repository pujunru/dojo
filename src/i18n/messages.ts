import type { Locale } from "./config";
import enUS from "./messages/en-US.json";
import zhCN from "./messages/zh-CN.json";

const catalogs: Record<Locale, typeof enUS> = { "en-US": enUS, "zh-CN": zhCN };

export function messagesFor(locale: Locale) {
  return catalogs[locale];
}
