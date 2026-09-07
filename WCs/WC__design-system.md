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
  `border-accent`, `--radius-lg` → `rounded-lg`, etc).
- **shadcn/ui** components (`components/ui/`) — Radix primitives styled
  with Tailwind, copied into the repo and owned directly rather than
  installed as an opaque package. Only `Dialog` exists so far.
- **Dark-only.** No light theme exists or is planned; `color-scheme:
dark` is set globally so native controls (text selection, autofill)
  match.
- **Desktop-only**, minimum window width 1200px. No phone/tablet
  responsive layout — this is a native app, not a website.

## Color tokens

All defined in `styles.css`'s `@theme` block.

### Surfaces (background layers, darkest to lightest)

| Token         | Value     | Use                                                                                                                                               |
| ------------- | --------- | ------------------------------------------------------------------------------------------------------------------------------------------------- |
| `bg-page`     | `#08080a` | Not currently used as a Tailwind class (no `--color-bg-page`-only element) — reserved for an eventual outer app-chrome layer if one exists later. |
| `bg`          | `#131316` | Base app background, modal background.                                                                                                            |
| `bg-elevated` | `#1a1a1e` | Cards, pills, badges, input backgrounds — one step "up" from base.                                                                                |
| `bg-hover`    | `#212127` | Hover state for interactive rows/buttons on `bg`.                                                                                                 |
| `bg-active`   | `#24242b` | Active/pressed state, one step past hover.                                                                                                        |

### Text (hierarchy, brightest to dimmest)

| Token        | Value     | Use                                                         |
| ------------ | --------- | ----------------------------------------------------------- |
| `text`       | `#f2f2f4` | Primary text — headings, active/selected item names.        |
| `text-muted` | `#9a9aa4` | Secondary text — descriptions, body copy.                   |
| `text-faint` | `#6d6d78` | Tertiary — timestamps, icon-only accents, placeholder text. |

### Borders

| Token           | Value                    | Use                                             |
| --------------- | ------------------------ | ----------------------------------------------- |
| `border`        | `rgba(255,255,255,0.08)` | Default hairline — separators, card borders.    |
| `border-strong` | `rgba(255,255,255,0.14)` | More prominent — button borders, input borders. |

### Brand / accent (indigo — the app's one brand color)

| Token           | Value                   | Use                                                                                             |
| --------------- | ----------------------- | ----------------------------------------------------------------------------------------------- |
| `accent`        | `#6366f1`               | Primary action color — the "Restore workspace" button, active sidebar item border, focus rings. |
| `accent-hover`  | `#5254d8`               | Hover state for accent-colored buttons.                                                         |
| `accent-soft`   | `rgba(99,102,241,0.14)` | Tinted background — active sidebar item, the brand mark badge.                                  |
| `accent-border` | `rgba(99,102,241,0.4)`  | Border for accent-tinted elements (active sidebar item, focused input).                         |

This is deliberately the _only_ brand color decision made so far —
picked because it's what the existing app already uses, not a fresh
choice. Revisit once the landing page's visual identity exists, so the
app and the pitch asset are decided together rather than the app
locking one in first.

### Semantic (restore results)

| Token     | Value     | Use                                                 |
| --------- | --------- | --------------------------------------------------- |
| `success` | `#4ade80` | Succeeded step icon in restore results.             |
| `danger`  | `#f87171` | Failed step icon in restore results, error banners. |

### Tool badge colors

A fixed set of 7, keyed by the `color` string on workspace/tool data
(`"blue"`, `"sky"`, `"zinc"`, `"orange"`, `"violet"`, `"green"`,
`"amber"`) — the color a specific tool type (VS Code, Docker, Chrome,
...) is drawn in, everywhere it appears (timeline step icon, "new
workspace" tool row).

Each has a saturated `tool-{name}` tone (icon color) and a soft,
translucent `tool-{name}-soft` tint (badge background) — e.g.
`--color-tool-blue: #60a5fa` / `--color-tool-blue-soft:
rgba(59,130,246,0.14)`.

**Don't apply these via `className="bg-tool-${color}"` template
interpolation** — Tailwind can't generate CSS for a class it can't see
as literal text in source. Use the lookup in
`apps/desktop/src/renderer/src/lib/tool-colors.ts`
(`toolBadgeClasses(color)`) instead, which enumerates every known key
as a complete static class string.

### Tag dot colors

The small colored dot next to each workspace name in the sidebar.
5 keys: `"blue"`, `"violet"`, `"amber"` (reuse the matching `tool-*`
tone above), plus two tag-only colors: `tag-emerald` (`#34d399`) and
`tag-rose` (`#fb7185`). Same rule: use `tagDotClasses(color)` from
`lib/tool-colors.ts`, never a dynamic class string.

### Adding a new tool/tag color

1. Add `--color-tool-{name}` (+ `-soft` if it's a badge color) to
   `styles.css`'s `@theme`.
2. Add the key to the relevant lookup object in `lib/tool-colors.ts`.
3. Never skip the lookup — a template-interpolated class name silently
   renders unstyled (Tailwind won't have generated the CSS for it).

## Radius scale

| Token        | Value                                                      |
| ------------ | ---------------------------------------------------------- |
| `rounded-sm` | 7px — inputs, small badges, pills-that-aren't-fully-round. |
| `rounded-md` | 9px — buttons.                                             |
| `rounded-lg` | 12px — modal, larger cards.                                |

These override Tailwind's own default `sm`/`md`/`lg` radius scale
(normally 4/6/8px) — the values above are what's actually in use
throughout the app. A one-off radius that doesn't match any of these
(rare — e.g. the 8px brand mark badge) uses an arbitrary value
(`rounded-[8px]`) rather than forcing it onto the nearest token.

## Typography

No named type scale — font sizes are exact arbitrary values
(`text-[12.5px]`, `text-[13.5px]`, etc.) matching the original design
pixel-for-pixel, since most sizes in this design don't land on
Tailwind's default scale. Font family is set once, globally, on
`body` in `styles.css` (system font stack — `-apple-system`, `SF Pro
Text`, ...); components never set `font-family` themselves. Monospace
text (commands, paths) uses Tailwind's default `font-mono`.

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
