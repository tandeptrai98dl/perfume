import { sql } from 'drizzle-orm';
import { NextResponse } from 'next/server';

import { getDb } from '@/server/db/client';

/** Liveness + DB readiness for Docker/Caddy health checks. No details are exposed. */
export async function GET() {
  try {
    await getDb().execute(sql`select 1`);
    return NextResponse.json({ status: 'ok' }, { headers: { 'cache-control': 'no-store' } });
  } catch {
    return NextResponse.json(
      { status: 'unavailable' },
      { status: 503, headers: { 'cache-control': 'no-store' } },
    );
  }
}
