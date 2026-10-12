/**
 * Message catalogs: every locale has exactly the keys of the default one, no
 * value is empty, and placeholders match across locales.
 *
 *   npm run check:i18n
 */
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { defaultLocale, locales } from "../src/i18n/config.ts";

const dir = path.join(path.dirname(fileURLToPath(import.meta.url)), "..", "src", "i18n", "messages");
type Tree = { [key: string]: string | Tree };

function flatten(tree: Tree, prefix = "", out = new Map<string, string>()) {
  for (const [key, value] of Object.entries(tree)) {
    const full = prefix ? `${prefix}.${key}` : key;
    if (typeof value === "string") out.set(full, value);
    else flatten(value, full, out);
  }
  return out;
}

/** Top-level `{name}` / `{name, plural, …}` arguments of an ICU message. */
function args(message: string): string[] {
  const names = new Set<string>();
  let depth = 0;
  for (let i = 0; i < message.length; i++) {
    if (message[i] === "{") {
      if (depth === 0) {
        const m = /^\{\s*([A-Za-z0-9_]+)/.exec(message.slice(i));
        if (m) names.add(m[1]);
      }
      depth += 1;
    } else if (message[i] === "}") depth -= 1;
  }
  return [...names].sort();
}

const catalogs = new Map(locales.map((l) => [l, flatten(JSON.parse(readFileSync(path.join(dir, `${l}.json`), "utf8")) as Tree)]));
const base = catalogs.get(defaultLocale)!;
const problems: string[] = [];
for (const [locale, cat] of catalogs) {
  for (const key of base.keys()) if (!cat.has(key)) problems.push(`${locale}: missing ${key}`);
  for (const [key, value] of cat) {
    if (!base.has(key)) problems.push(`${locale}: extra ${key}`);
    if (!value.trim()) problems.push(`${locale}: empty ${key}`);
    const expected = base.get(key);
    if (expected !== undefined && args(expected).join() !== args(value).join()) problems.push(`${locale}: ${key} uses {${args(value)}} but ${defaultLocale} uses {${args(expected)}}`);
  }
}
if (problems.length) {
  console.error(problems.join("\n"));
  console.error(`\ncheck:i18n failed: ${problems.length} problem(s).`);
  process.exit(1);
}
console.log(`check:i18n ok — ${base.size} keys × ${locales.length} locales`);
