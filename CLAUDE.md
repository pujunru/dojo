# Working on Dojo

A static, mobile-only practice app. The engine (`src/core`) is pure
TypeScript; progress lives in the browser (`src/store`); content is built from
`content/` (or `$DOJO_CONTENT_DIR`) into `public/content/`.

Read `docs/ARCHITECTURE.md` before changing the engine or the store, and
`docs/CONTENT.md` before touching content.

## Skills

- UI work: `.claude/skills/storybook-ui-workflow` (register in Storybook before
  use) with `.claude/skills/design-language` (mobile rules first).
- Any user-visible text: `.claude/skills/dojo-i18n`.
- Content: `.claude/skills/dojo-content-authoring`.
- Executing code items: `.claude/skills/dojo-code-runner`.

## Before you hand off

```sh
npm run typecheck
npm test
npm run check:i18n
npm run content:validate
npm run build-storybook     # for UI changes, then look at the stories at 390 px
```

Never edit `public/content/` (generated). Keep `src/core` free of DOM and
Node imports.
