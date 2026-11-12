'use client';

import { X } from 'lucide-react';
import Link from 'next/link';
import type { Route } from 'next';
import { useState } from 'react';

import { IconButton } from '@/components/ui/icon-button';

import { ANNOUNCEMENT_COOKIE } from './announcement-cookie';

/** Dismissible announcement strip (client part of `AnnouncementBar`). */
export function AnnouncementBarView({
  id,
  title,
  ctaLabel,
  ctaUrl,
  labels,
}: {
  id: string;
  title: string;
  ctaLabel: string | null;
  ctaUrl: string | null;
  labels: { region: string; dismiss: string };
}) {
  const [open, setOpen] = useState(true);
  if (!open) return null;

  function dismiss() {
    // 30 days; SameSite=Lax, not httpOnly (written by the browser, holds no secret).
    const secure = window.location.protocol === 'https:' ? '; Secure' : '';
    document.cookie = `${ANNOUNCEMENT_COOKIE}=${encodeURIComponent(id)}; Max-Age=2592000; Path=/; SameSite=Lax${secure}`;
    setOpen(false);
  }

  const external = ctaUrl && /^https?:\/\//.test(ctaUrl);
  return (
    <aside aria-label={labels.region} className="bg-ink-950 text-ivory-50">
      <div className="container-content text-small relative flex min-h-11 items-center justify-center gap-3 py-1 pe-12 text-center">
        <p>
          {title}
          {ctaLabel && ctaUrl && (
            <>
              {' '}
              {external ? (
                <a
                  href={ctaUrl}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="underline underline-offset-4"
                >
                  {ctaLabel}
                </a>
              ) : (
                <Link href={ctaUrl as Route} className="underline underline-offset-4">
                  {ctaLabel}
                </Link>
              )}
            </>
          )}
        </p>
        <IconButton
          aria-label={labels.dismiss}
          onClick={dismiss}
          className="text-ivory-50 hover:bg-ink-700 absolute end-1 top-1/2 -translate-y-1/2"
        >
          <X aria-hidden />
        </IconButton>
      </div>
    </aside>
  );
}
