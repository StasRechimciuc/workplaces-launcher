# Design System

The visual language for Workspace Launcher's UI — colors, spacing, and
component conventions. Source of truth for values is
`apps/desktop/src/renderer/src/styles.css`'s `@theme` block; this doc
explains _why_ things are shaped the way they are and how to extend
them consistently.

## Stack

- **Tailwind v4**, configured via CSS (`@theme` in `styles.css`) — there
  is no `tailwind.config.js`. This is v4's real config mechanism, not a
  simplified stand-in for one; every custom token below becomes a real
  utility class (`--color-accent` → `bg-accent`/`text-accent`/
  `border-accent`, `--radius-lg` → `rounded-lg`, `--font-serif` →
  `font-serif`, etc).
- **shadcn/ui** components (`components/ui/`) — Radix primitives styled
  with Tailwind, copied into the repo and owned directly rather than
  installed as an opaque package. Only `Dialog`/`DropdownMenu` exist so
  far.
- **Dark and light, both real.** Dark is the default; light is applied
  via `data-theme="light"` on `<html>`, toggled from Settings
  (`lib/theme.ts`), with `color-scheme` set to match so native controls
  (text selection, autofill) follow. (This doc previously claimed
  "dark-only, no light theme planned" — stale; light shipped a while
  ago. Fixed here, 2026-10-21.)
- **Desktop-only**, minimum window width 1200px. No phone/tablet
  responsive layout — this is a native app, not a website.

## Color tokens

All defined in `styles.css`'s `@theme` block (dark, the default) and
redefined in `:root[data-theme='light']` for light — a component never
branches on theme itself, it just uses the token class and the CSS
cascade picks the right value. Ported 2026-10-21 from a dedicated
redesign (two full mockups, "Graphite · Blue" dark / "Paper · Blue"
light, built against this app's own real screens) — replacing the
original indigo/near-black palette this doc used to document.

### Surfaces (background layers)

| Token         | Dark                      | Light                     | Use                                                                                                                                                       |
| ------------- | -------------------------- | -------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `bg-page`     | `#06060a`                  | `#f9f6ef`                  | Outermost app background.                                                                                                                                 |
| `bg`          | `#101014`                  | `#f3efe7`                  | Base app background, sidebar, modal background.                                                                                                           |
| `bg-elevated` | `#17171d`                  | `#fbf9f4`                  | Cards, pills, badges, input backgrounds — one step "up" from base.                                                                                        |
| `bg-hover`    | `rgba(255,255,255,.035)`   | `rgba(128,120,100,.10)`    | Hover state — a translucent overlay, not a fixed hex, so it reads correctly over whatever surface sits beneath it (the source design's own mechanism).    |
| `bg-active`   | `rgba(255,255,255,.07)`    | `rgba(128,120,100,.16)`    | Active/pressed state, double the hover overlay's opacity — the source only specified one overlay value; this extrapolates the existing hover/active ratio. |

### Text (hierarchy, brightest to dimmest)

| Token        | Dark      | Light     | Use                                                          |
| ------------ | --------- | --------- | ------------------------------------------------------------- |
| `text`       | `#f3f3f8` | `#1b1a17` | Primary text — headings, active/selected item names.         |
| `text-muted` | `#bfbfcb` | `#4b4740` | Secondary text — descriptions, body copy.                    |
| `text-faint` | `#767684` | `#8a8478` | Tertiary — timestamps, icon-only accents, placeholder text.  |

### Borders

| Token           | Dark                      | Light                 | Use                                             |
| --------------- | -------------------------- | ---------------------- | ------------------------------------------------ |
| `border`        | `rgba(255,255,255,0.08)`   | `rgba(0,0,0,0.08)`     | Default hairline — separators, card borders.    |
| `border-strong` | `#26262f`                  | `#ded7c7`               | More prominent — button borders, input borders. |

### Brand / accent (blue — user-customizable, see Settings)

| Token           | Value                                                       | Use                                                                                                                    |
| --------------- | -------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------- |
| `accent`        | `#3b6cf0` default (same in both themes)                        | Primary action color — the "Restore workspace" button, active sidebar item border, focus rings, step-number circles. |
| `accent-hover`  | `color-mix(in srgb, var(--color-accent) 94%, white)`            | Hover state for accent-colored buttons — derived, not a separately hand-picked hex.                                   |
| `accent-soft`   | `color-mix(in srgb, var(--color-accent) 14%, transparent)`      | Tinted background — active sidebar item, the brand mark badge — derived from `accent`.                                |
| `accent-border` | `color-mix(in srgb, var(--color-accent) 40%, transparent)`      | Border for accent-tinted elements — derived from `accent`.                                                            |

`accent-hover`/`-soft`/`-border` are deliberately `color-mix()`
derivations off the one `accent` variable, not separately hand-picked
hexes — this is also the entire mechanism Settings' Primary Color
picker relies on: it only ever overrides `--color-accent` itself (same
`localStorage`-backed pattern as `lib/theme.ts`), and every derived
shade follows automatically with zero per-component changes. See
`lib/accent-color.ts`. Known, accepted limitation: the text rendered on
top of an accent-filled button stays fixed white regardless of the
chosen color — a very pale user-chosen accent could fail contrast
there; not solved in v1, flagged rather than silently assumed fine.

### Semantic (restore results)

| Token     | Dark      | Light     | Use                                                                                                                              |
| --------- | --------- | --------- | --------------------------------------------------------------------------------------------------------------------------------- |
| `success` | `#4ade80` | `#2f7d4f` | Succeeded step icon in restore results.                                                                                         |
| `danger`  | `#f87171` | `#f87171` | Failed step icon in restore results, error banners. The source redesign didn't touch error/danger styling — unchanged, both themes. |

### Tool badge colors

A fixed set of 7, keyed by the `color` string on workspace/tool data
(`"blue"`, `"sky"`, `"zinc"`, `"orange"`, `"violet"`, `"green"`,
`"amber"`) — the color a specific tool type (VS Code, Docker, Chrome,
...) is drawn in, everywhere it appears (timeline step icon, "new
workspace" tool row).

Each has a saturated `tool-{name}` tone (icon color) and a soft,
translucent `tool-{name}-soft` tint (badge background). Four of the
seven (`blue`/`sky`/`violet`/`amber`) are genuinely **theme-specific**
— the source redesign tuned these four per background (lighter/more
saturated against the dark page, deeper/more muted against the light
one), e.g. `--color-tool-blue: #6aa8ff` (dark) vs `#2f6fde` (light).
The other three (`zinc`/`orange`/`green`) plus the two tag-only colors
below are theme-invariant, same as before — not part of the source
redesign, left unchanged (a saturated fg over a low-opacity tint reads
fine on either background by construction).

**Don't apply these via `className="bg-tool-${color}"` template
interpolation** — Tailwind can't generate CSS for a class it can't see
as literal text in source. Use the lookup in
`apps/desktop/src/renderer/src/lib/tool-colors.ts`
(`toolBadgeClasses(color)`) instead, which enumerates every known key
as a complete static class string.

### Tag dot colors

The small colored dot next to each workspace name in the sidebar.
5 keys: `"blue"`, `"violet"`, `"amber"` (reuse the matching `tool-*`
tone above, so these are also theme-specific), plus two tag-only
colors: `tag-emerald` (`#34d399`) and `tag-rose` (`#fb7185`, both
theme-invariant). Same rule: use `tagDotClasses(color)` from
`lib/tool-colors.ts`, never a dynamic class string.

### Adding a new tool/tag color

1. Add `--color-tool-{name}` (+ `-soft` if it's a badge color) to
   `styles.css`'s `@theme` — and to the light-theme override block too
   if it needs theme-specific tuning (most don't, see above).
2. Add the key to the relevant lookup object in `lib/tool-colors.ts`.
3. Never skip the lookup — a template-interpolated class name silently
   renders unstyled (Tailwind won't have generated the CSS for it).

## Radius scale

| Token        | Value |
| ------------ | ----- |
| `rounded-sm` | 8px — inputs, small badges, pills-that-aren't-fully-round. |
| `rounded-md` | 13px — buttons. |
| `rounded-lg` | 21px — modal, larger cards. |

These override Tailwind's own default `sm`/`md`/`lg` radius scale
(normally 4/6/8px) — the values above are what's actually in use
throughout the app, ported 2026-10-21 from the same redesign as the
colors above (previously 7/9/12px). A one-off radius that doesn't
match any of these uses an arbitrary value (`rounded-[Npx]`) rather
than forcing it onto the nearest token.

## Typography

**Two fonts, self-hosted** (`public/fonts/`, see that folder's own
`NOTICE.md` for licensing) — not loaded from a Google Fonts CDN link,
since this app's CSP (`style-src 'self'`, no `font-src`/`connect-src`)
blocks that outright, and bundling matches this project's existing
preference for local assets (tool logos, same pattern).

- **Instrument Sans** (`font-sans`, `--font-sans` in `styles.css`) —
  the app's default body font, set once globally on `body`; components
  never set `font-family` themselves.
- **Fraunces** (`font-serif`, `--font-serif`) — deliberately scoped to
  exactly the three places the source redesign uses it, applied via
  the `font-serif` utility at each call site, never as a second base
  font everything inherits: the sidebar wordmark (`Sidebar.tsx`), a
  workspace's page-level `<h1>` (`Detail.tsx`), and the step-number
  circles in the restore timeline (`TimelineStep.tsx`). Always paired
  with `font-semibold` (weight 600, matching the source's `--fhw`) —
  Fraunces is a variable font but this app only ever uses that one
  weight. The page `<h1>` additionally uses `tracking-[-0.015em]`
  (the source's `--fhls`), a tighter tracking than this app's other
  headings' `-0.01em`.

No named type scale beyond that — font sizes are exact arbitrary
values (`text-[12.5px]`, `text-[13.5px]`, etc.) matching the original
design pixel-for-pixel, since most sizes in this design don't land on
Tailwind's default scale. Monospace text (commands, paths) uses
Tailwind's default `font-mono`.

## Component conventions

- **Primary action button** (`Restore workspace`) — `bg-accent`,
  white text, `rounded-md`, a two-layer shadow (inset highlight +
  colored glow). `hover:bg-accent-hover`, `disabled:opacity-60
disabled:cursor-default`.
- **Ghost button** (`Cancel`, `Settings`) — transparent background,
  `border-border-strong`, `text-text-muted`, `hover:bg-bg-hover
hover:text-text`.
- **Icon-only button** (`•••` more menu, dialog close) — square,
  `rounded-md`, same hover treatment as ghost buttons, no border unless
  it's a bordered icon button (`.btn-icon`-equivalent — check the
  actual usage, some are borderless).
- **Pill** (stat pills in the detail header) — `rounded-full`,
  `bg-bg-elevated`, `border-border`, small text, icon in `text-faint`.
- **Badge** (tool icon chip) — `rounded-sm`, sized per context (28px in
  the timeline, 24px in the create-workspace tool list), colored via
  `toolBadgeClasses()`.
- **Modal** — always `components/ui/dialog.tsx` (Radix `Dialog`), never
  a hand-rolled `<div>` overlay. Gets focus-trap/Escape/click-outside/
  ARIA for free; don't reimplement any of that manually.
- **Sidebar list item** — hover: `bg-bg-hover`; active/selected:
  `bg-accent-soft` + `border-accent-border`, name text turns full
  white (not just `text` token) to read as "selected," not just
  "hovered."
- **Conditional/merged classNames** — always use the `cn()` helper
  (`lib/utils.ts`, clsx + tailwind-merge) — never a hand-rolled
  template-literal ternary. Keeps conflicting-utility resolution
  consistent and matches how `components/ui/dialog.tsx` already does it.

## Icons

Custom inline SVG set (`icons.tsx`, `ICON_PATHS`) ported from the
original mockup — not `lucide-react` or another icon package, even
though shadcn conventionally pairs with lucide. Deliberate: the mockup
was designed against this exact icon set's shapes: adding a second icon
system would mean two visually-inconsistent icon styles in the same
app. Add a new icon by adding its path data to `ICON_PATHS`, not by
installing a new icon library.
