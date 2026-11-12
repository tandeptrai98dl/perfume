import { connection, NextResponse } from 'next/server';

/**
 * Liveness: the Node.js process answers (no dependencies), for restarts by the orchestrator.
 * Readiness (database reachable) is `/api/health` (alias `/api/health/ready`).
 */
export async function GET() {
  // Rendered per request: a prerendered response would not prove the process is alive.
  await connection();
  return NextResponse.json({ status: 'ok' }, { headers: { 'cache-control': 'no-store' } });
}
