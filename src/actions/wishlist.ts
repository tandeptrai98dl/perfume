'use server';

import 'server-only';

import { refresh } from 'next/cache';
import { z } from 'zod';

import { getCustomerSession } from '@/server/auth/customer';
import { getDb } from '@/server/db/client';
import { DomainError } from '@/server/lib/command-context';
import { errorFields, logger } from '@/server/lib/logger';
import { setWishlisted } from '@/server/modules/customer';
import { guardRequest } from '@/server/request-guard';

/**
 * Wishlist heart (§8.3 ProductCard, PDP; §10.6). Members only: guests get `unauthorized` and
 * the button sends them to sign-in with `?next=` back to the product. `refresh()` re-renders
 * the layout's wishlist seed so every heart on the page shows the new state.
 */

/** 60 toggles per minute per account (shared limiter, §12). */
const WISHLIST_RULE = { limit: 60, windowMs: 60 * 1000 };

const toggleSchema = z.object({ productId: z.uuid(), wishlisted: z.boolean() });

export type WishlistErrorCode =
  'validation' | 'unauthorized' | 'notFound' | 'wishlistFull' | 'rateLimited' | 'unexpected';

export type WishlistActionResult =
  { ok: true; wishlisted: boolean } | { ok: false; error: WishlistErrorCode };

export async function setWishlistedAction(raw: unknown): Promise<WishlistActionResult> {
  const parsed = toggleSchema.safeParse(raw);
  if (!parsed.success) return { ok: false, error: 'validation' };
  const session = await getCustomerSession();
  if (!session) return { ok: false, error: 'unauthorized' };
  const guard = await guardRequest({
    scope: 'wishlistToggle',
    rule: WISHLIST_RULE,
    subject: session.user.id,
  });
  if (!guard.ok) return { ok: false, error: 'rateLimited' };
  try {
    const result = await setWishlisted(getDb(), { userId: session.user.id, ...parsed.data });
    refresh();
    return { ok: true, wishlisted: result.wishlisted };
  } catch (error) {
    if (error instanceof DomainError) {
      if (error.fieldErrors[0]?.code === 'wishlistFull')
        return { ok: false, error: 'wishlistFull' };
      if (error.code === 'notFound') return { ok: false, error: 'notFound' };
    }
    logger.error('wishlist.toggle_failed', errorFields(error));
    return { ok: false, error: 'unexpected' };
  }
}
