/**
 * Centralized design tokens — single source for colors, typography, spacing, radii, borders, shadows, sizing, focus, disabled, status.
 * No magic values scattered in components. CSS variables in styles.css mirror these values.
 * Dark-first, industrial, restrained.
 */

export const colors = {
  bg: '#0f1115',
  bgSoft: '#161a22',
  bgElevated: '#1b202b',
  panel: '#1b202b',
  panel2: '#222838',
  border: '#2a3144',
  borderSoft: '#1e2433',
  text: '#e6e8ee',
  muted: '#9aa3b8',
  muted2: '#7a8499',
  accent: '#5b8def',
  accent2: '#7aa5ff',
  success: '#3dd68c',
  warn: '#f0b429',
  danger: '#ff6b6b',
  focus: '#5b8def',
} as const

export const typography = {
  fontSans: 'ui-sans-system, -apple-system, Segoe UI, Roboto, Helvetica, Arial, sans-serif',
  fontMono: 'ui-monospace, SFMono-Regular, Menlo, Consolas, monospace',
  size: {
    xs: '11px',
    sm: '12px',
    base: '13px',
    body: '14px',
    h1: '18px',
    h2: '14px',
  },
  lineHeight: {
    tight: '1.2',
    base: '1.5',
    relaxed: '1.6',
  },
  weight: {
    regular: 400,
    medium: 500,
    semibold: 600,
    bold: 700,
  },
  tracking: {
    label: '0.08em',
    pill: '0.06em',
  },
} as const

export const spacing = {
  xs: '4px',
  sm: '8px',
  md: '12px',
  lg: '16px',
  xl: '22px',
  '2xl': '32px',
} as const

export const radii = {
  sm: '6px',
  md: '8px',
  lg: '10px',
  xl: '12px',
  pill: '999px',
} as const

export const borders = {
  hairline: `1px solid ${colors.border}`,
  soft: `1px solid ${colors.borderSoft}`,
  accent: `1px solid ${colors.accent}`,
} as const

export const shadows = {
  panel: '0 1px 2px rgba(0,0,0,.25), 0 4px 12px rgba(0,0,0,.2)',
  focus: `0 0 0 2px rgba(91,141,239,.2)`,
} as const

export const sizing = {
  topbarH: '44px',
  sidebarW: '220px',
  sidebarWCollapsed: '56px',
  mainMaxW: '860px',
  touchMin: '32px',
} as const

export const focus = {
  ring: `0 0 0 2px ${colors.bg}, 0 0 0 4px ${colors.focus}`,
} as const

export const state = {
  disabledOpacity: 0.5,
  hoverBg: colors.panel,
  activeBg: colors.panel2,
} as const

export const status = {
  online: colors.success,
  offline: colors.muted,
  warn: colors.warn,
  error: colors.danger,
} as const
