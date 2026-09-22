/**
 * Centralized design tokens — dark obsidian glassmorphic design system.
 * Single source for colors, typography, spacing, radii, borders, shadows, sizing.
 */

export const colors = {
  bg: '#090c15',
  bgCanvas: '#0e1320',
  bgSoft: '#12151e',
  bgElevated: '#1a1d2a',
  bgCard: 'rgba(22, 30, 50, 0.75)',
  bgComposer: 'rgba(18, 25, 42, 0.85)',
  bgPopover: '#1a2238',
  panel: '#141b2d',
  panel2: '#1a2238',
  border: 'rgba(255, 255, 255, 0.08)',
  borderSoft: 'rgba(255, 255, 255, 0.05)',
  borderGlow: 'rgba(56, 189, 248, 0.35)',
  text: '#f8fafc',
  textSecondary: '#cbd5e1',
  muted: '#94a3b8',
  muted2: '#64748b',
  accent: '#38bdf8',
  accent2: '#0ea5e9',
  accentViolet: '#818cf8',
  success: '#10b981',
  warn: '#f59e0b',
  danger: '#f43f5e',
  focus: '#38bdf8',
} as const

export const typography = {
  fontSans: 'ui-sans-system, -apple-system, Inter, Segoe UI, Roboto, sans-serif',
  fontMono: 'ui-monospace, SFMono-Regular, "JetBrains Mono", "Fira Code", Consolas, monospace',
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
  xl: '14px',
  pill: '9999px',
} as const

export const borders = {
  hairline: `1px solid ${colors.border}`,
  soft: `1px solid ${colors.borderSoft}`,
  accent: `1px solid ${colors.accent}`,
} as const

export const shadows = {
  panel: '0 4px 20px -2px rgba(0, 0, 0, 0.5)',
  focus: `0 0 0 2px rgba(56, 189, 248, 0.35)`,
  glowCyan: '0 0 20px -4px rgba(56, 189, 248, 0.25)',
  glowViolet: '0 0 20px -4px rgba(129, 140, 248, 0.20)',
} as const

export const sizing = {
  topbarH: '50px',
  sidebarW: '240px',
  sidebarWCollapsed: '58px',
  auxiliaryW: '480px',
  mainMaxW: '1040px',
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

