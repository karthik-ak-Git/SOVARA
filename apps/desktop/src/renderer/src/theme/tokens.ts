/**
 * Centralized design tokens — crisp light/neutral slate design system matching reference image.
 */

export const colors = {
  bg: '#ffffff',
  bgCanvas: '#ffffff',
  bgSoft: '#f8fafc',
  bgElevated: '#ffffff',
  bgCard: '#ffffff',
  bgComposer: '#ffffff',
  bgPopover: '#ffffff',
  panel: '#f1f5f9',
  panel2: '#e2e8f0',
  border: '#e2e8f0',
  borderSoft: '#f1f5f9',
  borderGlow: 'rgba(2, 132, 199, 0.25)',
  text: '#0f172a',
  textSecondary: '#334155',
  muted: '#64748b',
  muted2: '#94a3b8',
  accent: '#0284c7',
  accent2: '#0066ff',
  accentViolet: '#6366f1',
  success: '#10b981',
  warn: '#f59e0b',
  danger: '#ef4444',
  focus: '#0284c7',
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
  panel: '0 1px 3px rgba(0, 0, 0, 0.08), 0 1px 2px rgba(0, 0, 0, 0.04)',
  focus: `0 0 0 2px rgba(2, 132, 199, 0.25)`,
  composer: '0 2px 12px rgba(0, 0, 0, 0.08)',
} as const

export const sizing = {
  topbarH: '48px',
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


