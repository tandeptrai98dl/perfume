import { NextResponse, type NextRequest } from 'next/server';
import { z } from 'zod';

import { getDb } from '@/server/db/client';
import { listWards } from '@/server/modules/customer';

const querySchema = z.object({ province: z.string().regex(/^\d{1,4}$/) });

/**
 * Wards of a province for the address Combobox (§10.4, province → ward). Public reference
 * data: Zod validation, no permission check; cacheable because units change only by seed.
 * Shared with the checkout address form.
 */
export async function GET(request: NextRequest) {
  const parsed = querySchema.safeParse({ province: request.nextUrl.searchParams.get('province') });
  if (!parsed.success) return NextResponse.json({ error: 'invalid_query' }, { status: 400 });
  const wards = await listWards(getDb(), parsed.data.province);
  return NextResponse.json(
    { wards },
    { headers: { 'Cache-Control': 'public, max-age=86400, stale-while-revalidate=604800' } },
  );
}
