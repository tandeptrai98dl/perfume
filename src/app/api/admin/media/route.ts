import { NextResponse } from 'next/server';
import { z } from 'zod';

import { serverEnv } from '@/lib/env';
import { AuthorizationError, requirePermission } from '@/server/auth/guards';
import { getDb } from '@/server/db/client';
import { getStorage } from '@/server/integrations/storage';
import { DomainError } from '@/server/lib/command-context';
import { errorFields, logger } from '@/server/lib/logger';
import { uploadMedia } from '@/server/modules/catalog';

/**
 * Admin image upload (ARCHITECTURE.md §12). A Route Handler rather than a Server Action so
 * 10 MB files are not limited by the Server Action body size and can stream progress.
 * Mutating Route Handlers check Origin (CSRF); validation and permission come first.
 */

const MAX_REQUEST_BYTES = 10 * 1024 * 1024 + 64 * 1024;

const uploadSchema = z.object({
  file: z.instanceof(File, { error: 'required' }),
  altVi: z.string().trim().max(200).nullish(),
});

function sameOrigin(request: Request): boolean {
  const origin = request.headers.get('origin');
  if (!origin) return false;
  const allowed = new Set([new URL(serverEnv().APP_URL).origin, new URL(request.url).origin]);
  return allowed.has(origin);
}

function fail(status: number, error: string, fieldErrors: unknown[] = []) {
  return NextResponse.json({ ok: false, error, fieldErrors }, { status });
}

export async function POST(request: Request) {
  if (!sameOrigin(request)) return fail(403, 'forbidden');
  const length = Number(request.headers.get('content-length') ?? 0);
  if (length > MAX_REQUEST_BYTES) {
    return fail(413, 'invalid', [{ path: 'file', code: 'fileTooLarge' }]);
  }

  let form: FormData;
  try {
    form = await request.formData();
  } catch {
    return fail(400, 'validation', [{ path: 'file', code: 'required' }]);
  }
  const parsed = uploadSchema.safeParse({
    file: form.get('file'),
    altVi: form.get('altVi'),
  });
  if (!parsed.success) return fail(400, 'validation', [{ path: 'file', code: 'required' }]);

  let session;
  try {
    // Catalogue and content editors both upload; uploadMedia checks either permission.
    session = await requirePermission('admin.access');
  } catch (error) {
    if (error instanceof AuthorizationError) return fail(401, 'unauthorized');
    throw error;
  }

  try {
    const { file, altVi } = parsed.data;
    const uploaded = await uploadMedia(
      {
        db: getDb(),
        storage: getStorage(),
        actor: { id: session.user.id, role: session.user.role ?? 'customer' },
      },
      { buffer: Buffer.from(await file.arrayBuffer()), fileName: file.name, altVi },
    );
    return NextResponse.json({ ok: true, data: uploaded }, { status: 201 });
  } catch (error) {
    if (error instanceof DomainError) {
      const status =
        error.code === 'forbidden' ? 403 : error.code === 'storageNotConfigured' ? 503 : 422;
      return fail(status, error.code, error.fieldErrors);
    }
    logger.error('media.upload_failed', errorFields(error));
    return fail(500, 'unexpected');
  }
}
