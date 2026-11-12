import { NextResponse, type NextRequest } from 'next/server';

import { AuthorizationError, requirePermission } from '@/server/auth/guards';
import { getDb } from '@/server/db/client';
import { DomainError } from '@/server/lib/command-context';
import { errorFields, logger } from '@/server/lib/logger';
import { customerFilterSchema, exportCustomersCsv } from '@/server/modules/customer';
import { vietnamDate } from '@/server/modules/reporting';
import { getClientIp } from '@/server/request-ip';

/**
 * CSV export of the customer list (§11.1 "Export customer data (CSV)": Owner only,
 * `customers.export`) with the list's filters. Read-only download (GET), but bulk personal
 * data egress: Zod first, then the permission; capped, formula-injection safe and audited.
 * Cross-site requests are refused via Fetch Metadata.
 */
export async function GET(request: NextRequest) {
  const site = request.headers.get('sec-fetch-site');
  if (site && site !== 'same-origin' && site !== 'none') {
    return NextResponse.json({ ok: false, error: 'forbidden' }, { status: 403 });
  }
  const parsed = customerFilterSchema.safeParse(Object.fromEntries(request.nextUrl.searchParams));
  if (!parsed.success) {
    return NextResponse.json({ ok: false, error: 'validation' }, { status: 400 });
  }

  let session;
  try {
    session = await requirePermission('customers.export');
  } catch (error) {
    if (error instanceof AuthorizationError) {
      return NextResponse.json({ ok: false, error: 'unauthorized' }, { status: 403 });
    }
    throw error;
  }

  try {
    const { csv } = await exportCustomersCsv(
      {
        db: getDb(),
        actor: { id: session.user.id, role: session.user.role ?? 'customer' },
        ip: await getClientIp(),
      },
      parsed.data,
    );
    return new NextResponse(csv, {
      headers: {
        'content-type': 'text/csv; charset=utf-8',
        'content-disposition': `attachment; filename="customers-${vietnamDate(new Date())}.csv"`,
        'cache-control': 'no-store',
      },
    });
  } catch (error) {
    if (error instanceof DomainError) {
      return NextResponse.json({ ok: false, error: error.code }, { status: 403 });
    }
    logger.error('admin.customer_export_failed', errorFields(error));
    return NextResponse.json({ ok: false, error: 'unexpected' }, { status: 500 });
  }
}
