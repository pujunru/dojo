# Friendly Layered SaaS UI — Design Language Reference

> Source: visually inferred from the supplied Talently candidate-dashboard screenshot. Colors and dimensions are approximate because the source is a flattened image rather than a design file.
>
> Revision marker: rules under **R2 Reference Re-audit**, **R3 Relational Scale Re-audit**, and **R4 Consistency System** were added after blind implementation tests. A later revision takes precedence when it conflicts with an earlier generalization or example.

## Purpose

Use this design language to create operational SaaS interfaces that feel warm, cheerful, calm, and clearly layered. It is especially suitable for dashboards, workflow tools, kanban boards, CRMs, recruiting products, project management, and admin surfaces containing many repeated records.

The target mood is:

- approachable, not childish;
- colorful, not noisy;
- dense, not cramped;
- refined, not luxurious;
- structured, not severe.

The visual character comes from contrast between quiet structural surfaces and a small number of unmistakably vivid, dimensional color anchors. Neutrality creates room for color; it must not drain the color anchors of chroma, material, or presence.

## Core Design Thesis

Build depth through **nested surfaces, spacing, borders, and local contrast**. Do not make every layer float.

Use this hierarchy:

1. A quiet environmental or page background frames the product.
2. A large white application shell creates the main plane.
3. Warm-neutral navigation separates itself from the workspace.
4. Section containers organize related work.
5. White record cards hold human-scale content.
6. Chips, dots, icons, and metadata provide the final information layer.

Large structural fields should remain neutral, but do not enforce a fixed neutral-area percentage. Judge the result by perceptual balance: a first viewport should feel calm overall while its key stage and summary anchors still read as clearly colorful at a glance.

## Evidence vs. Inference

### Directly observed in the reference

- Large desktop application shell on top of a soft photographic background.
- Warm off-white sidebar and white main workspace.
- Thin light-gray borders; very little card shadow.
- Rounded rectangles repeated at several nesting levels.
- Four equal-width summary cards aligned with four kanban columns.
- Color-coded icon tiles and color-coded column rules.
- White candidate cards containing avatars, two text lines, chips, ratings, and stage labels.
- Strong black primary action and quiet outlined secondary actions.
- Mostly sans-serif interface text with serif-like large KPI numerals.

### Inferred implementation rules

- Exact colors, radii, spacing, typefaces, and breakpoints below are proposed tokens designed to reproduce the visual logic, not claimed source values.
- The outer photographic scene is presentation framing, not a required in-product background.
- Serif KPI numerals are an optional editorial accent; use tabular sans numerals when dense comparison is more important.

## R2 Reference Re-audit

This section corrects ambiguities discovered when the design language was applied without access to the source image. Treat these as fidelity requirements, not optional embellishments.

### Perceptual color energy

- Do not equate “mostly neutral” with “muted.” Neutral surfaces and vivid accents are complementary roles.
- Color presence is determined by chroma, occupied area, luminance contrast, and adjacency. A palette is not successfully colorful when its saturated values exist only as tokens, 2 px rules, or 6 px dots.
- In a desktop first viewport containing summary modules, provide at least three clearly visible high-chroma anchors with enough area to register without close inspection. Compact `22–26 px` icon tiles are the preferred anchors; their exact size is coupled to adjacent typography by R3.
- Use pale tints for low-emphasis chips, badges, selections, and semantic backgrounds. Do not substitute pale tints for the saturated face of a key icon tile.
- Preserve the full chroma of decorative stage colors. Darken a related value only when it is used as text or a meaningful line icon and contrast requires it; do not globally dull the base palette.
- Warmth comes from both hue and context. Warm-neutral chrome, human portraits or lively avatar surfaces, and—in presentation mockups—an ambient frame may support the palette without tinting the operational workspace.

### Two independent color channels

Treat workflow categories and evaluative feedback as separate systems:

- **Categorical/stage channel:** amber, clear blue, vivid magenta, and periwinkle-indigo. These hues orient users and remain emotionally light.
- **Semantic/trend channel:** green for favorable movement and coral for unfavorable movement, always paired with direction or a label.
- A category with an unfavorable name does not automatically become coral/red. Category color should remain stable; feedback color describes the change or condition.

For this visual family, the canonical summary mapping is:

| Summary role | Categorical anchor |
|---|---|
| Total / new | Amber |
| In progress / pipeline | Clear blue |
| Hired / achieved milestone | Vivid magenta |
| Rejected / terminal category | Periwinkle-indigo |

The canonical workflow sequence is amber → blue → magenta → indigo. Product semantics may rename stages, but preserve a comparably cheerful categorical progression unless a confirmed brand system overrides it.

### Icon topology and material tiers

Do not give every icon the same surface treatment. Use three tiers:

1. **Navigation and utility icons:** flat, neutral, low contrast; usually `1.5–1.8 px` strokes.
2. **Action icons:** monochrome and inherited from the button label; no independent tile unless the action is icon-only.
3. **Summary and milestone icons:** compact pseudo-3D color objects with their own topology and elevation.

A tier-3 icon tile is not a pale chip. It has four readable planes:

1. a soft colored contact shadow below the object;
2. a saturated body, preferably with a subtle lighter-top/darker-bottom gradient;
3. a restrained top highlight and lower-edge shade, expressed with inset shadows or an equivalent material treatment;
4. a white or near-white glyph on the highest visual plane.

Recommended tier-3 recipe:

```css
.milestone-icon {
  width: 24px;
  height: 24px;
  border-radius: 8px;
  color: #fff;
  background: linear-gradient(180deg, var(--icon-top), var(--icon-bottom));
  box-shadow:
    inset 0 1px 0 rgba(255,255,255,.55),
    inset 0 -1px 0 rgba(20,20,20,.10),
    0 2px 4px var(--icon-shadow);
}
```

- Keep the object compact; the effect should read as candy-like tactility, not glass, clay, neumorphism, or glossy skeuomorphism.
- Use a simple white glyph with enough filled or stroked area to remain legible at `12–13 px` in the standard tile.
- The shadow must have a vertical offset and blur. A zero-offset colored glow is not elevation.
- Hover may lift the object by at most 1 px and slightly strengthen the contact shadow. Do not animate every icon continuously.

### Standalone mock framing

When the deliverable is specifically a presentation mock rather than an embedded production screen:

- inset the application shell within the viewport so the environment remains visible;
- give the shell one broad, soft presentation shadow;
- use an ambient background with warm and cool natural color variation when real imagery is unavailable;
- keep this atmosphere outside the application shell—it must not reduce workspace legibility.

This framing is optional for production deployment and expected for a standalone visual mock when it materially contributes to warmth and elevation.

## R3 Relational Scale Re-audit

This revision addresses a failure mode in which every individual token is within an acceptable range but the assembled icon-and-label unit is aesthetically unbalanced. Relationships take precedence over isolated dimensions.

### Icon–typography paired scale contract

Treat a supporting icon tile and its adjacent label as one typographic unit. Never choose their sizes independently.

- Base the relationship on the label's rendered line-height, not only its nominal font size.
- A supporting tier-3 icon tile should normally measure `1.15–1.30×` the adjacent label line-height.
- Standard KPI header pairing:
  - label: `14px / 20px`, weight `600`;
  - label tone: primary or near-primary, not tertiary and not a washed-out secondary;
  - icon tile: `24px`;
  - glyph: `12–13px`;
  - horizontal gap: `9–10px`.
- Compact pairing:
  - label: `13px / 18px`, weight `600`;
  - icon tile: `22px`;
  - glyph: `11–12px`;
  - horizontal gap: `8–9px`.
- Do not exceed a `26px` supporting tile unless the icon itself is the content, a primary action, or a confirmed focal object.
- Long labels may truncate or use available horizontal space; they do not cause the icon to grow.

The label is the semantic anchor. The icon may attract initial attention, but it must immediately hand attention to the text rather than behaving like a separate illustration.

### Salience budget

Size, chroma, contrast, internal detail, elevation, and motion all consume attention. Evaluate their combined perceptual weight.

- A supporting icon should strongly emphasize no more than two attention dimensions at once.
- A tier-3 icon already spends attention on chroma and elevation; keep its geometry compact, its glyph simple, and its motion restrained.
- Do not enlarge an icon merely to make material effects legible. Compress the material into a smaller, well-resolved object.
- Saturation and white-on-color contrast make an icon appear optically larger than a neutral tile with identical CSS dimensions.
- The shadow footprint counts toward optical size. Keep the contact shadow tight enough that the icon does not acquire an invisible oversized bounding box.
- A hover lift must not turn a supporting icon into the dominant moving object in an otherwise static header.

### Optical balance

- Align the tile to the label's visual center, then inspect the glyph mass and shadow rather than trusting geometric centering alone.
- Prefer a compact glyph with sufficient white mass. A very thin outline inside a vivid tile can make the tile feel emptier and therefore larger.
- The icon may extend modestly above and below the label line box, but should not approach twice the label's visible capital height.
- Keep label contrast strong enough to share visual weight with the colored object.
- Title casing follows product language; casing must not be used to compensate for an undersized or low-contrast label.

### Assembly validation

Validate the assembled pair at its real interface size, not only in an enlarged crop:

1. Read computed tile size, label font size, label line-height, gap, and shadow extent together.
2. Confirm the tile-to-line-height ratio falls within the paired contract or document why the icon is intentionally focal.
3. Squint or lightly blur the view: the icon and label should read as one grouped header, not a large colored object followed by a caption.
4. Compare repeated headers: color changes may alter perceived weight, but their geometry and typographic authority should remain stable.
5. Reject the assembly when the icon is the dominant object after the metric value itself, when the label looks like metadata, or when reducing the icon by a small amount immediately improves the hierarchy.

## R4 Consistency System

Consistency is relational, not merely repetition. A surface is consistent when every font, weight, interval, inset, and responsive change belongs to a small semantic system and equivalent roles compute to equivalent values. Local plausibility does not excuse global drift.

### Type-role contract

Define typography by semantic role before styling selectors. Components consume role tokens; they do not invent nearby sizes or weights.

Recommended operational scale, assuming the browser default root size of `16px`:

| Role token | Size / line-height | Weight | Use |
|---|---|---:|---|
| `type.kpi` | `2rem / 2.125rem` | 500 | Large operational values only |
| `type.pageTitle` | `1.375rem / 1.75rem` | 600 | Page title |
| `type.sectionTitle` | `1rem / 1.375rem` | 600 | Board and group headings |
| `type.label` | `.875rem / 1.25rem` | 600 | Record names, KPI labels, primary compact labels |
| `type.body` | `.875rem / 1.25rem` | 400 | Ordinary interface content |
| `type.secondary` | `.8125rem / 1.125rem` | 400–500 | Roles, descriptions, navigation |
| `type.caption` | `.75rem / 1rem` | 500 | Chips, counts, timestamps, compact metadata |

- A role uses the same size, line-height, weight, and tone wherever it appears, unless a documented responsive or density variant remaps the role itself.
- Keep the number of visible roles small. Do not create `11px`, `12px`, `13px`, and `14px` variations merely because different components were authored separately.
- Reserve sizes below `.75rem` for exceptional nonessential marks; do not use them for information users must routinely read.
- Use a deliberate weight set such as `400`, `500`, `600`, and—only where needed—`700`. Avoid arbitrary pseudo-weights such as `520`, `550`, `620`, or `650`; fallback fonts may synthesize or collapse them unpredictably.
- Adjacent roles must differ clearly by at least one strong axis: size/line-height, weight, tone, or spacing. Multiple near-identical roles create noise rather than hierarchy.
- A component-specific optical correction may adjust tracking or position, but must not silently create a new semantic type role.

### `rem`, viewport, and user scaling

- Keep the root font size at `100%`. Do not set `html { font-size: 62.5%; }` or otherwise break the relationship to user preferences.
- Express interface font sizes and line-heights in `rem`. This preserves browser zoom and user font-size settings while keeping roles consistent.
- Dense operational typography should normally remain stable across viewport widths. Change the layout before shrinking text.
- Do not use raw `vw` units for body text, labels, navigation, chips, form controls, or table content.
- Use `clamp()` with a small viewport term only for roles whose hierarchy genuinely benefits from gentle fluidity, usually page titles or display text. Both endpoints must remain valid at browser zoom and narrow widths.
- Viewport width controls composition: columns, gutters, collapse, overflow, and visibility. It should not continuously rescale the entire interface.
- Prefer container queries when a reusable component adapts to its own available space. Do not make a card's typography depend on the global viewport when the card can appear in multiple layouts.
- At `200%` zoom, allow responsive reflow to activate. Do not counteract zoom with inverse viewport sizing.

### Spacing scale

Use one 4px-derived spacing scale expressed in `rem`:

```css
:root {
  --space-1: .25rem;  /* 4px  */
  --space-2: .5rem;   /* 8px  */
  --space-3: .75rem;  /* 12px */
  --space-4: 1rem;    /* 16px */
  --space-5: 1.25rem; /* 20px */
  --space-6: 1.5rem;  /* 24px */
  --space-8: 2rem;    /* 32px */
}
```

- Prefer scale values directly. Use an off-scale optical correction only when the rendered relationship demonstrably needs it, usually by `1–2px`, and keep it local.
- Do not accumulate a private spacing scale inside each component.
- Repeated components must share identical internal insets unless their density or function is explicitly different.

### Spacing ownership

Assign every interval a single owner:

- **Page or shell owns gutters and major section separation.**
- **Parent layout owns relationships among siblings**, normally through `gap`.
- **Component owns its internal padding.**
- **Content element owns intrinsic text rhythm**, such as paragraph leading.
- **Margin is reserved for document-flow separation or a deliberate one-sided exception.** Reusable children should not push themselves away from unknown neighbors.

Prefer `gap` over sibling margins in flex and grid layouts. Reset default heading and paragraph margins inside components, then let the parent or component wrapper establish rhythm. Avoid combining parent `gap`, child margin, and container padding to describe the same boundary.

### Padding logic

- Padding communicates containment. Increase it when an object becomes a stronger independent surface; reduce it for tightly repeated records.
- Horizontal and vertical padding need not match, but their difference must follow content density and control height rather than arbitrary taste.
- Align the left insets of headings, body text, and repeated cards when they belong to the same reading column.
- Control padding should support a consistent height and practical target size. Do not compensate for inconsistent typography with one-off vertical padding.
- Card padding should normally remain stable across desktop widths. Change it at a defined density/breakpoint step, not continuously with `vw`.

### Relationship to page and viewport

Fluidity belongs primarily to page-level whitespace:

```css
:root {
  --page-gutter: clamp(1rem, .65rem + 1vw, 1.5rem);
  --section-gap: clamp(1.25rem, 1rem + .5vw, 1.5rem);
}
```

- Use fluid page gutters within bounded endpoints; keep component micro-spacing tokenized and mostly fixed in `rem`.
- On smaller viewports, first change topology—collapse the sidebar, reflow actions, scroll the board, or reduce columns—before reducing component padding.
- A mobile layout may select a compact density tier, but it must remap the shared tokens rather than introduce unrelated values selector by selector.
- Large empty space in a kanban lane is structural capacity, not permission to inflate card padding or typography.

### Density modes

Implement density as token remapping:

```css
:root {
  --record-pad: var(--space-4);
  --record-gap: var(--space-3);
}

[data-density="compact"] {
  --record-pad: var(--space-3);
  --record-gap: var(--space-2);
}
```

Do not make a “compact” mode by patching many unrelated selectors with one-off numbers. Typography should remain readable; compactness comes mainly from insets and intervals.

### Consistency audit

Before considering a surface complete:

1. Inventory every unique `font-size`, `line-height`, and `font-weight`. Map each to a semantic role or remove it.
2. Inventory padding, margin, and gap declarations. Flag values outside the spacing scale and boundaries described by more than one owner.
3. Compare computed styles for repeated roles and repeated components; they should match across cards, lanes, navigation, and states.
4. Test at representative widths and at `100%`, `125%`, and `200%` zoom. Confirm that topology adapts before text becomes unreadable.
5. Check long labels and localization expansion. Consistency must survive wrapping and truncation.
6. Perform a rhythm pass at normal scale: tight relationships should repeat, major groups should have visibly larger separation, and no cluster should look accidentally compressed or inflated.

## Color System

### Neutral foundation

Use slightly warm grays. Avoid blue-gray application chrome unless the product intentionally needs a colder technical tone.

| Token | Suggested value | Role |
|---|---:|---|
| `color.canvas` | `#F4F5F2` | Page or app surroundings |
| `color.sidebar` | `#F7F6F2` | Persistent navigation |
| `color.surface` | `#FFFFFF` | Main workspace and cards |
| `color.surface.subtle` | `#FAFAF8` | Column headers, hover, quiet grouped areas |
| `color.border` | `#E4E6E2` | Default component border |
| `color.border.strong` | `#D5D8D3` | Focused grouping or selected boundary |
| `color.text` | `#292B29` | Primary content |
| `color.text.secondary` | `#747975` | Supporting labels |
| `color.text.tertiary` | `#A0A6A1` | Timestamps and low-priority metadata |
| `color.text.inverse` | `#FFFFFF` | Text on dark controls |
| `color.action.primary` | `#1D1E1C` | Primary button |
| `color.action.primaryHover` | `#090A09` | Primary button hover |

### Functional accents

Accent hues identify stages and statistics; they should not flood large surfaces.

| Family | Base | Pale tint | Typical role |
|---|---:|---:|---|
| Amber | `#FFA300` | `#FFF4D8` | New/applied, rating, attention |
| Blue | `#4B9DFF` | `#EAF4FF` | In progress, interview, information |
| Magenta | `#F13EDF` | `#FDE9FB` | Offer, hired, achieved milestone |
| Indigo | `#7778F2` | `#EEEEFF` | Rejected/terminal category or alternate pipeline |
| Green | `#45B953` | `#EAF8EC` | Positive movement and success |
| Coral | `#FF6478` | `#FFF0F2` | Negative movement, risk, error feedback |

### Color allocation rules

- Keep large operational backgrounds neutral. Allocate accent area by perceptual purpose rather than a fixed percentage.
- Prefer an accent in one of four forms: a saturated dimensional `22–26 px` icon tile sized by the R3 paired-scale contract, a 2 px rule, a 6 px dot, or a pale semantic chip. The icon tile is the principal chroma anchor; the others reinforce it.
- Within one component, use no more than one stage accent plus one semantic feedback color.
- Never use the same red for both “rejected” and “metric decreased” without a label or icon; the meanings are different.
- Do not rely on color alone. Pair stage color with text, placement, or an icon.
- Saturated accents on white are often too light for body text. Preserve them for solid decorative/category surfaces with white glyphs, or derive a darker companion specifically for text.
- The primary action remains charcoal/black even when the surrounding stage is colorful. This preserves a stable action hierarchy.

## Typography

### Recommended roles

- Interface family: a neutral or lightly humanist sans such as Inter, Geist, SF Pro, or a comparable system font.
- KPI display family: an optional restrained serif such as Source Serif, DM Serif Text, or Georgia.
- Do not mix more than two families.

### Type scale

| Role | Size / line height | Weight | Notes |
|---|---|---:|---|
| Page title | `22 / 28` | 600 | Quiet, not marketing-sized |
| Section title | `16 / 22` | 600 | Column and card group titles |
| Body / record name | `14 / 20` | 500–600 | Main operational text |
| Body secondary | `13 / 18` | 400 | Roles and descriptive metadata |
| Label / navigation | `13 / 18` | 500 | Consistent scanning rhythm |
| Chip / caption | `11–12 / 16` | 500 | Never compress below 11 px |
| KPI | `30–34 / 36` | 500 | Optional serif; use tabular figures where possible |

Use weight, tone, and spacing before increasing font size. Avoid bolding every label. Truncate long record names to one line, but preserve the avatar, status, and primary action.

## Layout Logic

### Application shell

- Desktop shell: white surface, approximately `1440–1680 px` wide when presented as a mockup.
- Presentation-only shell radius: `0–4 px` in the reference; a production app may use none.
- Presentation-only shell shadow: broad and very soft, for example `0 24px 70px rgba(31, 36, 31, 0.12)`.
- Never repeat this large shadow on interior components.

### Main frame

- Sidebar: `264–288 px` fixed width.
- Top utility bar: `64–72 px` height.
- Workspace padding: `24 px` desktop; `16–20 px` compact desktop/tablet.
- Major vertical section gap: `20–24 px`.
- Card and grid gap: `14–16 px`.

### Grid alignment

The summary strip and the workflow board should share the same column grid. In the reference, four KPI cards align vertically with four kanban lanes. This creates order before the user reads any text.

Use:

```css
grid-template-columns: repeat(4, minmax(240px, 1fr));
gap: 16px;
```

If four columns cannot remain useful, allow horizontal board scrolling or change the workflow representation. Do not squeeze record cards until names and statuses become unreadable.

### Responsive behavior

- `>= 1280 px`: persistent sidebar; four-column summary and board.
- `960–1279 px`: collapsible sidebar; summary may become 2 × 2; board scrolls horizontally.
- `640–959 px`: sidebar becomes drawer; summary is 2 columns; board is horizontal snap or stage switcher.
- `< 640 px`: summary is a vertical list or 2-column compact grid; show one workflow stage at a time.

Do not merely scale the desktop canvas down. Preserve task order: title → primary action → summary → controls → records.

## Spacing and Shape Tokens

Use a 4 px base unit with an 8 px dominant rhythm.

```text
space.1 = 4
space.2 = 8
space.3 = 12
space.4 = 16
space.5 = 20
space.6 = 24
space.8 = 32
```

Recommended radii:

```text
radius.chip   = 999px
radius.icon   = 7–8px
radius.button = 9–10px
radius.card   = 10–12px
radius.panel  = 12–14px
```

Nested objects should usually have the same or a slightly smaller radius than their parent. Do not create a “bubble stack” where every nested rectangle becomes more rounded.

## Elevation and Visual Hierarchy

Use borders as the default separator and shadows only for elements that actually sit above another plane.

### Suggested elevation ladder

| Level | Treatment | Examples |
|---|---|---|
| 0 | Warm canvas, no border | Page environment |
| 1 | White or warm surface, optional divider | Sidebar, workspace |
| 2 | White surface + `1 px` border | KPI card, kanban lane |
| 3 | White surface + slightly stronger border | Candidate card, selected record |
| 4 | Soft shadow + stronger contrast | Menu, popover, dragging card |
| 5 | Broad presentation shadow | Entire app shell in a mockup only |

Hierarchy should be legible in grayscale. If removing all accents makes the layout collapse, the structure is relying too heavily on color.

## Component Recipes

### Sidebar navigation

- Warm off-white background distinct from the white workspace.
- Group labels use tertiary text and generous top spacing.
- Default navigation item: transparent, secondary text, monochrome icon.
- Hover: subtle warm-gray fill.
- Active: white fill, primary text, medium weight; optional minimal shadow or border.
- Item height: `40–44 px`; horizontal padding: `12–14 px`; radius: `9–10 px`.
- Keep icons low contrast until active. The content, not the chrome, should dominate.

### Top utility bar

- Use a single bottom divider rather than a shadow.
- Breadcrumb/navigation sits left; global utilities sit right.
- Icon-only buttons must have tooltips and accessible names.
- Keep utilities visually quieter than page-level actions.

### Page header and actions

- Page title on the left; actions aligned right on desktop.
- One filled dark primary button per action cluster.
- Secondary actions use white surface, gray border, and secondary text.
- Tertiary actions may be icon-only only when the icon is conventional and labeled accessibly.
- Recommended control height: `38–40 px`.
- Button padding: `12–14 px` horizontal; icon gap: `8 px`.

### Primary button

- Charcoal fill, white label, restrained radius.
- Optional subtle vertical highlight is acceptable; avoid glossy skeuomorphism.
- Use a soft low shadow only if needed to separate it from white.
- Hover: darken slightly; active: remove or reduce shadow and translate at most 1 px.
- Do not use an accent-colored primary action just because a nearby status uses that accent.

### Secondary button

- White fill, `1 px` neutral border, secondary text.
- Hover uses subtle surface tint and darker text.
- Selected/toggled state needs more than a hover-color difference: add stronger border, fill, or checkmark.

### KPI card

- Border and white background; usually no shadow.
- Header row: saturated tier-3 pseudo-3D icon tile, label, overflow menu. Do not render the key icon as a pale background with a dark glyph.
- Size the tile, glyph, label, and gap as a paired unit using R3. The default is a `24px` tile beside a `14px / 20px` near-primary label, not a large tile beside caption-sized gray text.
- Metric is the largest element and may use the serif display face.
- Supporting sentence is tertiary.
- Delta badge is compact, outlined, and semantic: green for favorable, coral for unfavorable.
- Never infer favorable/unfavorable from numerical direction alone. For metrics such as time-to-hire or rejected candidates, the product meaning determines the semantic color.

### Kanban lane

- Quiet panel background, `1 px` border, `12–14 px` radius.
- Header height: approximately `48–52 px`.
- Stage title plus neutral count badge on the left; add control on the right.
- A `2 px` colored rule directly below the header identifies the stage.
- Lane body remains neutral, allowing record cards to read as the active objects.

### Record card

- White surface, `1 px` border, `10–12 px` radius.
- Internal padding: `14–16 px`.
- Vertical groups: identity → attributes → outcome/status.
- Avatar: `36–40 px`; image or initials fallback.
- Name: single line, medium/semibold.
- Role and time: secondary/tertiary, separated by a dot.
- Skills: neutral chips, not rainbow tags.
- Bottom row: score on the left and current activity on the right.
- A small stage-colored dot may precede the activity label.
- Hover may strengthen the border or add `0 3px 10px rgba(30, 35, 30, 0.06)`; default state should remain flat.

### Chip / tag

- Neutral chip fill: `#F1F2EF`.
- Text: `11–12 px`, medium weight, secondary tone.
- Height: `20–24 px`; horizontal padding: `7–9 px`.
- Radius: pill or `6–8 px`, but stay consistent within a product.
- Attribute chips are neutral; semantic chips use a pale tint plus dark text/icon.
- Limit visible chips to the number that fits comfortably. Replace overflow with `+N` instead of wrapping a card into an irregular height unless variable height is intentional.

### Avatar and human imagery

- Use real, consistent portraits where available; otherwise use initials on a pale tint.
- Keep avatar backgrounds diverse and warm. They may carry medium chroma; avoid making every initials fallback gray or dusty.
- Do not use avatar color as status color; identity and workflow state are separate information channels.
- Provide a predictable fallback and avoid layout movement during image load.

### Search and form controls

- White surface, `1 px` neutral border, `10 px` radius.
- Placeholder is tertiary but still readable.
- Focus state: a darker border plus a subtle ring; do not use color alone.
- Control heights should align with neighboring buttons.

## Handling Visual and Semantic Conflicts

### When many colors compete

1. Preserve stage color in its dimensional summary icon and reinforce it with a rule or dot; do not reduce every stage to micro-accents.
2. Convert attribute tags to neutral chips.
3. Keep semantic feedback colors for success, warning, and error.
4. Keep the primary action dark and stable.
5. Remove decorative color before reducing semantic clarity.

### When borders accumulate through nesting

- Use a boundary only where grouping would otherwise be ambiguous.
- Differentiate adjacent levels with a subtle background change before adding a second border.
- A lane can have a border and its record card can have a border, but the lane body should not also contain a third bordered wrapper.
- Increase border contrast on interaction instead of adding a permanent shadow.

### When density conflicts with warmth

- Preserve whitespace around sections and compress repeated metadata inside cards.
- Use avatars and short plain-language labels to humanize dense operational data.
- Hide or summarize low-priority attributes; do not shrink text below readable sizes.
- Keep card heights consistent within a lane when rapid comparison matters.

### When hierarchy conflicts with consistency

- Let the page-level primary action be the darkest control.
- Let records carry stronger local contrast than their container.
- Use repeated geometry for consistency, then create hierarchy using spacing, text weight, and tone.
- Avoid making headers, lanes, cards, chips, and buttons all equally prominent.

### When long content conflicts with the grid

- Truncate names and roles with an accessible full-value tooltip.
- Collapse extra chips to `+N`.
- Keep essential state visible; allow optional metadata to disappear first.
- Do not reduce a kanban lane below a useful record-card width of roughly `240 px`.

### When status and trend meanings collide

- A stage is categorical; a trend is directional. Represent them differently.
- Use a line/dot/icon family for stages.
- Use arrows plus semantic text/color for trends.
- Add labels where a color can plausibly mean more than one thing.

## Interaction States

Every interactive component needs default, hover, focus-visible, active, disabled, loading, and—when relevant—selected states.

- Hover changes should be subtle and must not be the only indication of interactivity.
- Focus-visible should be unmistakable: typically a 2 px ring with sufficient contrast and 2 px offset.
- Disabled controls should reduce emphasis without becoming unreadable.
- Loading actions should preserve control width and show progress locally.
- Dragging a kanban card may use elevation level 4 and a slight rotation of no more than 1 degree; provide a non-drag keyboard alternative.
- Respect reduced-motion preferences.

## Accessibility Floor

- Meet WCAG contrast requirements for text and meaningful icons.
- Do not use pale saturated colors for small text without darkening them.
- Never encode workflow state with color alone.
- Provide accessible names for icon-only buttons and tooltips for unfamiliar icons.
- Maintain at least a 40 × 40 px practical pointer target for frequently used controls; use 44 × 44 px where the platform expects it.
- Preserve visible keyboard focus across cards, buttons, sidebar items, menus, and drag/drop alternatives.
- Ensure truncation does not hide the only available version of important content.

## Composition Rules

- Align related modules to a shared grid.
- Use one clear action hierarchy per region.
- Keep saturation local and purposeful.
- Prefer repeated card anatomy over bespoke arrangements for each record.
- Let neutral whitespace do most of the separating.
- Use human faces and plain-language labels to soften operational density.
- Keep the interface flatter toward the center; reserve greater elevation for temporary overlays and the outer presentation frame.

## Anti-patterns

Do not:

- turn this into neumorphism; the reference depends on borders and clean surfaces, not extruded softness;
- apply large blurred shadows to every card;
- fill entire kanban lanes with saturated color;
- make every chip a different hue;
- replace every saturated key icon tile with a pale tint in the name of restraint;
- apply pseudo-3D treatment to navigation, utility, and ordinary button icons;
- use coral/red as a workflow-category default when it is already needed for semantic feedback;
- invent selector-specific font sizes or arbitrary intermediate weights when a semantic role already exists;
- scale operational text continuously with viewport width;
- mix `px`, `rem`, and `vw` for equivalent typography roles;
- let reusable children own their external spacing through default margins;
- combine parent gap and child margins for the same sibling relationship;
- introduce off-scale padding and margin values without a demonstrated optical reason;
- use extreme pill shapes for every container;
- use serif typography across navigation and dense metadata;
- use a photographic background inside the operational workspace;
- give multiple actions equal filled-button emphasis;
- compress the board until record cards become narrow strips;
- equate “friendly” with oversized bubbly typography, mascots, or excessive animation;
- copy the screenshot literally when product semantics demand different colors or workflows.

## Implementation Decision Checklist

Before considering a surface complete, verify:

- The interface remains understandable in grayscale.
- A single primary action wins each action cluster.
- Summary modules and workflow modules share meaningful alignment.
- Color roles do not conflict with semantic feedback.
- Large areas remain neutral and calm.
- Nested borders stop at the level needed for grouping.
- Text, chips, and controls remain readable at realistic data density.
- Long names, many tags, missing avatars, zero states, loading states, and errors have defined behavior.
- Desktop hierarchy survives responsive restructuring rather than simple shrinking.
- Typography declarations map to semantic roles and respect user scaling.
- Spacing values come from one scale, and every interval has a single owner.
- Focus, hover, selected, disabled, loading, and drag alternatives are specified.

## Raw Prompt Contract

When applying this draft to a new interface:

1. Preserve the product’s actual information architecture, terminology, permissions, and workflow semantics.
2. Use the neutral foundation as the default visual world.
3. Assign accents by product meaning, not by copying the reference’s stage names.
4. Establish the shared grid and hierarchy before styling individual components.
5. Implement components using the recipes above, adjusting density to the real content.
6. Test conflict cases: multiple accents, long content, nested borders, semantic red/green reversals, and small viewports.
7. Reject any result that looks colorful because large surfaces were tinted rather than because small accents were orchestrated.

The intended result should feel like a capable work tool with a warm bedside manner: clear enough for repeated daily use, cheerful enough to reduce administrative fatigue, and layered enough that users immediately understand where they are and what they can act on.
