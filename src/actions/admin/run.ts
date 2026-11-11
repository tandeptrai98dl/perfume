import 'server-only';

import { isIP } from 'node:net';

import { revalidateTag } from 'next/cache';
import { headers } from 'next/headers';
import type { z } from 'zod';

import { AuthorizationError, requirePermission } from '@/server/auth/guards';
import type { Permission } from '@/server/auth/permissions';
import { getDb } from '@/server/db/client';
import { getProducerBoss } from '@/server/jobs/producer';
import {
  DomainError,
  type CommandResult,
  type DomainErrorCode,
  type FieldIssue,
} from '@/server/lib/command-context';
import { errorFields, logger } from '@/server/lib/logger';
import type { CatalogContext, SlugChangeHook } from '@/server/modules/catalog';

/**
 * Shared skeleton of every admin Server Action (CLAUDE.md, ARCHITECTURE.md §12):
 * 1. Zod validation of the raw input; 2. `requirePermission` (2FA-verified staff session);
 * 3. the module command (transaction + audit + outbox job); 4. immediate `revalidateTag` for
 * read-your-own-writes, while the outbox job covers other instances and retries.
 * Failures come back as typed results; nothing user-facing is thrown.
 */

export type ActionErrorCode = DomainErrorCode | 'validation' | 'unauthorized' | 'unexpected';

export type ActionResult<T> =
  { ok: true; data: T } | { ok: false; error: ActionErrorCode; fieldErrors: FieldIssue[] };

/**
 * Integration point for stream C: write `redirects` rows for changed slugs inside the
 * catalogue transaction, e.g. `(tx, changes) => content.createSlugRedirects(tx, changes)`.
 */
const onSlugChanges: SlugChangeHook | undefined = undefined;

const CODE_PATTERN = /^[a-zA-Z]+$/;

export function zodFieldErrors(error: z.ZodError): FieldIssue[] {
  return error.issues.map((issue) => ({
    path: issue.path.map(String).join('.'),
    // Custom messages are translation codes; built-in English messages become `invalid`.
    code: CODE_PATTERN.test(issue.message) ? issue.message : 'invalid',
  }));
}

async function clientIp(): Promise<string | null> {
  const list = await headers();
  const forwarded = list.get('x-forwarded-for')?.split(',')[0]?.trim() ?? list.get('x-real-ip');
  return forwarded && isIP(forwarded) ? forwarded : null;
}

export async function runAdminAction<S extends z.ZodType, T>(
  schema: S,
  rawInput: unknown,
  permission: Permission,
  command: (ctx: CatalogContext, input: z.output<S>) => Promise<CommandResult<T>>,
): Promise<ActionResult<T>> {
  const parsed = schema.safeParse(rawInput);
  if (!parsed.success) {
    return { ok: false, error: 'validation', fieldErrors: zodFieldErrors(parsed.error) };
  }

  let session;
  try {
    session = await requirePermission(permission);
  } catch (error) {
    if (error instanceof AuthorizationError) {
      return { ok: false, error: 'unauthorized', fieldErrors: [] };
    }
    throw error;
  }

  try {
    const ctx: CatalogContext = {
      db: getDb(),
      boss: await getProducerBoss(),
      actor: { id: session.user.id, role: session.user.role ?? 'customer' },
      ip: await clientIp(),
      onSlugChanges,
    };
    const result = await command(ctx, parsed.data);
    for (const tag of result.tags) revalidateTag(tag, 'max');
    return { ok: true, data: result.data };
  } catch (error) {
    if (error instanceof DomainError) {
      return { ok: false, error: error.code, fieldErrors: error.fieldErrors };
    }
    logger.error('admin.action_failed', { permission, ...errorFields(error) });
    return { ok: false, error: 'unexpected', fieldErrors: [] };
  }
}
