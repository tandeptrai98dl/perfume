import type { MetadataRoute } from 'next';

/**
 * Web app manifest. Colours mirror the `--color-ivory-50` / `--color-ink-950` design tokens in
 * globals.css (the manifest cannot read CSS variables).
 */
export default function manifest(): MetadataRoute.Manifest {
  return {
    name: 'Perfume Store',
    short_name: 'Perfume Store',
    start_url: '/',
    display: 'standalone',
    background_color: '#faf7f2',
    theme_color: '#0e0e0e',
    icons: [{ src: '/favicon.ico', sizes: 'any', type: 'image/x-icon' }],
  };
}
