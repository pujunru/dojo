---
name: storybook-ui-workflow
description: Create, change, review, or consume Dojo UI through a mandatory Storybook-first workflow. Use for every visual component, reusable composition, layout, app shell, design-system change, Storybook story, or UI quality review; enforce registration before product use and verify the result with the dojo-design-language skill.
---

# Storybook UI Workflow

Treat Storybook as the executable contract for Dojo UI, not as optional
documentation added after implementation.

## Required authority

Read [references/quality-gate.md](references/quality-gate.md) completely before
creating, changing, reviewing, or consuming UI.

For any visual design, redesign, refinement, or UI review, also read and follow
[`../design-language/SKILL.md`](../design-language/SKILL.md)
and its required design-language reference completely. Storybook proves the
component contract and rendered structure; the design-language skill supplies
the visual, semantic, spacing, hierarchy, and accessibility criteria.

## Registration-before-use invariant

A UI component includes a primitive, control, navigation element, surface,
layout, app-shell part, repeated record, and reusable feature composition.

- Register every new UI component in Storybook before importing or rendering it
  from product/application code.
- When changing an existing UI component, update its stories in the same change
  before changing or adding consumers.
- When touching an unregistered existing component, register it before extending
  or reusing it.
- A page-sized story never substitutes for stories of the reusable child
  structures it contains.
- A story file alone is not registration. The story must be discovered by the
  current Storybook configuration, appear under the correct taxonomy, render
  without exceptions, and expose the states needed to judge the component.

Do not call UI work complete, and do not move the component into application
usage, while this invariant is unmet.

## Working sequence

1. Identify the component boundary, semantic role, state model, content model,
   and expected consumers. Reuse an existing registered component when its
   semantics match.
2. Create or update the smallest useful stories first: canonical state,
   meaningful variants and states, difficult content, interaction behavior, and
   responsive behavior. Add a composition story only after its child contracts
   are visible independently.
3. Implement against that story contract. Keep story-only framing outside the
   production component.
4. Inspect the rendered story at normal scale. Then enable Storybook Outline and
   inspect shared axes, containment, sibling alignment, spacing ownership,
   accidental wrappers, and redundant boundaries. Stories open on a phone
   viewport (390 px); also check the small phone (360 px).
5. Check applicable theme (light and dark), long-content/i18n (both locales), keyboard, focus, hover,
   selected, disabled, loading, empty, and error states.
6. Run type checking and the static Storybook build. A build that succeeds does
   not replace the visual and interaction checks.

Report which stories were registered or updated, which viewports and states
were inspected, whether Outline was checked, and which verification commands
passed.
