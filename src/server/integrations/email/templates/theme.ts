/**
 * Design tokens for e-mail (ARCHITECTURE.md §7). Email clients ignore CSS variables and
 * external stylesheets, so the values of `src/app/globals.css` @theme are mirrored here and
 * applied as inline styles. Change both together; never hard-code colours in templates.
 */
export const emailTheme = {
  color: {
    ink950: '#0e0e0e',
    ink700: '#3a3632',
    taupe600: '#6b645c',
    line200: '#e4dccf',
    sand100: '#f1ebe1',
    ivory50: '#faf7f2',
    gold500: '#b89b5e',
    gold700: '#7a5c30',
    white: '#ffffff',
  },
  font: {
    display: "'Cormorant Garamond', Georgia, 'Times New Roman', serif",
    sans: "'Be Vietnam Pro', -apple-system, 'Segoe UI', Helvetica, Arial, sans-serif",
  },
  /** px sizes from §7.2 (desktop values; e-mails are read at one size). */
  size: { h1: 32, h3: 20, body: 16, small: 14, eyebrow: 12, button: 13 },
  lineHeight: { h1: '40px', body: '26px', small: '22px' },
  radius: 0,
  containerWidth: 600,
} as const;
