/**
 * Pavlicevits Design System - Design Tokens
 * 
 * Exportable design tokens for programmatic access.
 * These match the CSS custom properties in globals.css
 */

export const colors = {
  // Primary (Dark Purple)
  primary: {
    DEFAULT: 'hsl(234, 30%, 14%)',
    light: 'hsl(234, 25%, 22%)',
    dark: 'hsl(234, 35%, 8%)',
    foreground: 'hsl(0, 0%, 100%)',
  },

  // Accent (Dark Green-Blue Petrol #19657a)
  accent: {
    DEFAULT: 'hsl(192, 60%, 25%)',
    light: 'hsl(192, 50%, 35%)',
    dark: 'hsl(192, 70%, 18%)',
    foreground: 'hsl(0, 0%, 100%)',
  },

  // Semantic
  background: 'hsl(0, 0%, 100%)',
  foreground: 'hsl(234, 30%, 14%)',

  card: {
    DEFAULT: 'hsl(0, 0%, 100%)',
    foreground: 'hsl(234, 30%, 14%)',
  },

  secondary: {
    DEFAULT: 'hsl(220, 14%, 96%)',
    foreground: 'hsl(234, 30%, 14%)',
  },

  muted: {
    DEFAULT: 'hsl(220, 14%, 96%)',
    foreground: 'hsl(220, 9%, 46%)',
  },

  border: 'hsl(220, 13%, 91%)',
  input: 'hsl(220, 13%, 91%)',
  ring: 'hsl(234, 30%, 14%)',

  // Status colors
  destructive: {
    DEFAULT: 'hsl(0, 84%, 60%)',
    foreground: 'hsl(0, 0%, 100%)',
  },
  success: {
    DEFAULT: 'hsl(142, 76%, 36%)',
    foreground: 'hsl(0, 0%, 100%)',
  },
  warning: {
    DEFAULT: 'hsl(38, 92%, 50%)',
    foreground: 'hsl(0, 0%, 100%)',
  },
  info: {
    DEFAULT: 'hsl(199, 89%, 48%)',
    foreground: 'hsl(0, 0%, 100%)',
  },
} as const;

export const typography = {
  fontFamily: {
    sans: "'Inter', -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif",
    mono: "'JetBrains Mono', 'Fira Code', Consolas, monospace",
    display: "'Inter', -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif",
  },

  fontSize: {
    xs: '0.75rem',      // 12px
    sm: '0.875rem',     // 14px
    base: '1rem',       // 16px
    lg: '1.125rem',     // 18px
    xl: '1.25rem',      // 20px
    '2xl': '1.5rem',    // 24px
    '3xl': '1.875rem',  // 30px
    '4xl': '2.25rem',   // 36px
    '5xl': '3rem',      // 48px
    '6xl': '3.75rem',   // 60px
  },

  fontWeight: {
    normal: 400,
    medium: 500,
    semibold: 600,
    bold: 700,
    extrabold: 800,
  },

  lineHeight: {
    none: 1,
    tight: 1.25,
    snug: 1.375,
    normal: 1.5,
    relaxed: 1.625,
  },

  letterSpacing: {
    tighter: '-0.05em',
    tight: '-0.025em',
    normal: '0',
    wide: '0.025em',
    wider: '0.05em',
    widest: '0.1em',
  },
} as const;

export const spacing = {
  0: '0',
  1: '0.25rem',     // 4px
  2: '0.5rem',      // 8px
  3: '0.75rem',     // 12px
  4: '1rem',        // 16px
  5: '1.25rem',     // 20px
  6: '1.5rem',      // 24px
  8: '2rem',        // 32px
  10: '2.5rem',     // 40px
  12: '3rem',       // 48px
  16: '4rem',       // 64px
  20: '5rem',       // 80px
  24: '6rem',       // 96px
} as const;

export const borderRadius = {
  none: '0',
  sm: '0.25rem',    // 4px
  md: '0.375rem',   // 6px
  lg: '0.5rem',     // 8px
  xl: '0.75rem',    // 12px
  '2xl': '1rem',    // 16px
  full: '9999px',
} as const;

export const shadows = {
  none: 'none',
  sm: '0 1px 2px 0 rgb(0 0 0 / 0.05)',
  DEFAULT: '0 1px 3px 0 rgb(0 0 0 / 0.1), 0 1px 2px -1px rgb(0 0 0 / 0.1)',
  md: '0 4px 6px -1px rgb(0 0 0 / 0.1), 0 2px 4px -2px rgb(0 0 0 / 0.1)',
  lg: '0 10px 15px -3px rgb(0 0 0 / 0.1), 0 4px 6px -4px rgb(0 0 0 / 0.1)',
  xl: '0 20px 25px -5px rgb(0 0 0 / 0.1), 0 8px 10px -6px rgb(0 0 0 / 0.1)',
  '2xl': '0 25px 50px -12px rgb(0 0 0 / 0.25)',
  inner: 'inset 0 2px 4px 0 rgb(0 0 0 / 0.05)',
  card: '0 1px 3px rgb(0 0 0 / 0.06), 0 1px 2px rgb(0 0 0 / 0.04)',
  cardHover: '0 4px 12px rgb(0 0 0 / 0.08), 0 2px 4px rgb(0 0 0 / 0.04)',
} as const;

export const transitions = {
  duration: {
    fast: '150ms',
    base: '200ms',
    slow: '300ms',
    slower: '500ms',
  },
  timing: {
    default: 'cubic-bezier(0.4, 0, 0.2, 1)',
    in: 'cubic-bezier(0.4, 0, 1, 1)',
    out: 'cubic-bezier(0, 0, 0.2, 1)',
    inOut: 'cubic-bezier(0.4, 0, 0.2, 1)',
    bounce: 'cubic-bezier(0.68, -0.55, 0.265, 1.55)',
  },
} as const;

export const zIndex = {
  dropdown: 50,
  sticky: 100,
  fixed: 200,
  modalBackdrop: 400,
  modal: 500,
  popover: 600,
  tooltip: 700,
  toast: 800,
} as const;

export const breakpoints = {
  sm: '640px',
  md: '768px',
  lg: '1024px',
  xl: '1280px',
  '2xl': '1536px',
} as const;

// Status badge variants
export const statusColors = {
  'in-transit': {
    bg: 'hsl(199, 89%, 48%, 0.12)',
    text: 'hsl(199, 89%, 48%)',
    border: 'hsl(199, 89%, 48%, 0.3)',
  },
  delivered: {
    bg: 'hsl(142, 76%, 36%, 0.12)',
    text: 'hsl(142, 76%, 36%)',
    border: 'hsl(142, 76%, 36%, 0.3)',
  },
  pending: {
    bg: 'hsl(38, 92%, 50%, 0.12)',
    text: 'hsl(38, 92%, 50%)',
    border: 'hsl(38, 92%, 50%, 0.3)',
  },
  new: {
    bg: 'hsl(192, 60%, 25%)',
    text: 'hsl(0, 0%, 100%)',
    border: 'hsl(192, 60%, 25%)',
  },
} as const;

// Export all tokens as a single object
export const designTokens = {
  colors,
  typography,
  spacing,
  borderRadius,
  shadows,
  transitions,
  zIndex,
  breakpoints,
  statusColors,
} as const;

export default designTokens;

// Type exports for TypeScript usage
export type Colors = typeof colors;
export type Typography = typeof typography;
export type Spacing = typeof spacing;
export type BorderRadius = typeof borderRadius;
export type Shadows = typeof shadows;
export type Transitions = typeof transitions;
export type ZIndex = typeof zIndex;
export type Breakpoints = typeof breakpoints;
export type StatusColors = typeof statusColors;
