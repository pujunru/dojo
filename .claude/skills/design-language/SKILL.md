---
name: dojo-design-language
description: Design, refine, or review Dojo UI with its warm, layered visual system (vivid milestone icon tiles, disciplined color semantics, relational icon/type scale, tokenized spacing), applied to a mobile-only app. Use for any visual change to src/ui or src/features, and whenever a surface feels muted, flat, cramped or inconsistent.
---

# Dojo design language

Dojo's visual system is the "friendly layered" language below, applied to a
**mobile-only** app. Read the mobile rules first; they override the
reference wherever it assumes a desktop.

## Mobile rules (take precedence)

- One phone-width column (`AppShell`, max 30rem), centred on wider screens.
  There is no sidebar, no multi-column board and no desktop shell: ignore the
  reference's sidebar, kanban and `>= 960 px` layout rules.
- Design and review at 360–390 px first. Check 768 px only to confirm the
  column stays centred and nothing stretches.
- Touch targets are at least 44 × 44 px. The player's Check / Continue dock
  stays on screen; never put a primary action below the fold of a long item.
- Respect safe areas (`env(safe-area-inset-*)`) in sticky bars.
- Prefer stacking to shrinking: a row that does not fit becomes two rows; text
  wraps, it is never clipped or overlapped (check long Chinese and English).
- Tokens live in `src/styles/base.css` (colors, type, spacing, radii) and
  `src/styles/dojo.css` / `primitives.css` (components). Use the tokens; do not
  add raw colors or pixel values to components.


Create operational interfaces that feel approachable, colorful, calm, and
clearly layered without sacrificing scanability or density.

## Required design authority

Before designing, editing, or reviewing a surface, read
[references/design-language.md](references/design-language.md) completely. It
contains the reusable visual system and the tested tradeoffs for color,
dimensional icons, paired scale, typography, spacing, component anatomy,
responsive behavior, interaction states, and accessibility.

Later numbered revisions in the reference take precedence over earlier general
examples when they conflict.

## Apply the system

1. Inspect the target surface, product terminology, existing tokens, and at
   least one representative component. Preserve product truth, behavior,
   accessibility, and confirmed brand commitments.
2. Map the existing implementation to semantic roles before changing values:
   surfaces, text, actions, category colors, feedback colors, type roles,
   spacing roles, component tiers, and density modes.
3. Establish the shared grid and information hierarchy before styling local
   details. This is an Operate-mode system: the task, state, and familiar
   affordances remain clearer than the decoration.
4. Implement the design language as a coherent system. Do not cherry-pick
   isolated effects such as colorful icons, shadows, serif numerals, or rounded
   cards without their relational constraints.
5. Verify the assembled result at normal interface scale and across relevant
   viewport, zoom, content-length, interaction, and density states.
6. When the interface is available in Storybook, enable the Outline addon before
   calling the work complete. Inspect the rendered box structure—not only the
   normal screenshot—for shared reading axes, parent/child containment, sibling
   alignment, spacing ownership, accidental full-width wrappers, and redundant
   nested boundaries. Repeat this check at a representative narrow width after
   the topology changes. Treat a visible axis break as an implementation defect
   unless the information hierarchy intentionally requires it.

## Non-negotiable checks

- Large structural surfaces remain calm while key chroma anchors remain vivid.
- Workflow category color is separate from success/error/trend semantics.
- Dimensional treatment is reserved for summary and milestone icons; ordinary
  navigation, utility, and action icons stay in their assigned material tier.
- Icon tiles and adjacent labels satisfy the paired-scale and salience-budget
  contracts rather than being sized independently.
- Every font declaration maps to a semantic type role and respects browser
  zoom and user font settings.
- Spacing comes from one scale, and page, parent, component, and content each
  own only the intervals assigned to them.
- Repeated components compute to repeated values; density variants remap
  tokens instead of patching unrelated selectors.
- Storybook Outline verification, when Storybook is present, confirms that
  related content shares deliberate horizontal and vertical axes and that DOM
  wrappers reflect the intended component anatomy.
- The interface remains understandable without color and preserves contrast,
  focus, keyboard access, reduced-motion behavior, and non-color state cues.

## Boundaries

- Preserve an established visual identity unless the user asks to adopt or
  replace it with this system.
- Adapt category names and product semantics; do not copy recruiting content
  or example data into unrelated products.
- Do not treat presentation framing as production application chrome. Use it
  only for standalone mockups or showcases where the surrounding atmosphere is
  part of the requested artifact.
- Do not install dependencies, fetch assets, or change frameworks solely to
  express this design language unless the user authorizes that expansion.
