---
type: entity
title: NERV design system (canonical)
created: 2026-07-10
sources:
  - raw: assets/nerv-ui-kit-standalone.html (canonical, user-provided 2026-07-10)
  - /home/andrew/personal/andrewpynch.com/apps/web/src/styles/globals.css (andrewOS origin)
---

# NERV design system (canonical for chronomaxi)

Canonical per user steer 2026-07-10: chronomaxi adopts the Pynch NERV design system.
The authoritative reference is the standalone UI kit archived at
`assets/nerv-ui-kit-standalone.html` (open in a browser; tabs: theme presets, color
palette, typography, components, layout patterns, animation, implementation).
No indigo/violet/zinc. Tokens below were extracted from the kit's live DOM.

## Tokens (verbatim from the kit)

Backgrounds: `--bg-void #000000`, `--bg-base #0a0a0f`, `--bg-surface #111118`,
`--bg-elevated #1a1a24`, `--bg-overlay rgba(10,10,15,0.85)`.
Grid: `--grid-line rgba(255,255,255,0.06)`, `--grid-strong rgba(255,255,255,0.12)`,
`--grid-tick rgba(255,255,255,0.25)`, `--grid-axis rgba(255,255,255,0.4)`.
Text: `--fg1 #e8e8f0`, `--fg2 #8888a0`, `--fg-muted #555566`, `--fg-inverse #0a0a0f`.
Status: danger `#ff1a1a` (dark `#991111`), caution `#ffaa00`, ok `#00cc66`, info `#4488ff`.
Hazard: green `#22bb44`/`#111118`, red `#cc2200`/`#ddaa00`.
Accent triad, theme `nerv` (default): `--primary #ff8800` (muted `#cc6600`, glow
`rgba(255,136,0,0.15)`), `--secondary #00ddaa` (muted `#009977`), `--tertiary #ff3366`
(muted `#cc2255`). Theme presets swap only the triad: magi `#00aaff/#88ff00/#ff00aa`,
seele `#cc44ff/#ff4466/#ffaa00`, terminal `#00ff88/#00e5ff/#ff3366-family`; select via
`data-theme` on `<html>`, persist in localStorage `chronomaxi-theme`.
Fonts: `--font-display` Archivo Black; `--font-body` Space Mono; `--font-data`
Share Tech Mono/Orbitron, always `font-variant-numeric: tabular-nums`; `--font-jp`
Noto Sans JP. Load via next/font variables.
Type scale: 10/12/14/16/20/28/32px, `--text-data 32px`, `--text-mega 48px`.
Tracking: tight -0.01em, body 0.04em, label 0.08em, display 0.12em.
Radius: 0 / 2px / 3px max. Borders: 1/2/3px.
Space scale: 4/8/12/16/24/32/48/64px.
Motion: scanline 8s linear infinite, pulse 2s ease-in-out, blink 1s step-end,
cascade 600ms, stagger 60ms, flicker 100ms, ease `cubic-bezier(0.22,1,0.36,1)`.

## Canonical CSS conventions (kit Implementation tab)

```css
.panel { background: var(--bg-surface); border: 1px solid var(--grid-strong); border-radius: var(--radius-sm); }
.panel-title { font-family: var(--font-display); color: var(--primary); letter-spacing: var(--track-display); text-transform: uppercase; }
.readout { font-family: var(--font-data); color: var(--primary); font-variant-numeric: tabular-nums; }
```

## Component language (kit Components/Layout tabs)

- Buttons: primary = filled `--primary` with `--fg-inverse` text; secondary = outline
  primary; ghost = outline `--grid-strong`; danger = filled `--status-danger`.
  Labels uppercase EN + smaller JP suffix (e.g. `PRIMARY 実行`).
- Status badges: pulsing dot + uppercase EN + JP, 1px border in status color.
- Panels: corner `+` glyph, display-font title with JP sublabel (SYSTEM STATUS /
  システム状態), right-aligned panel id tag (`PANEL-001` style), hazard stripe footer.
- Data tables: header row in `--primary` uppercase `--font-data`, status cells
  colored by state, row separators `--grid-line`.
- Alert banners: 3px left border in status color, label + JP + message.
- Bilingual label rule: Japanese above or beside English, smaller, `--fg2`.
- Grid backgrounds at 40px with `+` tick marks at intersections; axis rulers with
  tick numbering.

## Dashboard adaptation rules (chronomaxi-specific)

- The dashboard scrolls; never copy any `overflow: hidden` on body.
- Charts (recharts): series order `--primary`, `--secondary`, `--tertiary`,
  `--status-caution`, `--status-info`; grid stroke `--grid-line`; axis ticks
  `--fg-muted` in `--font-data`; tooltips on `--bg-elevated`, 1px `--grid-strong`
  border, radius 2px.
- Stat cards are kit panels: PanelHeader EN/JP, value as `.readout` at
  `--text-data`, delta line `--fg-muted`.
- Category colors: Coding `--primary`, Research `--secondary`,
  Communication `--status-info`, Entertainment `--tertiary`, Other `--fg-muted`.
  Agent actors: `--status-caution`.
- Favicon/branding: hourglass-bars mark on `#0a0a0f`, `--primary`/`--secondary`,
  sharp corners.
