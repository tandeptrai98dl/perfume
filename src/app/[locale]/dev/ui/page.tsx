import type { Metadata } from 'next';
import { notFound } from 'next/navigation';

import { UiGallery } from '@/components/dev/ui-gallery';

import { ServerSamples } from './server-samples';

export const metadata: Metadata = { title: 'UI gallery', robots: { index: false, follow: false } };

/**
 * Component gallery for development (§9). 404 in production builds unless ENABLE_DEV_UI=true
 * (used for visual checks of a production build).
 */
export default function DevUiPage() {
  if (process.env.NODE_ENV === 'production' && process.env.ENABLE_DEV_UI !== 'true') notFound();
  return (
    <>
      <UiGallery />
      <ServerSamples />
    </>
  );
}
