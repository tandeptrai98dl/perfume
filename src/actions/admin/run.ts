import 'server-only';

import { refresh, revalidateTag } from 'next/cache';
import type { z } from 'zod';

import { AuthorizationError, requirePermission } from '@/server/auth/guards';
import type { Permission } from '@/server/auth/permissions';
import { getDb } from '@/server/db/client';
import { getClientIp } from '@/server/request-ip';
import { getProducerBoss } from '@/server/jobs/producer';
import {
  DomainError,
  type CommandResult,
  type DomainErrorCode,
  type FieldIssue,
} from '@/server/lib/command-context';
import { errorFields, logger } from '@/server/lib/logger';
import type { CatalogContext, SlugChangeHook } from '@/server/modules/catalog';
import { createRedirect, invalidateRouteTable } from '@/server/modules/content';

/**
 * Shared skeleton of every admin Server Action (CLAUDE.md, ARCHITECTURE.md §12):
 * 1. Zod validation of the raw input; 2. `requirePermission` (2FA-verified staff session);
 * 3. the module command (transaction + audit + outbox job); 4. immediate `revalidateTag` for
 * read-your-own-writes, while the outbox job covers other instances and retries; 5. `refresh()`
 * so the admin page re-renders with the new data in the same response.
 * Failures come back as typed results; nothing user-facing is thrown.
 */

export type ActionErrorCode = DomainErrorCode | 'validation' | 'unauthorized' | 'unexpected';

export type ActionResult<T> =
  { ok: true; data: T } | { ok: false; error: ActionErrorCode; fieldErrors: FieldIssue[] };

/**
 * Changed published slugs keep their rankings: a 301 from the old storefront path to the new
 * one is written in the same transaction (content module collapses chains, refuses loops).
 */
const onSlugChanges: SlugChangeHook = async (tx, changes) => {
  for (const change of changes) {
    await createRedirect(tx, { fromPath: change.fromPath, toPath: change.toPath, statusCode: 301 });
  }
};

const CODE_PATTERN = /^[a-zA-Z]+$/;

export function zodFieldErrors(error: z.ZodError): FieldIssue[] {
  return error.issues.map((issue) => ({
    path: issue.path.map(String).join('.'),
    // Custom messages are translation codes; built-in English messages become `invalid`.
    code: CODE_PATTERN.test(issue.message) ? issue.message : 'invalid',
  }));
}

export async function runAdminAction<S extends z.ZodType, T>(
  schema: S,
  rawInput: unknown,
  permission: Permission,
  command: (ctx: CatalogContext, input: z.output<S>) => Promise<CommandResult<T>>,
  options: { refresh?: boolean } = {},
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
      ip: await getClientIp(),
      onSlugChanges,
    };
    const result = await command(ctx, parsed.data);
    for (const tag of result.tags) revalidateTag(tag, 'max');
    // New, renamed or unpublished catalogue URLs (and slug redirects) reach the proxy now
    // instead of at its next version check.
    invalidateRouteTable();
    // Re-render the current admin page in the same response (no separate client refresh).
    // Deletes skip it: the page they ran on no longer exists, the client navigates away.
    if (options.refresh !== false) refresh();
    return { ok: true, data: result.data };
  } catch (error) {
    if (error instanceof DomainError) {
      return { ok: false, error: error.code, fieldErrors: error.fieldErrors };
    }
    logger.error('admin.action_failed', { permission, ...errorFields(error) });
    return { ok: false, error: 'unexpected', fieldErrors: [] };
  }
}
