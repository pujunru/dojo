/**
 * Builds the content bundle the app fetches (docs/CONTENT.md).
 *
 *   npm run content:build [-- --include-fixtures] [--out <dir>]
 *
 * Reads every series under <content>/series/<id>/ (series.json,
 * skill-graph.json, units/**; <content> is $DOJO_CONTENT_DIR or ./content),
 * checks structure per series in its local id space, generates predict
 * answers on CPython through the harness, qualifies every id with its series,
 * then writes:
 *
 *   public/content/<hash>/series/<id>/manifest.json
 *   public/content/<hash>/series/<id>/units/<local unit id>.json
 *   public/content/current.json        (hash + series list)
 *
 * Fixture series (`series/_*`) and fixture units (`units/_*`) are excluded
 * unless --include-fixtures. Execution checks beyond predict generation live
 * in `content:validate`.
 */
import { createHash } from "node:crypto";
import { promises as fs } from "node:fs";
import path from "node:path";
import {
  DOJO_SCHEMA_VERSION,
  toIndexRow,
  type DojoContentPointer,
  type DojoItem,
  type DojoManifest,
  type DojoUnitBundle,
} from "../src/core/content-schema.ts";
import {
  checkStructure,
  formatIssues,
  generatePredictAnswers,
  listSeries,
  loadContent,
  qualifyGraph,
  qualifyItem,
  rel,
  REPO_ROOT,
  type Issue,
} from "./content-loader.ts";
import { localRef, seriesSummary, type SeriesConfig } from "../src/core/series.ts";
import type { SkillGraph } from "../src/core/skill-graph.ts";

const args = process.argv.slice(2);
const includeFixtures = args.includes("--include-fixtures");
const outRoot = args.includes("--out")
  ? path.resolve(args[args.indexOf("--out") + 1])
  : path.join(REPO_ROOT, "public", "content");

/** Stable JSON: keys sorted, so the hash depends on content, not insertion order. */
function stable(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(stable);
  if (value && typeof value === "object") {
    return Object.fromEntries(Object.keys(value as object).sort().map((k) => [k, stable((value as Record<string, unknown>)[k])]));
  }
  return value;
}

type BuiltSeries = { config: SeriesConfig; graph: SkillGraph; byUnit: Map<string, DojoItem[]> };

async function main() {
  const started = Date.now();
  const issues: Issue[] = [];
  const built: BuiltSeries[] = [];
  for (const entry of await listSeries({ includeFixtures })) {
    issues.push(...entry.issues);
    if (!entry.config) continue;
    const content = await loadContent({ series: entry.config, seriesDir: entry.dir, includeFixtures });
    const checked = checkStructure(content);
    issues.push(...checked.issues, ...content.issues);
    issues.push(...(await generatePredictAnswers(checked.items)));
    const byUnit = new Map<string, DojoItem[]>();
    for (const { item } of checked.items) {
      const q = qualifyItem(entry.config.id, item);
      byUnit.set(q.unit, [...(byUnit.get(q.unit) ?? []), q]);
    }
    for (const list of byUnit.values()) list.sort((a, b) => a.id.localeCompare(b.id));
    built.push({ config: entry.config, graph: qualifyGraph(entry.config.id, content.graph), byUnit });
  }

  const errors = issues.filter((i) => i.severity === "error");
  if (issues.length) console.log(formatIssues(issues));
  if (errors.length) {
    console.error(`\ncontent:build failed: ${errors.length} error(s).`);
    process.exit(1);
  }

  // Hash = sha256 over every series' config, graph and unit bodies.
  const hasher = createHash("sha256");
  for (const b of built) {
    hasher.update(JSON.stringify(stable(b.config)));
    hasher.update(JSON.stringify(stable(b.graph)));
    for (const unit of [...b.byUnit.keys()].sort()) hasher.update(JSON.stringify(stable(b.byUnit.get(unit))));
  }
  const contentHash = hasher.digest("hex").slice(0, 12);

  await fs.rm(outRoot, { recursive: true, force: true });
  const dir = path.join(outRoot, contentHash);
  let unitBytes = 0;
  const allItems: DojoItem[] = [];
  for (const b of built) {
    const seriesDir = path.join(dir, "series", b.config.id);
    await fs.mkdir(path.join(seriesDir, "units"), { recursive: true });
    const items = [...b.byUnit.values()].flat();
    allItems.push(...items);
    const manifest: DojoManifest = {
      contentHash,
      schemaVersion: DOJO_SCHEMA_VERSION,
      series: b.config,
      graph: b.graph,
      items: items.map(toIndexRow),
    };
    await fs.writeFile(path.join(seriesDir, "manifest.json"), JSON.stringify(manifest));
    for (const [unit, list] of b.byUnit) {
      const bundle: DojoUnitBundle = { contentHash, schemaVersion: DOJO_SCHEMA_VERSION, series: b.config.id, unit, items: list };
      const body = JSON.stringify(bundle);
      unitBytes += body.length;
      if (body.length > 5 * 1024 * 1024) throw new Error(`unit ${unit} bundle is ${body.length} bytes; split the unit`);
      // File named by the series-local unit id: no ":" in static asset paths.
      await fs.writeFile(path.join(seriesDir, "units", `${localRef(unit)}.json`), body);
    }
  }
  const pointer: DojoContentPointer = {
    hash: contentHash,
    schemaVersion: DOJO_SCHEMA_VERSION,
    series: built.map((b) => seriesSummary(b.config)),
  };
  await fs.mkdir(outRoot, { recursive: true });
  await fs.writeFile(path.join(outRoot, "current.json"), JSON.stringify(pointer));

  console.log(
    `content:build ok — ${allItems.length} item(s) in ${built.length} series ` +
      `(${built.map((b) => `${b.config.id}: ${[...b.byUnit.values()].flat().length}`).join(", ")})` +
      `${includeFixtures ? " (fixtures included)" : ""}, hash ${contentHash}, ` +
      `${(unitBytes / 1024).toFixed(1)} KB of unit JSON → ${rel(dir)}` +
      ` (${Date.now() - started} ms)`,
  );
}

await main();
