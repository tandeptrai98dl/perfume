import { readFile } from 'node:fs/promises';
import { join } from 'node:path';

import sharp from 'sharp';

import { errorFields, logger } from '@/server/lib/logger';

/**
 * Assets for generated Open Graph images (`next/og`, §13.1): the self-hosted Fontsource files
 * (WOFF; Satori does not read WOFF2) and product photos converted to PNG data URLs.
 * The font files are traced into the standalone build by `outputFileTracingIncludes` in
 * next.config.ts.
 */

type OgFont = { name: string; data: ArrayBuffer; weight: 400 | 500 | 600; style: 'normal' };

/**
 * Latin, Latin Extended and Vietnamese subsets. Satori keeps one font per name + weight, so
 * each subset gets its own name (`Be Vietnam Pro vietnamese`, …); glyphs missing from the
 * requested family are then found in the other registered fonts.
 */
const FONT_FILES: { name: string; pkg: string; weight: OgFont['weight'] }[] = [
  { name: 'Be Vietnam Pro', pkg: 'be-vietnam-pro', weight: 400 },
  { name: 'Be Vietnam Pro', pkg: 'be-vietnam-pro', weight: 600 },
  { name: 'Cormorant Garamond', pkg: 'cormorant-garamond', weight: 500 },
];
const SUBSETS = ['latin', 'latin-ext', 'vietnamese'];

let fonts: Promise<OgFont[]> | undefined;

async function readFont(pkg: string, subset: string, weight: number): Promise<ArrayBuffer> {
  const file = join(
    process.cwd(),
    'node_modules',
    '@fontsource',
    pkg,
    'files',
    `${pkg}-${subset}-${weight}-normal.woff`,
  );
  const buffer = await readFile(file);
  return buffer.buffer.slice(buffer.byteOffset, buffer.byteOffset + buffer.byteLength);
}

export function loadOgFonts(): Promise<OgFont[]> {
  fonts ??= Promise.all(
    FONT_FILES.flatMap(({ name, pkg, weight }) =>
      SUBSETS.map(async (subset) => ({
        name: subset === 'latin' ? name : `${name} ${subset}`,
        weight,
        style: 'normal' as const,
        data: await readFont(pkg, subset, weight),
      })),
    ),
  ).catch((error: unknown) => {
    fonts = undefined;
    throw error;
  });
  return fonts;
}

/**
 * A product photo as a PNG data URL fitted into `width`×`height`, or null when it cannot be
 * fetched in time (the card then renders without it rather than failing).
 */
export async function imageDataUrl(
  url: string,
  size: { width: number; height: number },
  background: string,
): Promise<string | null> {
  try {
    const response = await fetch(url, { signal: AbortSignal.timeout(3_000) });
    if (!response.ok) return null;
    const input = Buffer.from(await response.arrayBuffer());
    const png = await sharp(input)
      .resize({ ...size, fit: 'contain', background })
      .png()
      .toBuffer();
    return `data:image/png;base64,${png.toString('base64')}`;
  } catch (error) {
    logger.warn('og_image.photo_failed', errorFields(error));
    return null;
  }
}
