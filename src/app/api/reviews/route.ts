import { NextResponse, type NextRequest } from 'next/server';

import { getProductReviews } from '@/server/review-cache';
import { reviewPageQuerySchema } from '@/server/modules/review';

/**
 * "Show more reviews" on the product page (ADR-0008). Public, read-only: only approved
 * reviews are returned (no contact data, no order references), so Zod validation is the only
 * gate. Cached per (product, locale, page) and refreshed by moderation.
 */
export async function GET(request: NextRequest) {
  const params = request.nextUrl.searchParams;
  const parsed = reviewPageQuerySchema.safeParse({
    productId: params.get('productId'),
    locale: params.get('locale'),
    page: params.get('page'),
  });
  if (!parsed.success) {
    return NextResponse.json({ error: 'invalid_query' }, { status: 400 });
  }
  const { productId, locale, page } = parsed.data;
  const data = await getProductReviews(productId, locale, page);
  return NextResponse.json(data, {
    headers: { 'Cache-Control': 'public, max-age=60, stale-while-revalidate=300' },
  });
}
