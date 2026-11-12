import { sql } from 'drizzle-orm';
import { NextResponse } from 'next/server';

import { getDb } from '@/server/db/client';

/**
 * Readiness (database reachable) for Docker/Caddy health checks and deploys; also served as
 * `/api/health/ready`. Liveness without dependencies is `/api/health/live`. No details exposed.
 */
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
