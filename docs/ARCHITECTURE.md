# Architecture

Dojo is a static, mobile-only web app that runs a Duolingo-style practice
loop over content you author: spaced repetition per skill, retrieval
practice, a session composer that stays in the zone of proximal development,
and light gamification. There is no server: content is a set of static JSON
files, and the learner's progress lives in their browser.

```
content/series/<id>/…         authoring format (JSON + .py files)
        │  npm run content:validate   (schema, graph, CPython harness)
        │  npm run content:build
        ▼
public/content/<hash>/…       content-hashed bundles the app fetches
        │
        ▼
src/app/        page wiring: load content + state, run sessions
src/features/   Storybook-registered compositions (path, player, item views, …)
src/ui/         design-system primitives (button, code editor, crowns, …)
src/core/       the engine: pure TypeScript, no I/O
src/store/      the learner document and its IndexedDB backend
runner/python/  the reference test harness a code runner executes
```

## 1. Layers

- **`src/core/`** is pure and deterministic (clock and randomness are
  injected). The app, the content scripts and the tests all import it.
  - `content-schema.ts`: the item union (`DojoItem`), its normaliser, the
    per-item index row the composer reads.
  - `skill-graph.ts`: tiers → units → lessons → KCs (knowledge components),
    prerequisites, validation.
  - `series.ts`: series config, id namespacing, runtimes, scheduler parameters.
  - `learner-model.ts`: per-KC half-life model and mastery.
  - `grading.ts`: per-type scoring → an `OutcomeSignal` → a grade per KC.
  - `composer.ts`: builds sessions.
  - `gamification.ts`: XP, daily goal, streaks and freezes, crowns, cracks.
  - `rubric.ts`: rubric self-check rules (`forbidden`, `mustMention`).
  - `runner.ts` + `run-protocol.ts`: the code-runner interface (§6).
  - `contract.ts`: the request/response shapes between the app and the store.
- **`src/store/`** holds the learner's records as one JSON document
  (`learner-db.ts`, pure operations) and persists it (`learner-store.ts`:
  IndexedDB, falling back to memory when the browser refuses storage).
- **`src/features/` and `src/ui/`** are presentational. Every component is
  registered in Storybook before the app uses it.
- **`src/app/`** wires data and intent: `api.ts` (content fetch + store calls),
  `use-dojo-session.ts` (the session runner), `dojo-app.tsx` (screens),
  `app.tsx` (language, shell, learner-data panel).

## 2. Content model

A **series** is one curriculum: `series.json` (runtimes, archetypes,
scheduler overrides) and `skill-graph.json`. Items reference a unit, a lesson
and 1–4 KCs (exactly one primary). The build qualifies every id with the
series (`dj-<series>-<local>`, `<series>:<local>`), so series never collide and
can share one learner profile. See `docs/CONTENT.md` for the authoring format.

Item types and their **rung** (production strength; a series may re-rank):

| rung | types | what it proves |
|---|---|---|
| 0 | predict, parsons, choose-design | recognise |
| 1 | fill-blank, spot-bug, explain | produce a fragment |
| 2 | implement, review | produce the whole thing |
| 3 | refactor, write-tests | extend / attack it |
| 4 | ladder, case | a timed multi-part round |

The build writes, per series, a `manifest.json` (config, graph and one index
row per item) and one bundle per unit, under a content hash. The app fetches
`content/current.json` (never cached) and then hashed files (cacheable).

## 3. Grading

Each type turns an answer into `q ∈ [0, 1]` and a per-KC breakdown `qByKc`
(a test, a blank, a bug or a rubric criterion names the KCs it measures).

| type | score |
|---|---|
| predict | exact output / choice / exception type |
| spot-bug | F1 of selected lines vs declared bugs (+ fix tests with a runner) |
| fill-blank | blanks accepted (or tests pass with a runner) |
| parsons | an accepted order (or tests pass); partial credit by LCS |
| choose-design | correct options; with a written rationale, `0.7·choice + 0.3·rationale` |
| explain / case | rubric self-check: weighted share of criteria met |
| implement / refactor | hidden tests passed, per KC |
| write-tests | mutants killed against a target |
| ladder | levels passed |
| review | findings matched to issues; false positives cost |

`gradeFor` maps the signal to Again / Hard / Good / Easy per KC: Again when
below the type's pass mark or the solution was revealed; Hard on hints, a
retry, or more than twice the estimated time; Easy when faster than 60% of it.
Self-checked answers never suggest more than Good: only the learner's own
click reaches Easy.

## 4. Learner model and scheduling

Per KC: half-life `h` (days), last seen, next due, counts, best rung, mastery
0–5, and a remediation window.

- Recall `p(t) = 2^(−Δ/h)`. Due when `p < 0.7`.
- First exposure sets `h` from the grade (Again 0.25 d … Easy 3 d).
- Reviews grow `h` by `1 + k·G·s`, with `k` per grade (Hard 0.6, Good 1.5,
  Easy 2.5), `G` the item type's gain × the KC's weight, and `s = (1 − p) + 0.2`
  (a riskier review grows more: the spacing effect). Again shrinks `h`.
- **Recognition is capped**: while a KC's best rung is below 2, `h ≤ 7` days;
  below 3, `h ≤ 30`. Multiple choice alone cannot push a skill you must produce
  to long intervals.
- Intervals above three days are jittered ±15% so reviews don't bunch.
- Mastery: 1 after a Good; 2 at `h ≥ 3` and rung ≥ 1; 3 at `h ≥ 10` and
  rung ≥ 2; 4 at `h ≥ 25` and rung ≥ 4; 5 at `h ≥ 60` with rung 5 or a recent
  timed checkpoint. A unit's crown is the minimum mastery of its KCs, and
  crowns 4–5 need its checkpoint (a ladder or a `case` with `checkpointFor`).
  Crowns never decay; a unit shows a crack when a KC's recall drops below 0.5.

**Composer** (`composeSession`, in the browser): a session is a time budget
(10 minutes by default) filled from due KCs first (lowest recall, remediation
windows boosted), then at most a share of new KCs from the frontier (all
prerequisites mastered). It adds no new KCs after a session under 70%
accuracy. Item choice targets the KC's mastery rung (±1), avoids items seen
in the last week, rotates skins (same skill, different surface story) and
never puts two variants of one question in a session. Order: an easy warm-up,
the hard middle, new material, and an easy finish. A missed item requeues a
different item for the same KC at a lower rung (at most twice).

Ladders and staged cases are not composed. They run as checkpoints or timed
simulations, and a failure sends their KCs to remediation: `h` is capped and a
three-day window opens in which those KCs get easier, sooner reviews.

## 5. The learner store

One JSON document per browser (`LearnerDb`): profile, days, KC states, item
states, unit crowns, sessions and the last 5 000 attempts. Every operation is
a pure function `(db, request) → (db', response)` and is idempotent on its id
(`djs-…` sessions, `dja-…` attempts), so replays are harmless. One open session
per series; starting another closes it as abandoned.

`LearnerStore` serialises writes through one queue and saves after each.
`IndexedDbBackend` stores the document under one key. When the browser refuses
storage (some private modes), `MemoryBackend` keeps the session working and
the UI says progress will not survive the tab.

Moving devices is an export: the learner downloads a JSON file
(`format: "dojo-learner"`) and imports it elsewhere; import replaces the
document after validating it. A sync backend could implement the same
`contract.ts` shapes later without touching the engine.

## 6. Code runners

Items with `runtime: "sandbox:python"` are graded by running hidden tests.
The app ships the protocol and the harness, not an executor:

```ts
interface CodeRunner {
  runtime: "sandbox:python";
  label: string;                         // shown in the UI
  run(job: RunJob): Promise<RunResult>;  // never rejects
  subscribe(listener): () => void;       // idle / provisioning / running / …
  reset(): void;
}
registerRunner(runner);                  // before the app renders (src/main.tsx)
```

A runner executes `runner/python/dojo_harness.py` (stdlib only, CPython 3.12+)
with a `RunJob` on stdin and returns the `RunResult` it prints. Candidates: a
Pyodide Web Worker, a sandbox service, a desktop shell. With no runner
registered, `runtimeAvailability()` omits the runtime: the composer substitutes
same-KC items that need none, statically gradable items (predict, parsons,
fill-blank and spot-bug without tests) still play, and the path marks lessons
that only have runner items.

## 7. UI

Mobile only: one phone-width column (`AppShell`), centred on wider screens.
Screens live in the URL hash (`#path`, `#session`, `#skills`, `#review`,
`#simulation`). The player keeps its Check / Continue dock on screen and
supports keyboard shortcuts (Enter, 1–9) when a keyboard is present.

All UI copy is in `src/i18n/messages/<locale>.json` (English and Simplified
Chinese); content prose is bilingual in the content itself. Code, ids and
output are data and never translated.
