import { NextResponse, type NextRequest } from 'next/server';
import { z } from 'zod';

import { getDb } from '@/server/db/client';
import { getPaymentStatusSnapshot } from '@/server/modules/payment';
import { canViewOrder, pickOrderCode } from '@/server/payment-access';

/**
 * Status polled every 3 s by the checkout result page (§10.4 "switches to Paid when the
 * webhook arrives"). Read-only; visible to the same people as the result page. Unknown and
 * foreign orders get the same 404 (no order enumeration).
 */

const querySchema = z.object({
  code: z.string().max(40),
  t: z.string().max(64).nullish(),
});

const NO_STORE = { 'Cache-Control': 'no-store' };

export async function GET(request: NextRequest) {
  const parsed = querySchema.safeParse({
    code: request.nextUrl.searchParams.get('code') ?? '',
    t: request.nextUrl.searchParams.get('t'),
  });
  const code = parsed.success ? pickOrderCode(parsed.data.code) : null;
  if (!parsed.success || !code) {
    return NextResponse.json({ error: 'invalid_query' }, { status: 400, headers: NO_STORE });
  }
  const snapshot = await getPaymentStatusSnapshot(getDb(), code);
  if (
    !snapshot ||
    !(await canViewOrder({ code, userId: snapshot.userId }, parsed.data.t ?? null))
  ) {
    return NextResponse.json({ error: 'not_found' }, { status: 404, headers: NO_STORE });
  }
  const { userId, ...body } = snapshot;
  void userId;
  return NextResponse.json(body, { headers: NO_STORE });
}
