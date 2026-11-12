import { NextResponse, type NextRequest } from 'next/server';

import { AuthorizationError, requirePermission } from '@/server/auth/guards';
import { hasPermission } from '@/server/auth/permissions';
import { getDb } from '@/server/db/client';
import { DomainError } from '@/server/lib/command-context';
import { errorFields, logger } from '@/server/lib/logger';
import { auditFilterSchema, exportAuditLogCsv } from '@/server/modules/audit';
import { vietnamDate } from '@/server/modules/reporting';
import { getClientIp } from '@/server/request-ip';

/**
 * CSV export of the audit log (§11.2) with the viewer's filters. Read-only download (GET, so
 * the browser saves it as a file), but bulk data egress: Zod first, then `customers.export`
 * (Owner, §11.1 "Export … (CSV)") on top of `auditLog.view`, and the export is audited.
 * Cross-site requests are refused via Fetch Metadata.
 */
export async function GET(request: NextRequest) {
  const site = request.headers.get('sec-fetch-site');
  if (site && site !== 'same-origin' && site !== 'none') {
    return NextResponse.json({ ok: false, error: 'forbidden' }, { status: 403 });
  }
  const parsed = auditFilterSchema.safeParse(Object.fromEntries(request.nextUrl.searchParams));
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
  const role = session.user.role ?? 'customer';
  if (!hasPermission(role, 'auditLog.view')) {
    return NextResponse.json({ ok: false, error: 'unauthorized' }, { status: 403 });
  }

  const ip = await getClientIp();
  try {
    const { csv } = await exportAuditLogCsv(
      {
        db: getDb(),
        actor: { id: session.user.id, role },
        ip,
      },
      parsed.data,
    );
    return new NextResponse(csv, {
      headers: {
        'content-type': 'text/csv; charset=utf-8',
        'content-disposition': `attachment; filename="audit-log-${vietnamDate(new Date())}.csv"`,
        'cache-control': 'no-store',
      },
    });
  } catch (error) {
    if (error instanceof DomainError) {
      return NextResponse.json({ ok: false, error: error.code }, { status: 403 });
    }
    logger.error('admin.audit_export_failed', errorFields(error));
    return NextResponse.json({ ok: false, error: 'unexpected' }, { status: 500 });
  }
}
