/**
 * Validates content (docs/CONTENT.md).
 *
 *   npm run content:validate [-- --series <id> ...] [--unit <unitId> ...] [--no-exec] [--coverage] [--no-fixtures]
 *
 * Runs per series (`<content>/series/<id>/`), in that series' local id space.
 *
 * 1. Structure: series.json, schema, `dj-` ids unique, exactly one primary KC,
 *    every KC / unit / lesson exists in the series' skill-graph.json (fixture
 *    units bring their own graph.fixture.json), ids are series-local (no
 *    `series:` prefix), archetype and runtime are declared by series.json, the
 *    lesson lists the item type, zh-CN and en-US present for every L10n, size
 *    limits, every test tagged with @kc(...).
 * 2. Execution on CPython through runner/python/dojo_harness.py (what a code
 *    runner executes): reference solutions pass, starters fail, every mustKill / mutant
 *    is killed, fills / orders / fixes pass and wrong ones fail, ladders add a
 *    requirement per level, predict answers are generated, and every verdict
 *    is identical under two hash seeds (five runs for thread code).
 * 3. Coverage against the skill graph (warnings only).
 *
 * Exit 1 on any error. Output names the file and the field at fault.
 */
import os from "node:os";
import path from "node:path";
import {
  allPassed,
  type HarnessOptions,
  type PyFile,
  type RunJob,
  type RunResult,
} from "../src/core/run-protocol.ts";
import { PHASE2_STAND_INS, type DojoItem, type TestMeta } from "../src/core/content-schema.ts";
import { schedulerParams } from "../src/core/series.ts";
import {
  applyPredictAnswer,
  assembleParsons,
  checkStructure,
  fillTemplate,
  formatIssues,
  listSeries,
  loadContent,
  normalizeOutput,
  pool,
  predictJob,
  predictOutcome,
  pythonVersion,
  rel,
  runHarness,
  type Issue,
  type LoadedItem,
} from "./content-loader.ts";

const args = process.argv.slice(2);
const units = args.flatMap((a, i) => (a === "--unit" ? [args[i + 1]] : []));
const onlySeries = args.flatMap((a, i) => (a === "--series" ? [args[i + 1]] : []));
const exec = !args.includes("--no-exec");
const showCoverage = args.includes("--coverage");
const includeFixtures = !args.includes("--no-fixtures");

type Check = {
  label: string;
  job: RunJob;
  /** Returns an error message, or null when the result is as required. */
  expect: (result: RunResult) => string | null;
};

const COMPILE_PROBE: PyFile = { path: "dojo_compile_probe_test.py", content: "def test_compiles():\n    pass\n" };

function describe(result: RunResult): string {
  switch (result.status) {
    case "ok": {
      const failed = result.results.filter((r) => !r.ok).map((r) => {
        if (r.ok) return "";
        if (r.kind === "assert") return `${r.id} (${r.file}:${r.line} ${r.msg.split("\n")[0]})`;
        if (r.kind === "error") return `${r.id} (${r.exc}: ${r.msg.slice(0, 120)})`;
        return `${r.id} (${r.kind})`;
      });
      return `${result.passed}/${result.total} passed${failed.length ? `; failing: ${failed.join(", ")}` : ""}`;
    }
    case "compile_error":
      return `compile error ${result.file}:${result.line} ${result.msg}`;
    case "import_error":
      return `import error ${result.exc}: ${result.msg}${result.frames.length ? ` at ${result.frames.at(-1)?.slice(0, 2).join(":")}` : ""}`;
    case "timeout":
      return `timeout (${result.scope})`;
    case "harness_error":
      return `harness error: ${result.msg}`;
    case "tests_fail_on_reference":
      return `tests fail on the reference files: ${describe(result.base)}`;
    default:
      return JSON.stringify(result).slice(0, 300);
  }
}

const passes = (what: string) => (r: RunResult) => (allPassed(r) ? null : `${what} must pass every test, got ${describe(r)}`);
const fails = (what: string) => (r: RunResult) =>
  r.status === "harness_error" ? describe(r) : allPassed(r) ? `${what} must fail at least one test, but all passed` : null;

function testsJob(files: PyFile[], tests: PyFile, options: HarnessOptions): RunJob {
  return { kind: "tests", files, tests, options };
}

function collectCheck(label: string, files: PyFile[], tests: PyFile, meta: TestMeta[], options: HarnessOptions): Check {
  return {
    label,
    job: { kind: "collect", files, tests, options },
    expect: (r) => {
      if (r.status !== "collected") return `cannot collect ${tests.path}: ${describe(r)}`;
      if (!r.tests.length) return `${tests.path} defines no test_* functions`;
      const want = meta.map((t) => `${t.id}[${t.kcs.join(",")}]`).join(" ");
      const got = r.tests.map((t) => `${t.id}[${t.kcs.join(",")}]`).join(" ");
      if (want !== got) return `test tags differ between the build's reader and the harness:\n    build:   ${want}\n    harness: ${got}`;
      if (r.tests.some((t) => t.async) && !options.asyncTests) return `${tests.path} has async tests but options.asyncTests is false`;
      return null;
    },
  };
}

function compileCheck(label: string, files: PyFile[], options: HarnessOptions): Check {
  return { label, job: testsJob(files, COMPILE_PROBE, options), expect: passes(label) };
}

function changedLines(a: string, b: string): number[] | null {
  const x = a.split("\n");
  const y = b.split("\n");
  if (x.length !== y.length) return null;
  return x.flatMap((line, i) => (line === y[i] ? [] : [i + 1]));
}

/** Every execution check an item needs, plus static warnings. */
function checksFor(loaded: LoadedItem, item: DojoItem, warn: (path: string, message: string) => void, error: (path: string, message: string) => void): Check[] {
  const checks: Check[] = [];
  const clockHint = (tests: PyFile, options: HarnessOptions, where: string) => {
    if (/\bclock\.(advance|set|tick)\b/.test(tests.content) && !options.fakeClock) error(where, "tests drive `clock` but options.fakeClock is false");
  };
  switch (item.type) {
    case "implement":
    case "refactor": {
      const hidden = item.testMeta.filter((t) => t.hidden);
      clockHint(item.tests, item.options, "options");
      checks.push(collectCheck("hidden tests are tagged", item.solution, item.tests, hidden, item.options));
      checks.push({
        label: "reference solution passes the hidden tests",
        job: testsJob(item.solution, item.tests, item.options),
        expect: (r) => {
          const bad = passes("the reference solution")(r);
          if (bad) return bad;
          if (r.status === "ok" && r.ms > item.options.wallMs * 0.25) return `the reference solution takes ${r.ms} ms, over 25% of wallMs ${item.options.wallMs}`;
          return null;
        },
      });
      if (item.visibleTests) {
        const visible = item.testMeta.filter((t) => !t.hidden);
        checks.push(collectCheck("visible tests are tagged", item.solution, item.visibleTests, visible, item.options));
        checks.push({ label: "reference solution passes the visible tests", job: testsJob(item.solution, item.visibleTests, item.options), expect: passes("the reference solution") });
      }
      checks.push({ label: `${item.type === "refactor" ? "baseline" : "starter"} fails the hidden tests`, job: testsJob(item.starter, item.tests, item.options), expect: fails(item.type === "refactor" ? "the baseline" : "the starter") });
      if (!item.mustKill.length) warn("mustKill", "no mustKill implementations: the hidden tests' strength is unchecked");
      else {
        checks.push({
          label: "hidden tests kill every mustKill implementation",
          job: { kind: "mutants", files: item.solution, tests: item.tests, mutants: item.mustKill.map((m) => ({ id: m.id, files: m.files })), options: item.options },
          expect: (r) => {
            if (r.status !== "mutants") return describe(r);
            const alive = r.mutants.filter((m) => !m.killed).map((m) => m.id);
            return alive.length ? `mustKill survived the hidden tests: ${alive.join(", ")}` : null;
          },
        });
      }
      break;
    }
    case "write-tests": {
      const ref = loaded.extras.referenceTests;
      if (!ref) break;
      clockHint(ref, item.options, "options");
      checks.push(compileCheck("test starter imports cleanly", [...item.subject, { ...item.testStarter, path: `dojo_starter_${item.testStarter.path}` }], item.options));
      checks.push({
        label: "reference tests kill every mutant",
        job: { kind: "mutants", files: item.subject, tests: ref, mutants: item.mutants.map((m) => ({ id: m.id, files: m.files })), options: item.options },
        expect: (r) => {
          if (r.status === "tests_fail_on_reference") return `reference tests fail on the subject: ${describe(r.base)}`;
          if (r.status !== "mutants") return describe(r);
          const alive = r.mutants.filter((m) => !m.killed).map((m) => m.id);
          if (alive.length) return `mutants no reference test kills (equivalent mutants are not allowed): ${alive.join(", ")}`;
          return null;
        },
      });
      break;
    }
    case "spot-bug": {
      if (!item.fixStage) break;
      const fix = loaded.extras.fixFiles ?? [];
      const { tests, testMeta, options } = item.fixStage;
      clockHint(tests, options, "fixStage.options");
      checks.push(collectCheck("fix-stage tests are tagged", fix, tests, testMeta, options));
      checks.push({ label: "buggy code fails the fix-stage tests", job: testsJob(item.files, tests, options), expect: fails("the buggy code") });
      checks.push({ label: "fixed code passes the fix-stage tests", job: testsJob(fix, tests, options), expect: passes("the fixed code") });
      for (const bug of item.bugs) {
        const before = item.files.find((f) => f.path === bug.path);
        const after = fix.find((f) => f.path === bug.path);
        if (!before || !after) {
          error("fixStage.fix", `fix/ has no ${bug.path}`);
          continue;
        }
        const changed = changedLines(before.content, after.content);
        if (changed && !changed.some((n) => bug.lines.some((b) => Math.abs(b - n) <= item.tolerance))) {
          error("bugs", `the fix changes ${bug.path} lines ${changed.join(", ") || "none"}, none within tolerance of bug lines ${bug.lines.join(", ")}`);
        }
      }
      break;
    }
    case "fill-blank": {
      const first = Object.fromEntries(item.blanks.map((b) => [b.id, b.accept[0]]));
      if (!item.tests) {
        checks.push(compileCheck("template with accepted fills imports cleanly", fillTemplate(item.template, first), { seed: 0, fakeClock: false, stepBudget: 2_000_000, wallMs: 8_000, asyncTests: false }));
        if (Object.values(loaded.extras.wrongFills ?? {}).some((w) => w.length)) warn("blanks", "wrong fills are only checked when the item has tests");
        break;
      }
      const { tests, testMeta, options } = item.tests;
      clockHint(tests, options, "tests.options");
      checks.push(collectCheck("blank tests are tagged", fillTemplate(item.template, first), tests, testMeta, options));
      for (const blank of item.blanks) {
        for (const accept of blank.accept) {
          checks.push({ label: `blank ${blank.id} = ${JSON.stringify(accept)} passes`, job: testsJob(fillTemplate(item.template, { ...first, [blank.id]: accept }), tests, options), expect: passes(`fill ${JSON.stringify(accept)}`) });
        }
        for (const wrong of loaded.extras.wrongFills?.[blank.id] ?? []) {
          checks.push({ label: `blank ${blank.id} = ${JSON.stringify(wrong)} fails`, job: testsJob(fillTemplate(item.template, { ...first, [blank.id]: wrong }), tests, options), expect: fails(`wrong fill ${JSON.stringify(wrong)}`) });
        }
      }
      break;
    }
    case "parsons": {
      const module = item.module ?? "solution.py";
      const program = (order: string[], swap?: [string, string]) => {
        const lines = swap
          ? item.lines.map((l) => (l.id === swap[0] ? { ...l, code: item.distractors.find((d) => d.id === swap[1])!.code } : l))
          : item.lines;
        return [{ path: module, content: assembleParsons(lines, order) }];
      };
      if (!item.tests) {
        checks.push(compileCheck("assembled solution imports cleanly", program(item.solutions[0]), { seed: 0, fakeClock: false, stepBudget: 2_000_000, wallMs: 8_000, asyncTests: false }));
        break;
      }
      const { tests, testMeta, options } = item.tests;
      clockHint(tests, options, "tests.options");
      checks.push(collectCheck("parsons tests are tagged", program(item.solutions[0]), tests, testMeta, options));
      item.solutions.forEach((order, i) => {
        checks.push({ label: `solution order ${i + 1} passes`, job: testsJob(program(order), tests, options), expect: passes(`solution order ${i + 1}`) });
      });
      for (const [distractor, lineId] of Object.entries(loaded.extras.distractorReplaces ?? {})) {
        const replaced = item.lines.find((l) => l.id === lineId);
        const code = item.distractors.find((d) => d.id === distractor)?.code;
        if (!replaced) {
          error("distractors", `distractor ${distractor} replaces a line that does not exist`);
          continue;
        }
        if (code !== undefined && code.trim() === replaced.code.trim()) {
          error("distractors", `distractor ${distractor} is identical to the line it replaces`);
          continue;
        }
        checks.push({ label: `distractor ${distractor} fails`, job: testsJob(program(item.solutions[0], [lineId, distractor]), tests, options), expect: fails(`distractor ${distractor} in place of its line`) });
      }
      const untargeted = item.distractors.filter((d) => !(d.id in (loaded.extras.distractorReplaces ?? {})));
      if (untargeted.length) warn("distractors", `no "replaces" for ${untargeted.map((d) => d.id).join(", ")}: not proven wrong`);
      break;
    }
    case "predict": {
      checks.push({
        label: "predict answer",
        job: predictJob(item),
        expect: (r) => applyPredictAnswer(loaded, item, predictOutcome(r)),
      });
      break;
    }
    case "ladder": {
      item.levels.forEach((level, k) => {
        clockHint(level.tests, item.options, `levels[${k}]`);
        checks.push(collectCheck(`level ${level.id} tests are tagged`, level.solution, level.tests, level.testMeta, item.options));
        for (let j = 0; j <= k; j++) {
          checks.push({ label: `level ${level.id} solution passes level ${item.levels[j].id}`, job: testsJob(level.solution, item.levels[j].tests, item.options), expect: passes(`level ${level.id}'s solution`) });
        }
        if (k > 0) {
          const prev = item.levels[k - 1];
          checks.push({ label: `level ${prev.id} solution fails level ${level.id}`, job: testsJob(prev.solution, level.tests, item.options), expect: fails(`level ${prev.id}'s solution on level ${level.id}`) });
        } else {
          checks.push({ label: `starter fails level ${level.id}`, job: testsJob(item.starter, level.tests, item.options), expect: fails("the starter") });
        }
      });
      break;
    }
    case "explain":
      if (item.context?.length) checks.push(compileCheck("context code imports cleanly", item.context, { seed: 0, fakeClock: false, stepBudget: 2_000_000, wallMs: 8_000, asyncTests: false }));
      break;
    default:
      break;
  }
  return checks;
}

/** What must be identical across hash seeds / repetitions. */
function signature(result: RunResult): string {
  switch (result.status) {
    case "ok":
      return `ok:${result.results.map((r) => `${r.id}=${r.ok ? "pass" : r.kind}`).join(",")}`;
    case "mutants":
      return `mutants:${result.mutants.map((m) => `${m.id}=${m.killed}`).join(",")}`;
    case "script":
      return `script:${result.timedOut}:${result.exception?.exc ?? ""}:${normalizeOutput(result.stdout)}`;
    case "collected":
      return `collected:${result.tests.map((t) => t.id).join(",")}`;
    case "tests_fail_on_reference":
      return `tfr:${signature(result.base)}`;
    default:
      return result.status;
  }
}

const THREADY = /\b(threading|multiprocessing|concurrent\.futures|ThreadPoolExecutor|ProcessPoolExecutor)\b/;

function codeOf(item: DojoItem): string {
  return JSON.stringify(item);
}

async function main() {
  const started = Date.now();
  const issues: Issue[] = [];
  let itemCount = 0;
  let executed = 0;
  let python = "";
  const coverageLines: string[] = [];
  for (const entry of await listSeries({ includeFixtures })) {
    issues.push(...entry.issues);
    if (!entry.config) continue;
    if (onlySeries.length && !onlySeries.includes(entry.config.id)) continue;
    const r = await validateSeries(entry.config, entry.dir, python);
    python = r.python || python;
    itemCount += r.items;
    executed += r.executed;
    issues.push(...r.issues);
    if (r.coverage) coverageLines.push(r.coverage);
  }

  const errors = issues.filter((i) => i.severity === "error");
  const warnings = issues.filter((i) => i.severity === "warning");
  if (issues.length) console.log(formatIssues([...errors, ...warnings]));
  if (coverageLines.length) console.log(`\n${coverageLines.join("\n")}`);
  const scope = [onlySeries.length ? `series ${onlySeries.join(", ")}` : "", units.length ? `units ${units.join(", ")}` : ""].filter(Boolean).join("; ");
  const summary = `${itemCount} item(s)${scope ? ` in ${scope}` : ""}, ${executed} harness run(s)${python ? ` on CPython ${python}` : exec ? "" : " (execution skipped)"}, ${errors.length} error(s), ${warnings.length} warning(s), ${Date.now() - started} ms`;
  if (errors.length) {
    console.error(`\ncontent:validate FAILED — ${summary}`);
    process.exit(1);
  }
  console.log(`\ncontent:validate ok — ${summary}`);
}

async function validateSeries(series: Parameters<typeof loadContent>[0]["series"], seriesDir: string, knownPython: string) {
  const content = await loadContent({ series, seriesDir, includeFixtures, onlyUnits: units });
  const { items, issues } = checkStructure(content);
  issues.push(...content.issues);

  let python = knownPython;
  let executed = 0;
  if (exec && items.length && !python) {
    try {
      python = await pythonVersion();
    } catch (e) {
      issues.push({ file: "python3", path: "", message: (e as Error).message, severity: "error" });
    }
  }

  if (exec && python) {
    const perItem = await pool(items, Math.max(1, Math.min(8, os.cpus().length)), async ({ loaded, item }) => {
      const file = path.join(loaded.dir, "item.json");
      const found: Issue[] = [];
      const err = (p: string, message: string) => found.push({ file, path: p, message, severity: "error" });
      const warn = (p: string, message: string) => found.push({ file, path: p, message, severity: "warning" });
      const checks = checksFor(loaded, item, warn, err);
      if (!checks.length) return found;
      const runs = THREADY.test(codeOf(item)) ? 5 : 2;
      const signatures: string[][] = [];
      try {
        for (let seed = 0; seed < runs; seed++) {
          const results = await runHarness(checks.map((c) => c.job), { hashSeed: seed });
          signatures.push(results.map(signature));
          if (seed === 0) {
            results.forEach((r, i) => {
              const message = checks[i].expect(r);
              if (message) err(checks[i].label, message);
            });
          }
        }
      } catch (e) {
        err("$", `harness run failed: ${(e as Error).message}`);
        return found;
      }
      checks.forEach((check, i) => {
        const distinct = new Set(signatures.map((s) => s[i]));
        if (distinct.size > 1) err(check.label, `nondeterministic across ${runs} runs (hash seeds 0..${runs - 1}): ${[...distinct].map((s) => s.slice(0, 160)).join("  ≠  ")}`);
      });
      executed += checks.length * runs;
      return found;
    });
    issues.push(...perItem.flat());
  }

  // Coverage (§4.6.3): every KC needs ≥2 items at each of its rung-0–2 types and ≥2 skins.
  const kcs = content.graph.kcs.filter((k) => !k.id.startsWith("_"));
  const rungOf = schedulerParams(series.scheduler).rungOf;
  const gaps: string[] = [];
  let covered = 0;
  for (const kc of kcs) {
    const mine = items.filter(({ item }) => item.kcs.some((r) => r.id === kc.id)).map(({ item }) => item);
    const wanted = kc.itemTypes.filter((t) => rungOf[t] <= 2);
    const count = (t: DojoItem["type"]) => mine.filter((m) => m.type === t).length;
    // A phase-2 type (review, refactor, …) is met by its MVP stand-ins until the player supports it.
    const short = wanted.filter((t) => count(t) + (PHASE2_STAND_INS[t] ?? []).reduce((n, s) => n + count(s), 0) < 2);
    const skins = new Set(mine.map((m) => m.skin)).size;
    if (!short.length && skins >= 2) covered++;
    else gaps.push(`${kc.id}: ${short.length ? `<2 items for ${short.join("/")}` : ""}${short.length && skins < 2 ? "; " : ""}${skins < 2 ? `${skins} skin(s)` : ""}`);
  }

  const coverage = kcs.length
    ? `coverage [${series.id}]: ${covered}/${kcs.length} KCs meet the bar (≥2 items per rung-0–2 type, ≥2 skins)${showCoverage ? `\n${gaps.map((g) => `  - ${g}`).join("\n")}` : " — run with --coverage for the gaps"}`
    : "";
  return { items: items.length, executed, python, issues, coverage };
}

void rel;
await main();
