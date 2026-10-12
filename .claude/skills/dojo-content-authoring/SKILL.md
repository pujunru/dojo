---
name: dojo-content-authoring
description: Author, review or debug Dojo content (series, skill graphs and items of every type, including rubrics, staged cases, checkpoints and code items) and get it through the validator and the build. Use whenever work adds or edits anything under content/ (or $DOJO_CONTENT_DIR), designs a curriculum for Dojo, or reads a content:validate failure.
---

# Dojo content authoring

Read `docs/CONTENT.md` completely before writing or reviewing an item. It is
the authoring contract: layout, fields, every item type, the harness rules for
code, the quality bar and the bilingual rules. The examples in
`content/series/_demo/` (discussion items and staged cases) and
`content/series/_sample/` (one item of each code type) validate; copy from them.

## Workflow

1. **Curriculum first.** A series needs `series.json` and `skill-graph.json`
   before items. Name KCs as skills a learner can fail at
   ("refresh the TTL on overwrite"), not topics ("caching"). Each unit has
   lessons; each lesson teaches a few KCs and lists the item types it takes.
2. **One idea per item**, filed under a lesson that teaches its primary KC.
   Distractors, mutants and wrong fills come from real misconceptions; if you
   cannot name the misconception, drop it.
3. **Validate early and often:**

   ```sh
   npm run content:validate -- --series <id> --unit <unit>
   npm run content:validate -- --series <id> --coverage
   ```

   Errors (`✗ file › field: problem`) block; warnings (`!`) usually mean a
   weaker item. Fix the content, never the validator.
4. **Build and play it:** `npm run dev` (fixtures included) or
   `DOJO_CONTENT_DIR=<dir> npm run dev`, then run a lesson on a phone viewport.

## Rubrics (explain, choose-design rationale, case stages)

- Learners self-check against the rubric and the model answer; there is no AI
  grader. Write criteria a learner can judge honestly in a few seconds:
  observable statements about the answer ("compares against production on the
  same data"), not qualities ("is thorough").
- `mustMention` terms must appear in the model answer (either language).
- `forbidden` phrases fail the criterion automatically; list them in every
  language a learner might answer in, and keep the model answer free of them.
- The model answer hits every criterion in two to four sentences.

## Staged cases

Use a `case` for an interview round that unfolds: each stage adds a constraint
the previous answer could not anticipate. Mark the unit's boss round with
`checkpointFor` (its own unit) and timed mock rounds with `simulation.minutes`.

## Code items

Code items run on CPython 3.12+ through `runner/python/dojo_harness.py`; the
validator proves the reference passes, the starter fails, and every mutant is
killed, under two hash seeds. Read §3 of `docs/CONTENT.md` (fake clock,
seeding, `@kc` tags, `stress`, `torn_write`) before writing tests. Remember the
app plays these items only when a code runner is registered.
