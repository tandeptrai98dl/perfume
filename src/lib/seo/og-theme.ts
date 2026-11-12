/**
 * Design tokens for generated Open Graph images (ARCHITECTURE.md §7). `next/og` (Satori)
 * renders inline styles without CSS variables, so the values of `src/app/globals.css` @theme
 * are mirrored here, like the e-mail theme. Change both together.
 */
export const ogTheme = {
  color: {
    ink950: '#0e0e0e',
    ink700: '#3a3632',
    taupe600: '#6b645c',
    line200: '#e4dccf',
    sand100: '#f1ebe1',
    ivory50: '#faf7f2',
    gold500: '#b89b5e',
    gold700: '#7a5c30',
  },
  /** Font families registered from the Fontsource files (§7.2). */
  font: {
    display:
      "'Cormorant Garamond', 'Cormorant Garamond vietnamese', 'Cormorant Garamond latin-ext'",
    sans: "'Be Vietnam Pro', 'Be Vietnam Pro vietnamese', 'Be Vietnam Pro latin-ext'",
  },
  /** px sizes for a 1200×630 card (display scale of §7.2). */
  size: { title: 64, brand: 28, eyebrow: 20, price: 30, footer: 22 },
  letterSpacing: { eyebrow: '0.16em' },
  radius: 0,
} as const;

export const OG_IMAGE_SIZE = { width: 1200, height: 630 } as const;
