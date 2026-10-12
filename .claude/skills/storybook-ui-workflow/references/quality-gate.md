# Dojo Storybook UI Quality Gate

This reference defines the required Dojo workflow for creating, changing,
reviewing, and consuming UI. It is both an authoring sequence and a release gate.

## Repository contract

- Run Storybook with `npm run storybook`; the local port is `6006`.
- Build the static catalog with `npm run build-storybook`.
- Type-check with `npm run typecheck`.
- Storybook discovers `src/**/*.stories.@(ts|tsx)`.
- The framework is `@storybook/react-vite`; stories use the current Storybook
  `Meta` and `StoryObj` APIs.
- `tags: ["autodocs"]` is the normal documentation path.
- Global toolbar controls expose light/dark theme and locale (English,
  简体中文). The preview decorator supplies the theme classes, the message
  catalogs and the app stylesheet. Stories open on a phone viewport (390 px).
- The accessibility addon is configured for `#storybook-root`.

Do not invent another story root, parallel theme wrapper, or private catalog for
a component. Follow the current `.storybook/main.ts` and
`.storybook/preview.tsx` configuration.

## What counts as a component

Apply the gate to any visual unit intended for reuse or repeated behavior:

- primitives, controls, chips, tabs, feedback, overlays, and form elements;
- surfaces, navigation elements, page headers, toolbars, rails, and app-shell
  regions;
- repeated records such as rows, cards, list items, kanban lanes, and tree items;
- reusable feature structures such as a section header, filter bar, result
  block, note editor, or problem list;
- complete compositions and application frames.

One-off JSX is not exempt when it establishes a new visual or interaction
pattern. Either compose it from registered components or extract and register
the new component first.

## Definition of registered

A component is registered only when all of the following are true:

1. A matching story is inside the configured discovery path.
2. The story has a stable title in the correct taxonomy and appears in the
   Storybook navigation.
3. The canonical story renders without a Storybook or browser exception.
4. The story isolates the component well enough to evaluate its own API,
   anatomy, spacing, and states.
5. Required variants, interactions, content extremes, and responsive behavior
   are represented by stories, controls, or a purposeful test harness.
6. The static Storybook build succeeds.

Merely creating a `.stories.tsx` file, embedding a child inside a full-page
story, or showing only a happy-path screenshot does not satisfy registration.

## Catalog taxonomy

Use the narrowest existing category that matches the component:

- `Design System / ...` for reusable foundations and product-independent UI;
- `Compositions / ...` for product-domain structures assembled from registered
  design-system components;
- a focused anatomy group when a large composition has reusable internal
  structures that need independent stories.

Keep titles stable and use readable exported story names. Do not create a new
top-level category to avoid deciding where a component belongs.

## Story contract by scope

### Primitive or control

Show the canonical state, supported sizes and variants, icon/text combinations,
and all applicable interaction states. Include disabled and focus-visible; add
loading, selected, invalid, or destructive states when the API supports them.

### Repeated record or reusable feature structure

Show one canonical item and the meaningful state matrix. Include realistic long
and short content, missing optional content, count extremes, localization
expansion, and the narrow layout. If the component repeats, also show enough
siblings to expose rhythm and computed-value drift.

### Navigation, layout, or app shell

Story the reusable pieces independently as well as the assembled structure.
Verify current location, expansion/collapse controls, keyboard/focus behavior,
overflow, and responsive topology. A whole app frame does not replace stories
for breadcrumb, nav item, section, rail, toolbar, or other reusable children.

### Complete composition

Use registered children and preserve real product information architecture.
The composition story verifies relationships, reading order, shared grids,
responsive restructuring, and state coordination. Do not add decorative or
demonstration-only content to production anatomy unless the product requires it.

## Story-first implementation sequence

1. **Inventory before invention.** Search existing components and stories.
   Reuse an existing component only when semantic role and behavior match, not
   merely because its current appearance is close.
2. **Define the contract.** Write the component boundary, props, semantic role,
   state model, content limits, accessibility name, and responsive behavior.
3. **Register the story.** Add the story metadata and the smallest stories that
   make the contract observable. Confirm Storybook discovers them.
4. **Implement in isolation.** Build the component against the stories. Do not
   rely on page-specific CSS or an accidental parent wrapper for its anatomy.
5. **Pass the quality matrix.** Perform normal, Outline, responsive, theme,
   interaction, content, and accessibility checks described below.
6. **Open the product gate.** Only after registration and verification may new
   application code import and render the component.
7. **Verify the consumer.** Confirm the assembled product surface preserves the
   component contract and does not introduce a new unregistered pattern.

For an existing component change, apply the same order to the changed contract:
update its stories, implement it, pass the gate, and then update consumers.

## Friendly Layered SaaS UI review

Read `friendly-layered-saas-ui/SKILL.md` and its full design-language reference
before visual work. Apply it as a coherent system rather than borrowing isolated
effects.

Before styling, map the implementation to semantic roles:

- surface and elevation tier;
- text/type role;
- action hierarchy;
- category color versus feedback color;
- icon material tier;
- spacing owner and density mode;
- component boundary and parent/child relationships.

At normal scale, confirm that the task, state, and action hierarchy are clearer
than decoration; repeated roles compute to repeated values; one action wins each
action cluster; nested surfaces stop at the boundary needed for grouping; and
light-mode main surfaces remain intentional rather than inheriting an
unrelated presentation background.

## Mandatory Outline verification

Enable Storybook's Outline toolbar control after the normal visual pass. Outline
is a structural diagnostic, not a presentation mode.

Inspect all of the following:

- related text and controls share deliberate horizontal and vertical axes;
- chips, icons, labels, values, and actions align to the content they describe;
- parent/child containment matches the intended component anatomy;
- sibling spacing is owned once, normally by the parent `gap`;
- component padding is internal and reusable children do not create unknown
  external margins;
- no accidental full-width wrapper stretches a local row or creates false
  hierarchy;
- no redundant bordered wrapper adds an extra nesting level;
- repeated components have matching insets, line heights, and alignment;
- controls remain attached to the card, section, or mode they control;
- responsive reordering preserves task order and keeps navigation available
  before the content it navigates.

Repeat the Outline pass at the phone width (390 px) and the small phone (360 px)
that activates the component's responsive topology. A visible axis break is a
defect unless the information hierarchy deliberately requires it. Fix the
underlying grid, flex, wrapper, or spacing ownership; do not hide it by disabling
Outline or adding unrelated offsets.

## Verification matrix

Choose applicable entries based on the component, but never skip normal scale,
Outline, a narrow width, keyboard focus, type-checking, or the Storybook build.

| Dimension | Required evidence |
|---|---|
| Normal render | Canonical story is readable at 100% and realistic density |
| Structure | Outline pass at 390 px and 360 px |
| Theme | Light and dark |
| Content | Short, long/localized, empty/missing optional data, and numeric extremes |
| Interaction | Keyboard, focus-visible, hover, active, selected, disabled; loading/error when applicable |
| Responsive | Topology changes before text shrinks; navigation and primary actions remain reachable |
| Accessibility | Accessible names, contrast, non-color state cues, reduced motion, and addon findings |
| Consistency | Repeated roles/components compute to the same type, inset, gap, and control height |
| Build | `npx tsc --noEmit` and `npm run build-storybook` succeed |

Do not infer quality from a static build alone. A build can pass while alignment,
containment, focus behavior, or responsive navigation remains wrong.

## Failure conditions

The component is not consumer-ready when any of these is true:

- it is used by application code before Storybook registration;
- only a page-sized story exposes a reusable child;
- Storybook cannot discover or render the story;
- the canonical story has a runtime exception or missing provider;
- Outline reveals unintended axis, containment, wrapper, or spacing defects;
- the narrow layout hides navigation after the content it controls;
- state, theme, long-content, keyboard, or focus behavior is undefined;
- stories and implementation disagree about the public API;
- type-checking or the static Storybook build fails.

Stop and fix the contract or implementation before adding consumers or calling
the UI complete.

## Completion report

For each UI task, state:

- components and reusable structures registered or updated;
- story titles and important states added;
- phone and small-phone widths inspected;
- that Outline was enabled and what structural relationships were verified;
- themes, both locales and interaction states checked;
- type-check and Storybook build results;
- any intentionally deferred state or known limitation.
