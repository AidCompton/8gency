# 8gency Design System — Master

> When building a page, check `design-system/8gency/pages/<page>.md` first; its rules override this file.
> Tokens live in `src/app/globals.css`; components live in `src/components/ui.tsx`. This file describes them — if they disagree, fix one of them.

**Product:** B2B operations app for 5–50 person agencies (staff app `/app`, client hub `/hub/[token]`).
**Style:** SaaS · Soft UI Evolution. Dense and data-first, cool zinc neutrals, one violet brand, soft layered shadows, 8–12px radius, light + dark.
**Dials:** Variance 3 (minimal) · Motion 2 (subtle) · Density 8 (dashboard).

## Colour tokens

Use the Tailwind names (`bg-surface`, `text-ink-2`, …). Never raw hex in components.

| Tailwind | CSS var | Light | Dark | Use |
|---|---|---|---|---|
| `bg` | `--bg` | `#f7f7f9` | `#0e0e12` | Page |
| `surface` | `--surface` | `#ffffff` | `#16161b` | Cards, inputs, sidebar |
| `surface-2` | `--surface-2` | `#f2f2f5` | `#1f1f26` | Hover, table head, neutral badge |
| `line` | `--border` | `#e4e4e9` | `#2a2a33` | Dividers, card borders (decorative) |
| `control` | `--control-border` | `#8a8a96` | `#686875` | Form-control borders (≥3:1 vs surface and bg) |
| `ink` | `--text` | `#0f0f14` | `#f2f2f5` | Primary text |
| `ink-2` | `--text-2` | `#4b4b57` | `#c2c2cc` | Secondary text |
| `ink-3` | `--text-3` | `#686875` | `#92929e` | Muted text, meta (≥4.5:1 on every surface) |
| `brand` / `brand-ink` | `--brand` | `#5b3df5` / white | `#8b78ff` / `#0b0b0b` | Primary action, links, selection |
| `seq` / `seq-soft` | `--seq` | `#2a78d6` | `#3987e5` | Data magnitude (bars, meters). Not for text |
| `seq-ink` | `--seq-ink` | `#1f64b8` | `#6da7ec` | Blue *text* (info badge) |
| `good` / `good-ink` | | `#0ca30c` / `#006300` | — / `#5fd35f` | Fill / text |
| `warning` / `warning-ink` | | `#fab219` / `#8a5a00` | — / `#fab219` | Fill / text |
| `critical` / `critical-ink` | | `#d03b3b` / `#a32626` | — / `#f08080` | Fill / text |
| `pin-client` | | `#eb6834` | same | Client proof pins only |
| `shadow-xs/sm/md` | `--elev-*` | soft 2-layer | deeper, darker | Controls / cards / raised (hover, invoice sheet) |
| `focus` | `--focus` | = brand | = brand | Focus outline, field focus ring |

Rules:
- Brand (violet) and data (blue) stay separate so actions never read as chart marks.
- `*-ink` is for text; the plain status colour is for fills and icons only.
- Status is never colour alone: always a word, plus an `aria-hidden` `StatusIcon` (Phosphor CheckCircle / Warning / WarningCircle, in the `*-ink` colour) or a badge dot.
- Avoid brand text on a brand tint over `surface-2` in dark mode (4.25:1); active nav sits on `surface`.
- Tints: badges use `bg-<tone>/10` (`/15` for warning). Verified ≥4.5:1 in both themes.

## Typography

- **Inter** via `next/font` (`--font-inter`), features `cv11, ss01`. Numbers: `.tnum` (tabular).
- Body 15px (`text-[15px]` on body). `text-sm` 14 for tables/forms, `text-xs` 12 for meta only — never for primary content or actions a client must read.
- H1 `text-2xl font-semibold tracking-tight`. Card titles `text-sm font-semibold`. Table heads `text-xs font-medium text-ink-3` on `surface-2/60` (sentence case). Stat labels `text-[13px] font-medium text-ink-2`, sentence case. Uppercase is reserved for the invoice sheet and small section eyebrows.

## Spacing, shape, elevation

- Tailwind 4px scale. Page `px-4 sm:px-6 lg:px-8`, `py-6 lg:py-8`, max width `max-w-7xl` (hub `max-w-4xl`). Card padding `p-4`, section gaps `gap-4`/`gap-5`.
- Radius: `rounded-lg` controls (8px), `rounded-xl` cards (12px), `rounded-full` badges/meters.
- Elevation: cards `border-line` + `shadow-sm`; inputs and secondary buttons `shadow-xs`; clickable tiles go `shadow-md` + `border-brand/40` on hover (no movement); the invoice sheet `shadow-md`. Buttons press down 1px (`active:translate-y-px`).

## Components (`src/components/ui.tsx`)

| Component | Notes |
|---|---|
| `buttonClass(variant, size)` | primary · secondary · ghost · danger; `md` 36px, `sm` 28px (14px text) desktop; **44px on touch** (`pointer-coarse:min-h-11`). |
| `SubmitButton` (`src/components/SubmitButton.tsx`) | Use for **every** form submit. Disables the form while the action runs (`aria-busy`). `confirm="…"` for irreversible actions (approve, decline, void, write off, remove). `formNoValidate` on the button that may skip required fields. |
| `Field` | Always wrap inputs in a visible label. Placeholders are examples, not labels. |
| Form controls | One height scale, set in `globals.css`: fields and selects **36px** (= `md` button); `className="field-sm"` **28px** (= `sm` button) for compact controls in table rows / inline forms; **44px** on touch. Never resize with `!py-*`/`text-xs` hacks. Fixed-width inline fields use `!w-*`. Multi-field rows in a table: one column per field, controls join the row's form via `form="…"`. Buttons never wrap (`whitespace-nowrap`). |
| Layout grids | Content + side column grids use `minmax(0,1fr)`, never bare `1fr`, so wide tables scroll inside their card instead of pushing the side column off-screen. |
| `Card`, `PageHeader`, `Tabs` | Tabs and nav set `aria-current="page"`. `PageHeader back=` uses `BackLink`; card actions that navigate use `TextLink` (arrow). |
| `Avatar`, `ProductMark` | Initials avatar (decorative). `ProductMark` = 8gency logo on public/auth pages; inside the app and hub the agency's own logo (or a monogram in its brand colour) is used. |
| Shell (`app/app/layout.tsx` + `NavLinks`) | 240px sidebar: brand row (64px), grouped nav (Workspace / Money / Admin) with Phosphor icons, active = `bg-brand/10 text-brand` + filled icon; account row with avatar + log out. Top bar 64px: date, timer pill, bell with unread count. |
| `InvoicePaper`, `InvoiceEditor` | One invoice sheet everywhere (staff, editor, hub, print). `.paper` pins the light tokens. Drafts edit in place (`.input-inline` fields), live totals, details panel; issued invoices are read-only. |
| `LogoCard` | Upload/replace/remove the agency logo (PNG/JPEG/WebP/SVG ≤ 512 KB, checked by bytes). Served by `/api/logo` for staff sessions and hub links. |
| Automations (`FlowBuilder`, `AutomationIcon`, `MiniFlow`) | n8n-style canvas on `.canvas-dots`: nodes are 256px cards (icon tile + "When / Only if / Then · step n" eyebrow + title + summary) joined by 1px connectors with round "+" insert buttons; selected node = brand ring. Settings slide over the canvas from the right on desktop, sit below on phones. Node tones: trigger `warning`, filter `info`, actions by channel (notify `brand`, email `info`, WhatsApp `good`, task `neutral`). On/off is a `role="switch"` pill. Catalogue in `src/lib/domain/automations.ts`. |
| Connectors | Header plug icon → `/app/connectors`: catalogue cards (duotone app icon in a bordered tile, phase badge, "what it will do" checklist, dashed "We want this" request button). Roadmap data in `src/lib/domain/connectors.ts`; plan in `docs/integrations-plan.md`. |
| `Flash` | Inline banner with icon. Success auto-clears after 6s; errors stay. |
| `Stat` | One number, one label, optional toned hint. |
| `Meter`, `BarList` | Sequential blue; warning/critical past threshold; meter exposes its % via `role="img"` + `aria-label`. |
| `Badge`, `StatusBadge`, `HealthBadge` | Pill with optional status dot (`dot`); text always present, sentence case. `TONE` / `Tone` (exported) give the same tint+ink pair to icon tiles. |
| Icons | **Phosphor** only (`@phosphor-icons/react/ssr` in server components, `@phosphor-icons/react` in client ones), 14–20px, `aria-hidden` when next to text; icon-only buttons need `aria-label`. No emoji/glyph icons (✓ ▲ ● ← ↗). Arrows inside prose and ⚑ inside native `<option>` text are fine. |
| `Money` | Respects field permissions — renders `•••` when restricted. |
| `Table` | Wrapped in a focusable `relative overflow-x-auto` scroller (keyboard-scrollable; `relative` stops absolutely positioned children widening the page), `min-w-[560px]`; always pass `empty`. |
| `NavLinks` | Sidebar from `md` (768px) up, links scroll if the window is short; phones get a "Menu" button. Account + log out sit below the links. |
| `Proof` | Pins work by mouse or keyboard (focus image, arrows move, Shift = ×5, Enter → comment). Pin colours: `bg-seq` internal, `bg-pin-client` client. |

## Interaction & motion

- Focus: global 2px brand outline on `:focus-visible`; fields swap to a brand border + 3px soft brand ring. Never remove it.
- Transitions: 150–200ms on colour, border, shadow (and 1px press). No layout-animating properties.
- Page entrance: `app/app/template.tsx` → `<PageEnter>`: 6px / 250ms fade-up on in-app navigation only (first load renders as-is), never blocks navigation.
- `prefers-reduced-motion` disables animation globally (`globals.css`).
- **GSAP** (`gsap` + `@gsap/react`) is the motion engine. Use the `<Stagger>` primitive (`src/components/Motion.tsx`) — don't call GSAP ad hoc in pages:
  - Mark items with `data-stagger`; they fade up 8px, 0.3s, 30ms apart, `power1.out`. Only the first 20 animate.
  - Pass `replay` (e.g. the active filter) to re-run on data changes — this is the "smooth filter" feedback.
  - Reduced motion → `gsap.matchMedia` skips it; final state renders at once. Items are hidden until hydration with a 1.5s CSS failsafe.
  - No `back.out`/elastic easing on data UI; no scroll-triggered reveals; never animate layout properties.
- Buttons get `cursor: pointer` globally (Tailwind v4 resets it).
- Touch: inputs 44px tall and 16px text on coarse pointers (no iOS zoom).
- Every form submit uses `SubmitButton` (pending state, no double submit). Route segments show `loading.tsx` skeletons.

## Anti-patterns

- Raw hex in components (use tokens).
- Placeholder-only labels. Compact inline controls in table rows may use `aria-label` instead of a visible label.
- Status by colour alone; `title=` as the only way to read a value.
- Hover lifts/scale, heavy or coloured shadows, decorative gradients inside the app (a soft brand radial is allowed on public/auth pages), scroll-triggered reveals, bouncy easing on data.
- Blue (`seq`) for text or brand actions.

## Pre-delivery checklist

- [ ] Only tokens; new colours added to `globals.css` in light **and both** dark blocks
- [ ] Text ≥4.5:1, control borders/graphics ≥3:1 (both themes)
- [ ] Every input has a visible label
- [ ] Keyboard: all actions reachable, focus visible, `aria-current` on nav
- [ ] Works at 375 / 768 / 1024 / 1440 without horizontal page scroll
- [ ] Touch targets 44px on coarse pointers
