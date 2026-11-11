'use client';

import { useQueryStates } from 'nuqs';
import { useTransition } from 'react';

import { listingParsers } from '@/lib/listing-params';

/**
 * Listing URL state (filters, sort, page) for client controls. Updates are not shallow, so
 * the server re-renders the results; `isPending` drives the "updating" status.
 */
export function useListingParams() {
  const [isPending, startTransition] = useTransition();
  const [params, setParams] = useQueryStates(listingParsers, {
    shallow: false,
    scroll: false,
    history: 'push',
    startTransition,
  });
  return { params, setParams, isPending };
}
