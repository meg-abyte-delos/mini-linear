# Mini-Linear design direction

Owner: Iris (frontend & design). Reference: the real Linear app (2025-2026 desktop UI, dark first).
Rule zero: **no raw values in component CSS**. Every color, size, duration comes from `src/app/tokens.css` (source of truth for dark values, incl. `--line` and `--hover`), `src/app/ui-light.css` (light overrides) or a named component dimension in `src/app/ui-primitives.css`. Rex refuses a PR that adds an ad hoc button, input or color.

## 1. Palette (tokens)
| Token | Dark | Light | Use | Linear ref |
|---|---|---|---|---|
| `--bg` | #08090a | #ffffff | app background | Linear canvas |
| `--side` | #0b0c0d | #f9f9fa | sidebar | sidebar a notch above canvas |
| `--panel` | #0f1011 | #fbfbfc | group headers, columns, fields | |
| `--raised` | #1c1d1f | #ffffff | cards, popovers, dialogs | |
| `--line` / `--line-soft` | #23252a / #1a1b1e | #e6e6e9 / #efeff1 | borders / row hairlines | 1px hairlines only |
| `--hover` / `--sel` | #141516 / #1c1d22 | #f3f3f5 / accent 9% | hover / selected row | |
| `--fg` | #f7f8f8 | #1b1c1f | primary text | |
| `--muted-strong` | #d0d6e0 | #3c3f45 | secondary text, ghost buttons | |
| `--muted` | #969ba4 | #5f636b | ids, meta | |
| `--dim` | #8a8f98 | #696d75 | placeholders, disabled, decorative | |
| `--accent` | #5e6ad2 | same | primary action, focus, selection | Linear indigo |
| `--accent-text` | #8d95ec | | accent as text on dark (AA) | |
| `--danger` / `--warn` | theme.css | #c62828 / #8a5a00 | destructive / warning | |
| status `--s-*` | backlog #6b6f76, todo #bfc2c8, progress #f2c94c, review #4cb782, done #5e6ad2 | | status icons only | |

Never use `--accent` as body text on dark (use `--accent-text`). No new hex in components.

## 2. Type
Font `--font-sans` (Inter Variable). Scale: `--fs-xs` 11 (labels, kbd) · `--fs-sm` 12 (meta, chips, 24px buttons) · `--fs-base` 13 (default UI) · `--fs-lg` 15 (dialog titles) · `--fs-xl` 18 (section) · `--fs-2xl` 24 (page title). Weights 450 / 500 (labels, buttons) / 600 (titles). Line-height 1.25 tight, 1.45 base. Ids: tabular-nums, `--tracking-id`. Linear: 13px UI, medium 500 for interactive text, never bold body.

## 3. Spacing, radius, elevation
- 4px grid: `--sp-1` 4 · `--sp-2` 8 · `--sp-3` 12 · `--sp-4` 16. Paddings and gaps are multiples of 4 (2px allowed only inside 24px controls).
- Radius: `--r-sm` 5 (menu items, small controls), `--r-btn` 6 (buttons, inputs, side items), `--r-md` 8 (cards, popovers), `--r-lg` 12 (dialogs). Columns 10.
- Elevation: flat surfaces + 1px line. Shadows only for floating layers: `--shadow-pop` (menus, tooltips, dialogs), `--shadow-lg` (palette). No shadow on cards or rows.
- Density: list row `--row-h` 44, group header `--group-h` 36, sidebar item 28, chip `--chip-h` 22, header bar 44.

## 4. Icons
16px viewBox, stroke 1.2-1.5, `stroke:currentColor`, `aria-hidden` unless it carries meaning (then `<title>`). In list rows, avatar and its placeholder (`.av-none-ic`) share one 18px box so columns align to the pixel. Status icons 14-16px colored by `--s-*`.

## 5. Motion
`--dur-instant` 80ms (hover), `--dur-fast` 120ms (color/border), `--dur-base` 120ms (popover, menu, dialog), `--dur-slow` 200ms (panels). Easing `--ease-out` for enter, `--ease-in` for exit. Enter = 4px shift + .98 scale. `prefers-reduced-motion` zeroes durations (tokens.css). Nothing bounces.

## 6. Accessibility
axe 0 violations in dark and light on every touched screen. Text >= 4.5:1, large/UI >= 3:1. Focus: `:focus-visible` 2px `--accent` outline, never removed without replacement. Hit target >= 24px.

## 7. Components (use the primitive, never restyle)
### Button / IconButton
React `Button` (`variant` primary|secondary|ghost, `size` 24|28|32, `tone="danger"`, `loading`) and `IconButton` (`label` required: accessible name + tooltip) from `@/components/ui`. They render `.btn` + data attributes (CSS in ui-primitives.css). Never a bare `<button>` styled by a parent selector; comment actions (Reply, Edit, Delete, reactions) are ghost 24.
| Variant | Look | When |
|---|---|---|
| `primary` | `--accent` fill, `--accent-fg` text | the one main action of a group (Create issue, Save). Max one per group |
| `secondary` (default) | fg 4% fill, 1px `--line` | other actions (Cancel, Invite) |
| `ghost` | transparent, `--muted-strong` | toolbar / inline actions (Filter, Display) |
| `icon` | ghost, square `width = height` | icon-only, always with `aria-label` + Tooltip |
| `data-tone="danger"` | danger text + 45% border, 14% fill on hover | destructive (Delete workspace), combine with secondary |
Sizes `data-size` 24 (dense toolbars, 12px text, 8px padding) · 28 (default, 12px padding) · 32 (forms, dialogs, auth).
States: hover `--hover` + stronger border (primary: accent 88% + black); active = hover; focus-visible 2px accent, offset 1px; disabled `--dim` + .6 opacity, no hover. Loading = `aria-busy="true"`, disabled, spinner over the hidden label, width unchanged.
Linear ref: buttons are 28px, radius 6, medium weight, quiet borders; only the primary is colored.

### Input, Checkbox, Toggle
`Input` (`.input`), `Checkbox` (`.cb`, 16px; 14px in row-select columns), `Toggle` (`role=switch`). Checkbox and Toggle require a name: `label`, `aria-label` or `aria-labelledby` (enforced by the type).
28px (32 in forms/auth), radius 6, `--panel` fill, 1px `--line`, hover `--line-input`, focus `--accent` border + `--accent-ring`. Placeholder `--dim`. Error: `--danger` border + message below at `--fs-sm`.

### Select / Menu
Never a native `<select>`: `Select` (`.select-btn` trigger + `Menu`/`Combobox`). Menu: `--raised`, `--shadow-pop`, `--r-md`, 4px padding, items 28px, radius 5, active `--hover`, destructive = `data-tone="danger"` (`--danger`, same tone as Button), shortcuts in `Kbd`.

### Chip
`Chip`: 22px, radius 5, `--fs-sm`, `--panel` fill + 1px line, color dot 7px before label. Tones accent / danger.

### List row
44px, 16px side padding, gap 10, hairline `--line-soft`. Order: select (Checkbox 14px, visible on hover/focus/selection, own column; Inbox: before the unread dot), priority, id (52px, muted), status, title (ellipsis), labels/project pushed right, avatar 18px, date 72px right. Hover `--hover`; selected `--sel` + 2px inset accent bar. Actions show on hover/focus only.

### Settings card / row
Content max 640 centered. Row: label (13/500) + description (12, muted) left, control right, hairline between rows, card transparent with `--line-soft`. Danger zone last, danger-toned buttons.

### Empty state
`EmptyState`: 56px glyph tile, title 13/500, hint 12 muted max 320, one primary + one secondary action.

## 8. PR checklist
1. Only tokens / primitives. 2. Capture before/after 1280 (dark), plus light and 768 when layout moves. 3. axe 0 dark + light. 4. tsc, vitest, e2e green. 5. One screen or component per PR.
