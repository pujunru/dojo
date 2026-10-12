# Dojo

A Duolingo-style practice engine for interview skills, as a mobile web app.
Bring your own curriculum: Dojo schedules it with spaced repetition, keeps
sessions in the zone of proximal development, and turns practice into a
short daily habit.

- **Spaced repetition per skill.** Every knowledge component (KC) has its own
  half-life; reviews come back just before you would forget, and skills you
  can only recognise are capped until you have produced them.
- **Retrieval, not rereading.** Predict the output, order the lines, fill the
  blank, spot the bug, choose the design, explain why, answer a staged case.
- **A composer that adapts.** Ten-minute sessions mix due reviews with a small
  share of new material, rotate surface stories, and slow down after a rough
  session. A miss brings back a different item on the same skill.
- **Light gamification.** XP, a daily goal, streaks with freezes, unit crowns
  that crack when a skill fades, unit checkpoints and timed simulations.
- **Private by construction.** No account and no server. Progress stays in
  your browser; export it to a file to move devices.

This repository is the framework. It ships two small fixture series as
examples, not a curriculum.

## Quick start

```sh
npm install
npm run dev          # builds the example content and starts the app on :5173
```

Open it on a phone, or with your browser's device toolbar. Other commands:

```sh
npm test                 # engine, store and content-pipeline tests
npm run typecheck
npm run check:i18n       # message catalogs in sync
npm run storybook        # every component and state, on a phone viewport
npm run build            # production build (no fixtures) → dist/
npm run build:demo       # production build including the example series
```

The content validator and the build need `python3` 3.12 or newer: they run
code items through the reference harness.

## Your content

Write a series under `content/series/<id>/`, or keep it in its own repository
and point `DOJO_CONTENT_DIR` at it:

```sh
DOJO_CONTENT_DIR=../my-curriculum npm run content:validate
DOJO_CONTENT_DIR=../my-curriculum npm run build
```

`docs/CONTENT.md` is the authoring guide (item types, rubrics, staged cases,
checkpoints, the validator's rules). `docs/ARCHITECTURE.md` explains the
learner model, the composer and grading.

## Code items

Items that are graded by running hidden tests (`implement`, `refactor`,
`write-tests`, `ladder`) need a **code runner**. Dojo defines the interface
(`src/core/runner.ts`) and the reference harness
(`runner/python/dojo_harness.py`) but ships no runner. Without one, those items
are skipped and the rest of the curriculum plays normally. Register a runner in
`src/main.tsx` to enable them; see `.claude/skills/dojo-code-runner`.

## Deploying

`npm run build` produces a static site in `dist/` with relative paths. Host it
anywhere that serves files (GitHub Pages, Cloudflare Pages, Netlify, S3).

## License

MIT
