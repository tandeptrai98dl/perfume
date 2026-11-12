import { NextResponse, type NextRequest } from 'next/server';

import { getSuggestions } from '@/server/catalog-cache';
import { suggestionsQuerySchema } from '@/server/modules/catalog';
import { guardRequest } from '@/server/request-guard';

/**
 * Search suggestions for the header dialog (§10.1): 6 products + 3 brands.
 * Public, read-only catalogue data: Zod validation, no permission check (nothing private is
 * returned). Results are cached per (locale, query) by the catalogue cache layer. Limited to
 * `RATE_LIMITS.searchSuggestions` per client IP (§12) so it cannot be used to hammer the DB.
 */
export async function GET(request: NextRequest) {
  const parsed = suggestionsQuerySchema.safeParse({
    locale: request.nextUrl.searchParams.get('locale'),
    q: request.nextUrl.searchParams.get('q') ?? '',
  });
  if (!parsed.success) {
    return NextResponse.json({ error: 'invalid_query' }, { status: 400 });
  }
  const guard = await guardRequest({ scope: 'searchSuggestions' });
  if (!guard.ok) {
    return NextResponse.json(
      { error: 'rate_limited' },
      {
        status: 429,
        headers: { 'Retry-After': String(Math.ceil(guard.retryAfterMs / 1000)) },
      },
    );
  }
  const data = await getSuggestions(parsed.data.locale, parsed.data.q);
  return NextResponse.json(data, {
    headers: { 'Cache-Control': 'public, max-age=60, stale-while-revalidate=300' },
  });
}
