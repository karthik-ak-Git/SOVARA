/**
 * Centralized design tokens — single source for colors, typography, spacing, radii, borders, shadows, sizing, focus, disabled, status.
 * No magic values scattered in components. CSS variables in styles.css mirror these values.
 * Light-first, clean, Bionic-style.
 */

export const colors = {
  bg: '#ffffff',
  bgSoft: '#f7f7f8',
  bgElevated: '#ffffff',
  panel: '#ffffff',
  panel2: '#f3f4f6',
  border: '#e5e7eb',
  borderSoft: '#f0f0f2',
  text: '#1a1a2e',
  muted: '#6b7280',
  muted2: '#9ca3af',
  accent: '#4a90d9',
  accent2: '#3b82f6',
  success: '#22c55e',
  warn: '#f59e0b',
  danger: '#ef4444',
  focus: '#4a90d9',
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
  panel: '0 1px 3px rgba(0,0,0,.08), 0 1px 2px rgba(0,0,0,.06)',
  focus: `0 0 0 2px rgba(74,144,217,.15)`,
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
