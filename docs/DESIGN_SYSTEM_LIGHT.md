# Sovara Light Design System

**Status:** Current renderer contract  
**Theme:** Light only

## Principles

1. One palette. Light mode is the product, not a selectable state.
2. Semantic tokens first. Components should consume `--bg`, `--panel`, `--text`, `--accent`, and status variables rather than hex literals.
3. Warm editorial surfaces for the chat workspace, cool slate tokens for shell chrome, and one accent family for actions.
4. Density without noise: borders, spacing, and typography provide hierarchy; shadows are restrained.
5. Honest states. Loading, unavailable, error, and destructive states must look different and say what happened.

## Token contract

| Token | Role |
|---|---|
| `--bg`, `--bg-soft`, `--bg-canvas` | Application and page surfaces |
| `--bg-elevated`, `--panel`, `--panel-2` | Cards, popovers, and grouped controls |
| `--text`, `--text-secondary`, `--muted` | Text hierarchy |
| `--accent`, `--accent-bg`, `--on-accent` | Primary action and focus |
| `--success`, `--warn`, `--danger` | Semantic status |
| `--border`, `--border-soft` | Dividers and control outlines |
| `--shadow-panel`, `--shadow-composer` | Elevation without visual noise |
| `--radius-*`, `--space-*` | Shared geometry and rhythm |

`apps/desktop/src/renderer/src/theme/global.css` is the source of truth. Legacy `--stitch-*` names are compatibility aliases and should resolve to semantic tokens.

## Typography

- UI: Manrope, with the system sans-serif stack as fallback.
- Code and identifiers: DM Mono, with a system monospace fallback.
- Editorial display text may use Instrument Serif only where a view intentionally needs a heading accent.

## Component rules

- Use class selectors for repeated visual behavior.
- Inline styles are acceptable for one-off geometry, not for a reusable color contract.
- Every icon-only control has an accessible label and tooltip.
- Focus rings use `--focus-ring` and must remain visible on every surface.
- Status badges use the semantic success, warning, and danger tokens.
- Popovers and settings panels use `--bg-elevated` and `--border`.

## Light-only enforcement

The renderer starts with `data-theme="light"`, `data-theme-preference="light"`, and `color-scheme: light`. There is no theme selector, no system-theme listener, and no dark token block. Persisted legacy theme keys are ignored by the current settings contract.

## Review checklist

- Search the changed component for hard-coded color literals.
- Confirm the component works at 100%, 125%, and 150% display scaling.
- Check empty, loading, error, disabled, and selected states.
- Check keyboard focus and reduced-motion behavior.
- Confirm the component does not introduce a second palette.
