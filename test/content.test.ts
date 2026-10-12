/**
 * The content pipeline: schema normalisers, skill-graph validation, the
 * authoring loader, and the build and validator CLIs.
 *
 * The CLI cases execute Python through the harness, so they need python3 >= 3.12.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { execFileSync, spawnSync } from "node:child_process";
import { cpSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import {
  parseDojoItem,
  primaryKc,
  toIndexRow,
  type DojoItem,
  type DojoUnitBundle,
} from "../src/core/content-schema.ts";
import { validateSkillGraph } from "../src/core/skill-graph.ts";
import {
  extractTestMeta,
  fillTemplate,
  listSeries,
  loadContent,
  stableShuffle,
  checkStructure,
} from "../scripts/content-loader.ts";

const repoRoot = path.join(import.meta.dirname, "..");
const nodeArgs = ["--no-warnings", "--experimental-strip-types", "--import", "./scripts/ts-resolve-register.mjs"];

const ZH = "zh-CN";
const EN = "en-US";
const L = (zh: string, en: string) => ({ [ZH]: zh, [EN]: en });

function baseItem(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    id: "dj-test-choose",
    version: 1,
    type: "choose-design",
    unit: "u-test",
    lesson: "l-test",
    kcs: [{ id: "kc-a", weight: 1 }],
    archetype: "python-core",
    skin: "bank",
    difficulty: 2,
    estSeconds: 60,
    runtime: "none",
    prompt: L("题", "Prompt"),
    explanation: L("解", "Explanation"),
    hints: [],
    scenario: L("场景", "Scenario"),
    options: [
      { id: "a", text: L("甲", "A"), correct: true, why: L("因为", "Because") },
      { id: "b", text: L("乙", "B"), correct: false, why: L("因为", "Because") },
    ],
    multi: false,
    ...overrides,
  };
}

function errorsOf(value: unknown): string[] {
  const parsed = parseDojoItem(value);
  return parsed.ok ? [] : parsed.errors.map((e) => `${e.path}: ${e.message}`);
}

/* ───────────── schema ───────────── */

test("a well-formed item parses and yields its index row", () => {
  const parsed = parseDojoItem(baseItem({ variantGroup: "vg-1", kcs: [{ id: "kc-a", weight: 1 }, { id: "kc-b", weight: 0.5 }] }));
  assert.ok(parsed.ok, JSON.stringify(parsed));
  const item = (parsed as { item: DojoItem }).item;
  assert.equal(primaryKc(item), "kc-a");
  const row = toIndexRow(item);
  assert.equal(row.id, "dj-test-choose");
  assert.deepEqual(row.kcs, item.kcs);
});

test("a rubric criterion may declare forbidden phrases", () => {
  const rubric = { passAt: 0.6, criteria: [{ id: "no-bleu", kcs: ["kc-a"], weight: 1, description: L("不用 BLEU", "No BLEU"), forbidden: ["BLEU"] }] };
  const parsed = parseDojoItem(baseItem({ type: "explain", question: L("问", "Q"), modelAnswer: L("答", "A"), rubric }));
  assert.ok(parsed.ok, JSON.stringify(parsed));
  assert.ok(errorsOf(baseItem({ type: "explain", question: L("问", "Q"), modelAnswer: L("答", "A"), rubric: { ...rubric, criteria: [{ ...rubric.criteria[0], forbidden: [] }] } }))
    .some((e) => /forbidden/.test(e)));
});

test("schema errors name the field", () => {
  assert.ok(errorsOf(baseItem({ id: "px-wrong-prefix" })).some((e) => e.startsWith("id:")));
  assert.ok(errorsOf(baseItem({ prompt: { [ZH]: "只有中文" } })).includes(`prompt.${EN}: missing translation`));
  assert.ok(errorsOf(baseItem({ kcs: [{ id: "kc-a", weight: 1 }, { id: "kc-b", weight: 1 }] })).some((e) => /exactly one KC/.test(e)));
  assert.ok(errorsOf(baseItem({ runtime: "browser" })).some((e) => e.startsWith("runtime:")));
  assert.ok(errorsOf(baseItem({ runtime: "sandbox:python" })).some((e) => /nothing to execute/.test(e)));
  assert.ok(errorsOf(baseItem({ options: [{ id: "a", text: L("甲", "A"), correct: false, why: L("x", "x") }, { id: "b", text: L("乙", "B"), correct: false, why: L("x", "x") }] }))
    .some((e) => /at least one option/.test(e)));
  assert.ok(errorsOf(baseItem({ prompt: { [ZH]: "a", [EN]: "b", fr: "c" } })).includes("prompt.fr: unsupported locale"));
});

test("type-specific invariants are enforced", () => {
  const fill = baseItem({
    type: "fill-blank",
    template: [{ path: "a.py", content: "x = # __BLANK:one__\n" }],
    blanks: [{ id: "two", accept: ["1"], kcs: ["kc-a"] }],
  });
  const fillErrors = errorsOf(fill);
  assert.ok(fillErrors.some((e) => /blank two has no/.test(e)));
  assert.ok(fillErrors.some((e) => /marker one is not declared/.test(e)));

  const parsons = baseItem({
    type: "parsons",
    lines: [{ id: "a", code: "x = 1", indent: 0 }, { id: "b", code: "y = 2", indent: 0 }],
    solutions: [["a"]],
    distractors: [],
    requireIndent: true,
  });
  assert.ok(errorsOf(parsons).some((e) => /permutation/.test(e)));

  const implement = baseItem({
    type: "implement",
    runtime: "sandbox:python",
    starter: [{ path: "a.py", content: "" }],
    solution: [{ path: "a.py", content: "" }],
    tests: { path: "tests.py", content: "" },
    testMeta: [{ id: "test_x", kcs: ["kc-zzz"], hidden: true }],
    mustKill: [],
    options: { seed: 0, fakeClock: false, stepBudget: 1000, wallMs: 1000, asyncTests: false },
  });
  assert.ok(errorsOf(implement).some((e) => /KC kc-zzz is not listed/.test(e)));

  const spot = baseItem({
    type: "spot-bug",
    files: [{ path: "a.py", content: "x = 1\n" }],
    bugs: [{ path: "a.py", lines: [40], kcs: ["kc-a"] }],
    tolerance: 1,
  });
  assert.ok(errorsOf(spot).some((e) => /beyond end of a.py/.test(e)));
});

/* ───────────── skill graph ───────────── */

test("skill graph errors: dangling references, duplicates, cycles", () => {
  const { graph, issues } = validateSkillGraph({
    version: 1,
    tiers: [{ id: "t", title_zh: "层", title_en: "Tier", order: 0 }],
    units: [{
      id: "u", tier: "t-missing", order: 1, title_zh: "单元", title_en: "Unit", goal_zh: "", prereqUnits: ["u-missing"], kcs: ["a"],
      lessons: [{ id: "l", title_zh: "课", title_en: "Lesson", minutes: 5, kcs: ["a"], itemTypes: ["predict", "quiz"] }],
      checkpoint: null, exit: [],
    }],
    kcs: [
      { id: "a", title_zh: "甲", title_en: "A", area: "x", prereqs: ["b"], itemTypes: ["predict"], payoff: [] },
      { id: "b", title_zh: "乙", title_en: "B", area: "x", prereqs: ["a"], itemTypes: ["predict"], payoff: [] },
      { id: "b", title_zh: "乙", title_en: "B", area: "x", prereqs: [], itemTypes: ["predict"], payoff: [] },
    ],
    coverage: [],
  });
  assert.equal(graph, null);
  const text = issues.map((i) => `${i.path}: ${i.message}`).join("\n");
  assert.match(text, /unknown tier t-missing/);
  assert.match(text, /unknown unit u-missing/);
  assert.match(text, /unknown item type quiz/);
  assert.match(text, /duplicate KC b/);
  assert.match(text, /prerequisite cycle/);
});

/* ───────────── authoring loader ───────────── */

test("@kc tags are read from test files", () => {
  const meta = extractTestMeta(`from dojo import kc

@kc("a", 'b')
def test_one():
    pass

def test_untagged():
    pass

@kc("c")  # trailing comment
async def test_async(clock):
    pass

def helper_test_not_collected():
    pass
`, true);
  assert.deepEqual(meta, [
    { id: "test_one", kcs: ["a", "b"], hidden: true },
    { id: "test_untagged", kcs: [], hidden: true },
    { id: "test_async", kcs: ["c"], hidden: true },
  ]);
});

test("parsons shuffles never equal the answer and fills replace markers", () => {
  for (let n = 2; n < 8; n++) {
    const items = Array.from({ length: n }, (_, i) => i);
    for (const seed of ["a", "b", "c", "dj-x"]) assert.notDeepEqual(stableShuffle(items, seed), items);
  }
  assert.deepEqual(fillTemplate([{ path: "a.py", content: "x = # __BLANK:v__\ny = 2\n" }], { v: "1" }), [{ path: "a.py", content: "x = 1\ny = 2\n" }]);
});

test("the sample unit loads and passes structural checks", async () => {
  const sample = (await listSeries({ includeFixtures: true })).find((s) => s.config?.id === "_sample")!;
  const content = await loadContent({ series: sample.config!, seriesDir: sample.dir, includeFixtures: true, onlyUnits: ["_sample"] });
  const { items, issues } = checkStructure(content);
  assert.deepEqual(issues.filter((i) => i.severity === "error"), []);
  assert.deepEqual(
    items.map(({ item }) => item.type).sort(),
    ["choose-design", "explain", "fill-blank", "implement", "parsons", "predict", "spot-bug"],
  );
  const parsons = items.find(({ item }) => item.type === "parsons")!.item as Extract<DojoItem, { type: "parsons" }>;
  assert.notDeepEqual(parsons.lines.map((l) => l.id), parsons.solutions[0]);
});

test("items sit in a lesson that teaches their primary KC; lesson sizes and secondary KCs are checked", () => {
  const lesson = (id: string, kcs: string[]) => ({ id, title_zh: id, title_en: id, minutes: 5, kcs, itemTypes: ["choose-design"] });
  const kc = (id: string) => ({ id, title_zh: id, title_en: id, area: "py", prereqs: [], itemTypes: ["choose-design"], payoff: [] });
  const unit = (id: string, kcs: string[], lessons: ReturnType<typeof lesson>[]) => ({
    id, tier: "t0", order: 1, title_zh: id, title_en: id, goal_zh: "", prereqUnits: [], kcs, lessons, checkpoint: null, exit: [],
  });
  const graph = {
    version: 1,
    tiers: [{ id: "t0", title_zh: "t0", title_en: "t0", order: 0 }],
    units: [unit("u-a", ["kc-a", "kc-b"], [lesson("l-a1", ["kc-a"]), lesson("l-a2", ["kc-b"])]), unit("u-b", ["kc-c"], [lesson("l-b1", ["kc-c"])])],
    kcs: [kc("kc-a"), kc("kc-b"), kc("kc-c")],
    coverage: [],
  };
  const loaded = (id: string, lessonId: string, kcs: unknown[]) => ({
    dir: `/tmp/u-a/${id}`, unit: "u-a", fixture: false, extras: {},
    raw: baseItem({ id: `dj-${id}`, unit: "u-a", lesson: lessonId, kcs }),
  });
  const { issues } = checkStructure({
    series: { id: "demo", order: 1, title_zh: "t", title_en: "t", archetypes: ["stateful-time", "python-core"], runtimes: ["none", "sandbox:python"] },
    seriesDir: "/tmp/series/demo",
    graph,
    graphPresent: true,
    issues: [],
    items: [
      loaded("misfiled", "l-a2", [{ id: "kc-a", weight: 1 }]),
      loaded("later-secondary", "l-a1", [{ id: "kc-a", weight: 1 }, { id: "kc-c", weight: 0.5 }]),
    ],
  } as unknown as Parameters<typeof checkStructure>[0]);
  const text = issues.map((i) => `${i.severity} ${i.path}: ${i.message}`);
  assert.ok(text.some((t) => /^error lesson: lesson l-a2 does not teach the primary KC kc-a .*use l-a1/.test(t)), text.join("\n"));
  assert.ok(text.some((t) => /^warning kcs\[1\]\.id: secondary KC kc-c is taught in u-b/.test(t)), text.join("\n"));
  assert.ok(text.some((t) => /^warning l-a1: lesson has 1 item\(s\); want 4–10/.test(t)), text.join("\n"));
  assert.equal(issues.filter((i) => i.severity === "error").length, 1, text.join("\n"));
});

/* ───────────── CLIs (execute Python) ───────────── */

function python312(): boolean {
  const out = spawnSync("python3", ["-c", "import sys; print(sys.version_info >= (3, 12))"], { encoding: "utf8" });
  return out.stdout.trim() === "True";
}

test("content:validate passes on the sample unit and names each broken check", { skip: !python312() }, () => {
  const ok = spawnSync(process.execPath, [...nodeArgs, "scripts/validate-content.ts", "--series", "_sample", "--unit", "_sample"], { cwd: repoRoot, encoding: "utf8" });
  assert.equal(ok.status, 0, ok.stdout + ok.stderr);
  assert.match(ok.stdout, /content:validate ok — 7 item\(s\)/);

  const scratch = mkdtempSync(path.join(os.tmpdir(), "dojo-content-test-"));
  try {
    const seriesDir = path.join(scratch, "series", "_sample");
    cpSync(path.join(repoRoot, "content", "series", "_sample"), seriesDir, { recursive: true });
    const unit = path.join(seriesDir, "units", "_sample");
    // A reference solution that is itself wrong.
    cpSync(path.join(unit, "implement-ttl-cache/mustKill/off-by-one/cache.py"), path.join(unit, "implement-ttl-cache/solution/cache.py"));
    // A predict program whose output depends on the hash seed.
    writeFileSync(path.join(unit, "predict-word-count/code/main.py"), "print({'a', 'b', 'c', 'd', 'e'})\n");
    // A blank whose "wrong" fill is in fact accepted by the tests.
    const fillJson = path.join(unit, "fill-ttl-boundary/item.json");
    writeFileSync(fillJson, readFileSync(fillJson, "utf8").replace('"wrong": ["time.monotonic() > expires_at", ', '"wrong": ["time.monotonic() >= expires_at", '));
    // An untagged test.
    const spotTests = path.join(unit, "spot-bug-mutable-default/tests.py");
    writeFileSync(spotTests, readFileSync(spotTests, "utf8").replace('@kc("_sample-mutable-default")\n', ""));

    const bad = spawnSync(process.execPath, [...nodeArgs, "scripts/validate-content.ts", "--series", "_sample", "--unit", "_sample"], {
      cwd: repoRoot,
      encoding: "utf8",
      env: { ...process.env, DOJO_CONTENT_DIR: scratch },
    });
    assert.equal(bad.status, 1, bad.stdout + bad.stderr);
    const out = bad.stdout;
    assert.match(out, /implement-ttl-cache\/item\.json › reference solution passes the hidden tests: .*test_expires_exactly_at_ttl/);
    assert.match(out, /predict-word-count\/item\.json › predict answer: nondeterministic/);
    assert.match(out, /fill-ttl-boundary\/item\.json › blank expired = "time\.monotonic\(\) >= expires_at" fails/);
    assert.match(out, /spot-bug-mutable-default\/item\.json › fixStage\.testMeta\[0\]\.kcs/);
  } finally {
    rmSync(scratch, { recursive: true, force: true });
  }
});

test("content:build writes a content-addressed bundle with generated predict answers", { skip: !python312() }, () => {
  const out = mkdtempSync(path.join(os.tmpdir(), "dojo-build-test-"));
  try {
    execFileSync(process.execPath, [...nodeArgs, "scripts/build-content.ts", "--include-fixtures", "--out", out], { cwd: repoRoot, stdio: "pipe" });
    const pointer = JSON.parse(readFileSync(path.join(out, "current.json"), "utf8"));
    assert.match(pointer.hash, /^[0-9a-f]{12}$/);
    assert.deepEqual(pointer.series.map((s: { id: string }) => s.id).sort(), ["_demo", "_sample"]);
    const manifest = JSON.parse(readFileSync(path.join(out, pointer.hash, "series", "_sample", "manifest.json"), "utf8"));
    assert.equal(manifest.contentHash, pointer.hash);
    assert.equal(manifest.series.id, "_sample");
    // Ids are qualified with the series in everything the build ships.
    assert.ok(manifest.items.some((row: { unit: string }) => row.unit === "_sample:_sample"));
    assert.ok(manifest.items.every((row: { id: string; kcs: { id: string }[] }) => row.id.startsWith("dj-_sample-") && row.kcs.every((k) => k.id.startsWith("_sample:"))));
    const bundle = JSON.parse(readFileSync(path.join(out, pointer.hash, "series", "_sample", "units", "_sample.json"), "utf8")) as DojoUnitBundle;
    const predict = bundle.items.find((i) => i.type === "predict") as Extract<DojoItem, { type: "predict" }>;
    assert.equal(predict.answer.mode, "choice");
    if (predict.answer.mode === "choice") {
      assert.equal(predict.answer.options[predict.answer.correct], "[('a', 3), ('b', 2), ('c', 1)]\naaa");
    }
    for (const item of bundle.items) assert.ok(parseDojoItem(item).ok, item.id);
    // Validator-only data never ships.
    const raw = readFileSync(path.join(out, pointer.hash, "series", "_sample", "units", "_sample.json"), "utf8");
    assert.doesNotMatch(raw, /"wrong"|"distractors":\["\[/);
    // Without --include-fixtures nothing ships, and the app says so.
    const empty = mkdtempSync(path.join(os.tmpdir(), "dojo-build-empty-"));
    execFileSync(process.execPath, [...nodeArgs, "scripts/build-content.ts", "--out", empty], { cwd: repoRoot, stdio: "pipe" });
    assert.deepEqual(JSON.parse(readFileSync(path.join(empty, "current.json"), "utf8")).series, []);
    rmSync(empty, { recursive: true, force: true });
  } finally {
    rmSync(out, { recursive: true, force: true });
  }
});
