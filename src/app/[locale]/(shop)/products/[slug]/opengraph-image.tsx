import { getTranslations } from 'next-intl/server';
import { ImageResponse } from 'next/og';
import { connection } from 'next/server';

import type { Locale } from '@/i18n/routing';
import { serverEnv } from '@/lib/env';
import { mediaUrl } from '@/lib/media-url';
import { OG_IMAGE_SIZE, ogTheme } from '@/lib/seo/og-theme';
import { getProduct } from '@/server/catalog-cache';
import { imageDataUrl, loadOgFonts } from '@/server/seo/og-assets';

/**
 * Per-locale Open Graph card for product pages (§5.3, §13.1): brand, name and concentration
 * in the page's language on the brand colours, with the first product photo when there is
 * one. Rendered on request (no database at build time) and cached by the CDN for a day;
 * catalogue data comes from the `'use cache'` layer.
 */

export const size = OG_IMAGE_SIZE;
export const contentType = 'image/png';

const PHOTO = { width: 460, height: 630 };
const { color, font, size: text } = ogTheme;

function absolute(url: string): string {
  return url.startsWith('http') ? url : new URL(url, serverEnv().APP_URL).toString();
}

export default async function Image({
  params,
}: {
  params: Promise<{ locale: string; slug: string }>;
}) {
  await connection();
  const { locale: rawLocale, slug } = await params;
  const locale: Locale = rawLocale === 'en' ? 'en' : 'vi';
  const [product, t, fonts] = await Promise.all([
    getProduct(locale, slug),
    getTranslations({ locale }),
    loadOgFonts(),
  ]);

  const image = product?.images[0];
  const photo = image
    ? await imageDataUrl(absolute(mediaUrl(image.storageKey, image.url)), PHOTO, color.ivory50)
    : null;

  return new ImageResponse(
    <div
      style={{
        width: '100%',
        height: '100%',
        display: 'flex',
        background: color.ivory50,
        color: color.ink950,
        fontFamily: font.sans,
      }}
    >
      <div
        style={{
          flex: 1,
          display: 'flex',
          flexDirection: 'column',
          justifyContent: 'space-between',
          padding: '64px 72px',
          borderLeft: `12px solid ${color.gold500}`,
        }}
      >
        <div style={{ display: 'flex', flexDirection: 'column', gap: 24 }}>
          {product && (
            <div
              style={{
                fontSize: text.eyebrow,
                letterSpacing: ogTheme.letterSpacing.eyebrow,
                textTransform: 'uppercase',
                color: color.gold700,
                fontWeight: 600,
              }}
            >
              {product.brand.name}
            </div>
          )}
          <div
            style={{
              fontFamily: font.display,
              fontSize: text.title,
              fontWeight: 500,
              lineHeight: 1.1,
              display: 'flex',
            }}
          >
            {product ? product.name : t('metadata.siteName')}
          </div>
          {product && (
            <div style={{ fontSize: text.brand, color: color.ink700 }}>
              {t(`catalog.concentration.${product.concentration}`)}
            </div>
          )}
        </div>
        <div
          style={{
            display: 'flex',
            justifyContent: 'space-between',
            alignItems: 'center',
            borderTop: `1px solid ${color.line200}`,
            paddingTop: 24,
            fontSize: text.footer,
            color: color.taupe600,
          }}
        >
          <span style={{ fontFamily: font.display, fontSize: text.price, color: color.ink950 }}>
            {t('metadata.siteName')}
          </span>
          <span>{t('ogImage.tagline')}</span>
        </div>
      </div>
      {photo && (
        // Satori renders plain <img>; next/image does not apply here.
        <img
          src={photo}
          width={PHOTO.width}
          height={PHOTO.height}
          alt=""
          style={{ background: color.sand100 }}
        />
      )}
    </div>,
    {
      ...size,
      fonts,
      headers: { 'Cache-Control': 'public, max-age=86400, stale-while-revalidate=604800' },
    },
  );
}
