# Writing content

Dojo ships no curriculum. You bring it: a **series** is an independent
curriculum (Python drills, ML eval design, system design, …) with its own
skill graph and items. All series share one engine and one learner profile
(XP, streak and daily goal are global).

Each item is a directory with an `item.json` (metadata and bilingual prose)
plus, for code items, real `.py` files that CPython runs during validation.

```sh
npm run content:validate                      # every check below, every series; must be green
npm run content:validate -- --series evals    # one series (add --unit <id> for one unit)
npm run content:validate -- --coverage        # also list KCs that still lack items
npm run content:build                         # bundle → public/content/<hash>/series/<id>/
npm run dev                                   # builds and starts the app (dev:demo adds the fixtures)
```

Content lives in `content/series/<id>/` by default. Point `DOJO_CONTENT_DIR`
at another directory (for example a private content repository checked out
next to this one) to build from there instead:

```sh
DOJO_CONTENT_DIR=../my-content npm run content:build
```

The design behind the scheduler and grading is in `docs/ARCHITECTURE.md`.

## 0. Series

```
content/series/<id>/
  series.json         id, titles, archetypes, runtimes, scheduler overrides
  skill-graph.json    tiers → units → lessons → KCs (series-local ids)
  units/<unitId>/<item-slug>/item.json
```

**Ids are series-local in every source file.** Write `dj-dict-get-default`,
`py-dict-idioms`, `u-py-fluency`. The build qualifies them with the series:
items become `dj-<series>-<local>`, KCs / units / lessons / tiers become
`<series>:<local>`, and only qualified ids reach bundles and the learner's
stored progress. A source file containing `series:` is rejected: an item can
only reference its own series' graph.

`series.json` (validated by `parseSeriesConfig` in `src/core/series.ts`):

| field | meaning |
|---|---|
| `id` | `^[a-z][a-z0-9]{1,15}$`, equal to the directory name. `_<id>` = fixture series (validated, built only with `--include-fixtures`). |
| `order`, `title_zh`, `title_en`, `description_zh/en` | Shown in the series switcher. |
| `archetypes` | The archetype ids items may declare (`item.archetype` must be one). Free-form: name the problem families of your curriculum. |
| `runtimes` | Which runtimes items may use: `"none"` (always; graded in the browser) and `"sandbox:python"` (graded by running hidden tests through a code runner, see `core/runner.ts`). |
| `sandboxRuntime` | What an item's `"runtime": "sandbox"` means in this series (`"sandbox:python"`). |
| `scheduler` | Optional overrides of the learner model: `rungOf` (item type → production rung 0–5), `gainOf` (half-life growth per type), `capBelowProductionDays`, `capBelowExtensionDays`, `maxComposedRung`. Defaults: `DEFAULT_SCHEDULER` in `src/core/series.ts`. A discussion series typically raises `explain` to rung 2. |

### Adding a series

1. `mkdir -p content/series/<id>/units` and write `series.json`.
2. Write `skill-graph.json` (shape: `src/core/skill-graph.ts`; series-local ids).
3. Author items under `units/<unitId>/`; item types whose runtime the series
   does not declare are rejected (no `implement` without `sandbox:python`).
4. `npm run content:validate -- --series <id> --coverage` until green.
5. `npm run content:build`: the series appears in `content/current.json` and in
   the app's series switcher.

Two fixture series show the format end to end: `series/_demo/` (eval design:
choose-design, explain and staged cases, all runtime `none`) and
`series/_sample/` (one item of every code type, validated on CPython). They are
built only with `--include-fixtures` (`npm run dev:demo` and `npm run build:demo`
pass it).

## 1. Where things go

```
content/series/<series>/units/<unitId>/<item-slug>/item.json
```

- `<unitId>` is a unit id from the series' skill-graph.json. The item's `unit`
  is taken from this directory; you may omit it in item.json.
- `<item-slug>` is free-form (kebab-case, e.g. `predict-dict-get-default`).
- Units whose directory starts with `_` are **fixtures**. They bring their own
  `graph.fixture.json`, are always validated, and are built only with
  `--include-fixtures`.

### File-set references

Wherever item.json names code, the value is a path relative to the item
directory:

- a **directory** → every file below it, with paths relative to that directory
  (`"starter"` holding `starter/cache.py` becomes the file `cache.py`);
- a **single file** → that file, under its basename;
- a **list** of either.

Most fields have a default, listed per type below, so a directory laid out by
convention needs no paths in item.json at all.

## 2. Fields every item has

| field | meaning |
|---|---|
| `id` | `dj-` + lowercase/digits/dashes, 3–80 chars after the prefix, unique across all units. Never reuse an id; never change one that has shipped. |
| `version` | Integer ≥ 1. Bump it when the item's meaning changes (attempts record it). |
| `type` | `predict` `spot-bug` `fill-blank` `parsons` `choose-design` `explain` `case` (graded in the browser), `implement` `refactor` `write-tests` `ladder` (need a code runner), `review`. |
| `lesson` | A lesson id **of this unit** that **teaches the item's primary KC** (the KC is in the lesson's `kcs`) and whose `itemTypes` includes this type. See §2.1. |
| `kcs` | `[{ "id": "<kc>", "weight": 1 }, { "id": "<kc>", "weight": 0.5 }]` — exactly one primary (`1`), at most three secondary (`0.5`). Every KC must exist in the graph. Any KC used further down (test tags, blanks, bugs, rubric criteria) must be listed here. Secondary KCs must be taught in this unit or one of its prerequisite units (`prereqUnits`, transitively): the learner cannot be credited for a skill the path has not reached yet. |
| `archetype` | One of the archetypes `series.json` declares. |
| `skin` | The surface story (`bank`, `gpu-ledger`, `crawler`, …). Same KC, different skin = the same skeleton in new clothes; the scheduler swaps skins on review, so give each KC at least two. |
| `variantGroup` | Optional. Items that are the same question re-worded share it and never appear in one session together. |
| `difficulty` | 1–5 within the unit. |
| `estSeconds` | How long a fluent candidate needs. Be honest; it drives the fluency grade. |
| `runtime` | `"none"` (nothing executes while answering) or `"sandbox"` (graded by a code runner). `implement`/`refactor`/`write-tests`/`ladder` must be `sandbox`; `spot-bug`/`fill-blank`/`parsons` are `sandbox` exactly when they carry tests; the rest are `none`. |
| `prompt`, `explanation` | Bilingual Markdown (see §6). The explanation is always shown after answering, right or wrong. |
| `hints` | Ordered list of bilingual hints, at most 5. Nudge, never give the answer. |


### 2.1 Lessons, primary KCs and lesson size

The composer builds a lesson session from the items of the KCs the lesson
teaches, so an item filed under a lesson that does not teach its primary KC is
invisible there and pads the wrong lesson. The rules the validator enforces:

- **Error:** the item's `lesson` does not list its primary KC. The message names
  the lesson(s) of the unit that do. If no lesson of the unit teaches the KC,
  either move the item directory to the unit that does (ids are global, so a
  move never changes the id) or, when it is honest, make a KC that this unit
  teaches the primary one.
- **Warning:** a lesson holds fewer than 4 or more than 10 items. Rebalance by
  moving items to the sibling lesson that also teaches their primary KC; if a
  lesson is overloaded because it teaches two KCs, split it in the curriculum
  (`skill-graph.json`). Never delete a good item to make the numbers fit.
- **Warning:** a secondary KC is taught only in a later or unrelated unit.

A lesson's `itemTypes` lists the types it accepts. Some types may stand in for
a harder one in coverage counts (`PHASE2_STAND_INS` in
`src/core/content-schema.ts`): `refactor` → `implement`; `write-tests` →
`implement`, `spot-bug`, `predict`; `review` → `spot-bug`; `ladder` →
`implement`.

`Rubric` = `{ "criteria": [{ "id", "kcs": [...], "weight", "description": L10n, "mustMention"?: [...], "forbidden"?: [...] }], "passAt": 0..1 }`.

- `mustMention`: terms a good answer names. The validator checks that the
  model answer (in either language) contains every one.
- `forbidden`: phrases that fail the criterion when the answer contains them
  (case- and space-insensitive), e.g. `["BLEU", "perplexity", "困惑度"]` for
  "does not use a proxy metric". The phrase check decides such a criterion;
  the learner cannot tick it. List the phrase in every language a learner
  might answer in. The validator checks the model answer contains none.
- Learners grade written answers themselves against the rubric (there is no
  AI grader): the score is the weighted share of criteria they tick, and the
  suggested grade never goes above Good.

`options` (harness options, on every executing type):

```json
{ "seed": 0, "fakeClock": true, "stepBudget": 200000, "wallMs": 4000, "asyncTests": false }
```

`stepBudget` counts executed lines of *your* code per test (the stdlib is free);
200 000 is plenty for interview-sized code and turns an infinite loop into a
`timeout` in well under a second. `wallMs` bounds a whole run; keep the
reference solution under 25 % of it. Two optional knobs:

- `testWallMs` — the wall-clock slice of one test id (default
  `max(1000, wallMs / 2)`). A runaway test times out at its slice and the
  remaining tests still run. Lower it (e.g. `500`) when a mutant can spin in
  stdlib code (an `os.walk` that follows a symlink cycle) rather than in your
  lines, so it dies in about half a second instead of a second or more.
- `memoryMb` — address-space headroom per run (default 1024; `0` turns the cap
  off). `list(range(10**10))` then raises `MemoryError` at once and the test
  fails with `fault: "memory_limit"`, so "materialises the whole range"
  mutants die in a fraction of a second. The cap is `setrlimit(RLIMIT_AS)`
  relative to the harness's own size; it is enforced on Linux and on macOS.

## 3. How code runs

Code items are graded by a **code runner** that executes
`runner/python/dojo_harness.py` on **real CPython 3.12+** (this repository
ships the interface, not a runner; see `core/runner.ts`). The validator runs
the same harness on your machine's `python3`. So:

- **Threads, `multiprocessing`, `concurrent.futures`, `asyncio.run`, files and
  `os.fsync` all work** and behave as in an interview. Use them when the KC is
  about them.
- **No network.** Internet sockets raise `PermissionError`. Never fetch anything.
- **Time is fake when `fakeClock` is true.** `time.time()`, `time.monotonic()`,
  `time.perf_counter()` and `time.sleep()` called from exercise code read and
  advance `clock`; nothing actually sleeps. Every TTL / lease / expiry /
  rate-limit item uses this. Exercise code reads time with plain
  `time.monotonic()` (as a candidate would); tests move it with
  `clock.advance(seconds)`, which moves wall and monotonic time together.
  For "wall clock jumps" items (NTP step, DST, a VM resumed from suspend) use
  `clock.jump_wall(s)` / `clock.set_wall(t)` — `time.time()` moves, possibly
  backwards, while `time.monotonic()` does not — and `clock.advance_monotonic(s)`
  for the reverse. `datetime.now()` is **not** faked — don't use it.
  The stdlib's own waits (asyncio, `threading.Condition`, queues, pools) keep
  real time, so mixing a fake clock with real concurrency is safe.
- **Randomness is seeded**: `random.seed(options.seed)` before every test. For
  random inputs, use the `rng` fixture or `random.Random(seed)` explicitly.
- **Output must not depend on hash order.** The validator runs everything under
  two `PYTHONHASHSEED`s and rejects any item whose verdict or output differs —
  printing a `set` of strings is the classic way to fail this.
- **Threaded code is run five times** by the validator and must give the same
  verdict every time. A race test must make the wrong implementation fail
  *reliably*: use `stress(fn, n=…)` (below), widen the window with a
  `time.sleep(0)` inside the critical section of the buggy version, or use
  barriers — never rely on luck.
- **Python 3.12 syntax only** (no 3.13+ features).

### The `dojo` module (available to exercise code and tests)

```python
from dojo import kc, clock, raises, torn_write, stress
```

| name | use |
|---|---|
| `@kc("kc-id", ...)` | Tags a test with the KCs it exercises. **Every hidden test needs one.** Put it directly above `def test_…`, at column 0, with literal string arguments. |
| `clock` | The fake clock: `clock.advance(s)`, `clock.now()` / `clock.wall()`, `clock.monotonic()`, `clock.set(t)`, `clock.jump_wall(s)`, `clock.set_wall(t)`, `clock.advance_monotonic(s)`, `await clock.tick(s)` (advance, then yield to the event loop). Also injected as a test parameter `clock` and as a global in the tests module. Both readings reset before every test. |
| `raises(Exc, match=None)` | `with raises(KeyError): ...` — pytest-style. |
| `torn_write(path, at_byte)` | Context manager: writes to `path` fail with `OSError` once `at_byte` characters have landed, leaving the torn prefix on disk. For crash-recovery items. |
| `stress(fn, n=200)` | Runs `fn` n times with a 1 µs GIL switch interval; fails if any run raised `AssertionError`. For race conditions. |

### `pytest` (built in)

Every job can `import pytest` and gets the harness's built-in, deterministic
subset — it shadows any pytest installed on the host, so results never depend
on the machine. Do **not** ship a `pytest.py` stand-in with an item (a job that
does gets its own file instead). Supported: `pytest.raises` (context manager
and callable form, `match=`, `.value` / `.type`), `pytest.approx` (numbers,
sequences, dicts; pytest's default tolerances), `pytest.mark.parametrize`
(stacked, `ids=`, `pytest.param`), `@pytest.fixture` (function scope, `yield`
teardown, `autouse`, `name=`), the `monkeypatch` fixture (`setattr` on an
object or a `"module.attr"` path, `delattr`, `setitem`, `delitem`, `setenv`,
`delenv`, undone after each test), `capsys`, `pytest.fail`, `pytest.skip` and
`mark.skip` / `mark.skipif` (a skipped test counts as passed); any other mark
is a no-op. Not supported: fixture `params`, non-function scopes, `conftest.py`,
plugins.

A parametrized test is **one test id** (the function name): the build reads ids
and `@kc` tags statically, so cases cannot become separate ids. All cases run
under that id, each with fresh fixtures, a reset clock and reseeded `random`;
the first failing case fails the test and its message starts with `[case-id]`.
A learner-written suite that the hidden tests run by hand can read
`fn._parametrize` (`(names, rows)`) and `fixture._is_fixture`, as the old
stand-ins exposed.

### Writing tests

- Plain functions: `def test_name():` or `async def test_name():` (set
  `"asyncTests": true` for the latter). No classes. Fixtures: `clock`,
  `tmp_path` (a fresh `pathlib.Path` per test), `rng`, `monkeypatch`,
  `capsys`, and any `@pytest.fixture` in the tests module.
- One behaviour per test, named for the behaviour (`test_expires_exactly_at_ttl`).
  The test id is what the learner sees next to a red cross.
- Use bare `assert a == b`; the harness rewrites it so a failure shows both
  sides. Don't print instead of asserting.
- Tag with the KC the test actually discriminates. A boundary test tags the
  boundary KC; a test that also needs the injected clock may tag both.
- `tests.py` holds the **hidden** tests; `visible_tests.py` (optional) holds
  the examples the learner can see and run. Test ids must be unique across both.
- Tests import the learner's module by its real name (`from cache import TTLCache`).

### Writing mutants (`mustKill` / `mutants`)

A mutant is a plausible *wrong* implementation: the bug a strong candidate
makes under time pressure. Each one is a directory holding only the files it
changes. The validator requires every mutant to be killed by at least one
hidden test — a survivor means your tests are too weak (or the mutant is
equivalent, which is also rejected). Good mutants:

- off-by-one at a boundary (`>` for `>=`, `<` for `<=`);
- forgetting to refresh/overwrite on a second write;
- counting stale/expired/deleted entries;
- sharing a mutable default or aliasing a returned list;
- the unlocked version of a critical section;
- `asyncio.gather` without `return_exceptions` where one task fails, a missing `await`;
- returning `None` instead of the documented default.

Write 2–4 per implement item. Describe each one in `description` (bilingual) —
it is shown after the attempt as "the classic slip this test catches".

## 4. Item types

The `series/_sample/` fixture has one complete, validating example of each
code type; copy from it. Summary of each layout (defaults in parentheses):

### predict — "what does this print?"

```
predict-word-count/
  item.json
  code/main.py          (files: "code", entry: "main.py")
```

```json
"answer": { "mode": "stdout" }
"answer": { "mode": "choice", "distractors": ["…wrong output 1…", "…wrong output 2…"] }
"answer": { "mode": "exception" }
```

Never write the correct answer: the build runs the program and records its
stdout (or the exception type). For `choice`, write 2–5 distractors that are
each the result of one specific misconception; the build shuffles in the real
output and rejects a distractor equal to it. Optional `stdin`. For a thread
item, fix the interleaving in the code (barriers, `join` order) and explain it
in the optional bilingual `schedule`.

### spot-bug — "which line is wrong?"

```
spot-bug-mutable-default/
  item.json             "bugs": [{ "path": "inventory.py", "lines": [1], "kcs": [...] }], "tolerance": 0
  code/inventory.py     (files: "code") — the buggy code, no hint comments
  fix/inventory.py      optional: the corrected code
  tests.py              optional: tests the fix passes and the bug fails
```

With `"fixStage": { "fix": "fix", "tests": "tests.py", "options": {…} }` the
validator proves the buggy code fails, the fix passes, and the fix changes a
line within `tolerance` of a declared bug line. Line numbers are 1-based.

### fill-blank — "complete the line"

```
fill-ttl-boundary/
  template/cache.py     (template: "template") — contains `# __BLANK:<id>__`
  tests.py              optional
```

A blank runs from its marker to the end of the line, so put it last on the
line (`expired = # __BLANK:expired__`). Each blank: `{ "id", "accept": [...],
"wrong": [...], "kcs": [...] }`. Every `accept` must pass the tests; every
`wrong` must fail them (`wrong` is validator-only and never ships). Without
tests, only the first accepted fill is checked to import cleanly.

### parsons — "put the lines in order"

```
parsons-top-k/
  solution.py           (solution: "solution.py") — the correct program, 4-space indents
  tests.py              optional
```

Each non-blank line of `solution.py` becomes a block. Add
`"distractors": [{ "id": "d1", "code": "…", "replaces": 2 }]` — `replaces` is the
1-based line it imitates; the validator proves the program fails with it
swapped in; `replaces` must be a line number of `solution.py` (non-blank lines,
1-based) and the distractor must differ from that line, or the validator
reports an error. A distractor without `replaces` is only a warning, but it is
then never proven wrong — always give one.

**Grading accepts any order whose program passes the tests.** When the item
has `tests`, the player runs the assembled program and green tests are full
credit (`src/core/grading.ts` `scoreParsons`), so you do not need to enumerate every
valid order. `"altSolutions": [[1, 3, 2, 4, 5]]` lists other valid orders by
line number; the validator proves each one passes. They are required only for
items **without** tests (and are used for the no-runner fallback);
the list is capped at 64 orders to bound the bundle, not the set of valid
answers. Block ids are hashed and shuffled at build time, so the bundle never
reveals the order. `module` defaults to the solution's file name.

### choose-design — "which approach?"

Everything in item.json: `scenario` (L10n), `options: [{ "id", "text", "correct",
"why" }]`, `multi`. Every option, including the right one, needs a `why`. Write options
in any order: the build shuffles them by item id (never leaving the authored
order), and grading goes by option id.
Wrong options should be wrong for a *reason a candidate could hold*, not absurd.

### implement — "write it, hidden tests decide"

```
implement-ttl-cache/
  starter/cache.py          (starter: "starter") — signatures + docstrings, bodies raise NotImplementedError
  solution/cache.py         (solution: "solution") — reference
  tests.py                  hidden tests, every one @kc-tagged
  visible_tests.py          optional examples the learner sees
  mustKill/<id>/cache.py    one dir per mutant (files default to "mustKill/<id>")
```

`"mustKill": [{ "id": "off-by-one", "description": L10n }]`. The validator
requires: the solution passes hidden and visible tests in < 25 % of `wallMs`;
the starter fails at least one hidden test; every `mustKill` is killed. The
prompt states the contract precisely (signatures, edge cases, what "expires"
means) — hidden tests may only check what the prompt promises.

### explain — "say why"

`question`, `rubric`, `modelAnswer` (all bilingual), optional `context` file
set. The model answer is what the learner self-grades against, so write it as
a strong two-to-four-sentence answer that hits every criterion.

### case — "a staged interview round"

Everything in item.json: `scenario` (L10n) and 2–8 `stages`, each
`{ "id", "question": L10n, "rubric": Rubric, "modelAnswer": L10n, "weight"? }`.
A stage appears only after the learner has answered and self-checked the one
before, so later stages can add a constraint ("**New constraint**: …") that the
first answer could not anticipate. Optional:

- `"checkpointFor": "<this unit's id>"` makes it the unit checkpoint (the boss
  node on the path); a pass within `estSeconds` (plus grace) unlocks crowns 4–5.
- `"simulation": { "minutes": 10–120 }` lists it under Simulation as a timed case.
- `context`: a file set shown above the stages.

Cases sit at rung 4 by default (`scheduler.rungOf.case`) and are never composed
into daily sessions. See `series/_demo/units/u-eval-basics/case-*`.

### Code-runner types

- **refactor**: like implement, with `baseline/` (default) instead of
  `starter/`, plus `newRequirement` (L10n) and `constraints.publicApi`.
- **write-tests**: `subject/` (reference implementation the learner reads),
  `test_starter.py`, `tests.py` (your reference tests — validator only),
  `mutants/<id>/` with `"mutants": [{ "id", "kcs", "description" }]`, `killTarget`.
  Your reference tests must kill every mutant.
- **ladder**: `starter/`, and per level `levels/<id>/tests.py` +
  `levels/<id>/solution/`, with `"levels": [{ "id", "title", "prompt",
  "timeboxMin", "kcs" }]`. Each level's solution passes all tests up to its
  level; the previous level's solution must fail the new level.
- **review**: `change.diff`, `context/`, `issues` with path/line/severity/category.

## 5. Quality bar

- One idea per item. If the explanation needs "also", split the item.
- The prompt is self-contained: a candidate who has never seen this codebase
  can answer from the prompt and the code alone.
- Code reads like interview code: short functions, real names, no comments
  that give the answer away.
- Distractors and mutants come from real misconceptions. If you can't name the
  misconception, delete the distractor.
- Each KC needs, across the unit, at least two items at each of its rung-0–2
  types (predict/parsons/choose-design, fill-blank/spot-bug/explain,
  implement/review) and at least two skins. A phase-2 type in that list
  (`review`) is met by its MVP stand-ins until the player supports it.
  `--coverage` lists the gaps.
- Every lesson ends up with 4–10 items, each teaching that lesson's KC as its
  primary KC (§2.1).

## 6. Bilingual rules

- Every prose field is `{ "zh-CN": "…", "en-US": "…" }`; both are required and
  non-empty (the validator enforces parity, including per hint).
- Write each language natively. Do not machine-translate word for word and do
  not mix languages inside one string (technical terms may stay in English
  inside the Chinese text, as an engineer would write them).
- Code, identifiers, file names, stdout, test ids and diffs are **data**, never
  translated: put them in backticks and keep them identical in both languages.
- Markdown is allowed (inline code, emphasis, short lists). No HTML, no images.
- Keep prompts short: a phone screen should show the prompt without scrolling
  past the code.

## 7. Before you hand off

```sh
npm run content:validate -- --series <id> --unit <yourUnit>   # 0 errors
npm run content:validate                                      # whole tree still green
```

Errors print as `✗ <file> › <field or check>: <what is wrong>`. Warnings (`!`)
don't block but usually mean a weaker item. Do not hand-edit anything under `public/content/`;
it is generated.
