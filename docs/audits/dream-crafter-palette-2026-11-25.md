# Dream Crafter palette: audit and proposal (25 Nov 2026)

Scope: the Dream Crafter look in both skins, light ("vision") and dark ("night"):

- the Beta renovation screens (`engine/frontend/src/pages/renovation-beta/renovationBetaTheme.ts`, `BetaWsUi.tsx`)
- the main app's glass sidebar (`src/theme.ts` `dcGlass`, `src/components/Sidebar.tsx`)
- the night overrides for embedded screens (`engine/frontend/src/conts/embed.css`)

The house design system (`tokens.css`, `tokens.json`, `components.md`, `BUTTONS.md`, the `.dc.html` specs) covers The Conts brand only. No Dream Crafter spec is in the repo; the v10 "Vision" and v13 "Night Glass" designs and `PLAN-dc-sidebar.md` that the code cites are missing. Until they come back, this file is the reference. It keeps the house rules: 4.5:1 for text, 3:1 for UI boundaries and large text (`tokens.css:64-65`).

## How contrast was measured

The ratios below are WCAG ratios, computed rather than read from rendered pixels. For each text colour, the background is the worst case of everything it can sit on: the glass card over the darkest point of the page glow, plus the pick, chip, raised, hover-wash and press-wash tints on top. The glass card works out to about `#E6EAF2` in light and `#24273A` in dark.

## 1. Findings

### Contrast failures

| # | Where | Token | Skin | Worst ratio | Needs |
|---|---|---|---|---|---|
| F1 | Main-app sidebar secondary text | `dcGlass.muted` `#6B6B6B` | light | 3.68:1 | 4.5 |
| F2 | Sidebar, embed tables, Mail on night | `#9AA2B4` (`dcGlass.muted`, `embed.css:52,93`) | dark | 3.99:1 | 4.5 |
| F3 | Beta muted text under a pressed or picked row | `BETA.muted` `#5E5E5E` | light | 4.48:1 | 4.5 |
| F4 | Beta step captions, lead chip | `BETA.faint` `#6B6B6B` | light | 3.68:1 (3.97 on pick) | 4.5 |
| F5 | Calendar legend, to-do dots | `TONES.grey.dot` `#8E8E8E` | light | 2.83:1 | 3 |
| F6 | Secondary glass button edge | `BETA.btnGlassEdge` | dark | 1.63:1 | 3 (see note) |

Note on F6: a button with a text label does not strictly need a 3:1 edge. On night, though, the glass pill is the only thing that marks it as a button, and its edge is fainter than the input border next to it.

### Muddy text hierarchy

Beta has four text greys, and two of them are almost identical in light: muted `#5E5E5E` and faint `#6B6B6B`. The main app has the same two names with the order reversed: muted `#6B6B6B` and faint `#5A5A5A`, so its "faint" is darker than its "muted". On a light glass card, a fourth grey cannot both pass AA and look different from the third.

### Copies that have drifted

| Value | Beta | Main app | embed.css |
|---|---|---|---|
| Muted, light | `#5E5E5E` | `#6B6B6B` | n/a |
| Faint, light | `#6B6B6B` | `#5A5A5A` | n/a |
| Muted, dark | `#ADB4C5` | `#9AA2B4` | `#9AA2B4` (`:52`, `:93`) and `#ADB4C5` (`:112`) |
| Blue, light | `#2F6BFF` | `#3D5AFE` | n/a |
| Focus ring, light | `#2F6BFF` | `#111216` | n/a |

These values are copied between apps, not imported. `embedTheme.test.ts` checks the page, the night table, Mail and the chart of accounts card, but not muted, faint or blue.

### Interaction states

- **No shared states outside the workspace.** The focus ring, hover, press and disabled rules live in the `.bws` stylesheet (`BetaWsUi.tsx:51-52`, `:103-105`). The projects list (`RenovationBetaHome`) and the calendar (`RenovationBetaCalendar`) do not sit inside `.bws`, so their buttons have no keyboard focus ring and no disabled look.
- **Four different disabled looks.** Opacity is `.55` (`BetaWsUi.tsx:52`), `.6` (`BetaDeleteProject.tsx:51`), `.7` (`BetaForms.tsx:130`), or nothing at all when the control sits outside `.bws`.
- **Hover is a brightness filter.** `filter: brightness(1.05)` lightens a light glass pill a little and does almost nothing on night. The sidebar uses a wash instead: `rgba(17,18,22,.05)` light, `rgba(255,255,255,.06)` dark.
- **Hover and press only exist with motion on.** The lift and the press shrink are inside a `prefers-reduced-motion: no-preference` block, so people with reduced motion get no hover or press feedback at all.

### Stray colours

| File:line | Colour | Should be |
|---|---|---|
| `BetaWsUi.tsx:29` | `#A35C06` amber button fill | token `amberFill` |
| `BetaCalParts.tsx:58` | `#A12622` | `TONES.red.ink` |
| `RenovationBetaHome.tsx:60` | `#1F4E8C` part blue | `BANDS` bar 3 (same value) |
| `BetaDrawingsTab.tsx:602` | `#A9B4B2` dashed border | `BETA.dash` |
| `BetaDefectsTab.tsx:38-39`, `BetaDrawingSheets.tsx:121`, `BetaMedia.tsx:77,84,123,340` | `rgba(23,32,31,...)`, the old teal-black from the first mockup | neutral shadow and overlay tokens |
| about 15 places | `#FFFFFF` text on a solid fill | token `onFill` |

### What the first pass (draft PR) got wrong

It darkened the stepper track to 3:1 in both skins. The track is decoration: each step's dot already has a 3:1 edge (`stepNextEdge`: 3.29:1 light, 3.12:1 dark) and a number. The darker track only makes the header heavier, so it goes back to its old values.

## 2. Proposed semantic palette

One set of values for Beta, the main-app sidebar and embed.css. Names in brackets are the current token names; they stay as aliases, so screens keep working.

### Surfaces (back to front)

| Role | Light | Dark | Current token |
|---|---|---|---|
| Page | glow gradient (unchanged) | glow gradient, base `#151823` | `page`, `bg` |
| Card (glass) | white glass, solid `#F7F8FC` | white glass at 8.5%, solid `#1C2030` | `glass`, `glassSolid` |
| Raised (menu, popover, dialog) | `#FFFFFF` | `#232736` | new `raised` (today `surface` `#1C2030` on night, which matches the card) |
| Tint inside a card | `rgba(10,10,10,.05)` | `rgba(255,255,255,.08)` | `chip` |
| Picked row | `rgba(10,10,10,.07)` | `rgba(255,255,255,.10)` | `pick` |

On night, each layer gets one step lighter: page `#151823`, card `#1C2030`, raised `#232736`. That fixes the muddiness where dialogs and popovers on night came out the same colour as the card behind them.

### Text (3 tiers, down from 4)

| Role | Light | Dark | Worst light | Worst dark |
|---|---|---|---|---|
| Primary | `#111216` | `#EEF1F8` | 15+:1 | 12+:1 |
| Secondary | `#4A4A4A` | `#B9C0D0` | 6.12:1 | 5.60:1 |
| Muted (absorbs `faint`) | `#5A5A5A` | `#ADB4C5` | 4.76:1 | 4.92:1 |

`faint` stays as an alias of `muted`, so nothing breaks. The main app's `dcGlass.muted` and `dcGlass.faint`, and the `#9AA2B4` in embed.css, move to the same muted value.

### Borders

| Role | Light | Dark | Ratio |
|---|---|---|---|
| Divider (decoration) | `rgba(10,10,10,.1)` | `rgba(150,175,255,.18)` | no minimum |
| Control edge: input, glass button, checkbox | `rgba(10,10,10,.5)` | `rgba(150,175,255,.6)` | 3.6:1 / 3.36:1 |

The glass button uses the control edge on night (fixes F6). In light it keeps its slate edge `rgba(55,70,125,.65)`, which is already above 3:1.

### Accent and status

| Role | Light | Dark | Note |
|---|---|---|---|
| Main action (blue pill) | gradient `rgba(40,96,240)`, white text | unchanged | white text passes on both |
| Confirm (green pill) | unchanged | unchanged | white text 4.5:1+ |
| Accent text (teal) | `#0F5F58` | `#7BE8D8` | passes on every tint |
| Amber fill (new token `amberFill`) | `#A35C06` | `#A35C06` | white text 5.13:1 |
| On-fill text (new token `onFill`) | `#FFFFFF` | `#FFFFFF` | replaces the literal `#FFFFFF`s |
| Status tones (teal, amber, red, grey, blue) | unchanged except `grey.dot` light `#7A7A7A` | unchanged | ink on soft and strong all pass |

Blue is not offered as a text colour: `#2F6BFF` and `#3D5AFE` both fall under 4.5:1 on the light card.

### States (every control on every Dream Crafter screen)

| State | Rule | Light | Dark |
|---|---|---|---|
| Hover | wash over the control, plus the lift when motion is allowed | `rgba(17,18,22,.05)` | `rgba(255,255,255,.06)` |
| Pressed | stronger wash, plus the scale when motion is allowed | `rgba(0,0,0,.10)` | `rgba(255,255,255,.10)` |
| Selected | flat ink pill (unchanged `PILL_SELECTED`) | `#111216` / white text | `#EEF1F8` / `#151823` text |
| Focus (keyboard) | 3px ring, 2px offset | `#2F6BFF` (3.89:1) | `#9FC0FF` (7.63:1) |
| Disabled | opacity `.45`, `cursor: not-allowed`, no hover or press | same | same |

All muted text keeps 4.5:1 under the hover and press washes (the worst-case column above already includes them). The state rules move from `.bws` into the skin stylesheet, scoped to `html.beta-page`, so the projects list and the calendar get them too. Disabled at `.45` follows the 0.38 to 0.5 band; WCAG does not require contrast for disabled controls.

## 3. Refactor plan (after approval)

1. `renovationBetaTheme.ts`: the values above; new `raised`, `amberFill`, `onFill`, `stateHover`, `statePress`; `faint` as an alias of `muted`; the stepper track back to its old values; the state rules in `BETA_SKIN_CSS`.
2. `BetaWsUi.tsx`: remove the `.bws` state rules that moved; `WS.amberBtn` points to `amberFill`.
3. Beta screens: swap the stray colours in the table above; drop the inline busy opacities (`.6`, `.7`) in favour of `disabled` and the shared rule; dialogs and popovers use `raised`.
4. Main app: `src/theme.ts` `dcGlass` muted and faint get the new values; `embed.css` `#9AA2B4` changes to `#ADB4C5`.
5. A drift test that fails if `dcGlass`, `embed.css` and the Beta tokens disagree on primary, secondary, muted or focus.

## 4. Open decisions

- **Main-app blue.** The sidebar accent is `#3D5AFE` and Beta's is `#2F6BFF`. Proposal: leave both, since neither is used as text and each fill passes with white text. Or match the sidebar to Beta.
- **Sidebar focus ring.** The light sidebar uses an ink ring (`#111216`), Beta uses blue. Proposal: Beta's blue everywhere, so one keyboard focus look runs across the whole workspace.

## 5. How it will be checked

- Engine frontend: `npm run test`, `npm run typecheck`, `npm run lint`. Root: `npm run test` and `npx tsc --noEmit` for the main-app change.
- A contrast script, kept as a test, that recomputes every pair in this file.
- Screens: the rental app shows the deployed engine, so before merge, the Beta screens can only be seen on a staging deploy of this branch. The main-app sidebar change can be seen locally in the rental app, at 375px and 1280px, light and dark.
