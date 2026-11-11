import type { PgBoss } from 'pg-boss';

import type { Permission } from '@/server/auth/permissions';
import { hasPermission } from '@/server/auth/permissions';
import type { Database } from '@/server/db/client';
import { enqueue } from '@/server/jobs/queue';

/**
 * Everything a write command needs, injected by the caller (Server Action, worker or test):
 * no globals, no Next.js APIs (ADR-0023).
 */
export type Actor = { id: string; role: string };

export type CommandContext = {
  db: Database;
  boss: PgBoss;
  actor: Actor;
  /** Client IP for the audit log, when known. */
  ip?: string | null;
};

export type Tx = Parameters<Parameters<Database['transaction']>[0]>[0];

/** Result of a write: the data plus the cache tags the caller should revalidate right away. */
export type CommandResult<T> = { data: T; tags: string[] };

export type DomainErrorCode =
  | 'notFound'
  | 'conflict'
  | 'slugTaken'
  | 'skuTaken'
  | 'forbidden'
  | 'forbiddenField'
  | 'invalid'
  | 'inUse'
  | 'insufficientStock'
  | 'storageNotConfigured';

export type FieldIssue = { path: string; code: string };

/** Expected business failure; Server Actions map it to a typed result instead of a 500. */
export class DomainError extends Error {
  constructor(
    public readonly code: DomainErrorCode,
    public readonly fieldErrors: FieldIssue[] = [],
    message?: string,
  ) {
    super(message ?? code);
    this.name = 'DomainError';
  }
}

export function can(actor: Actor, permission: Permission): boolean {
  return hasPermission(actor.role, permission);
}

/** Defence in depth: commands re-check the permission the action already checked. */
export function assertCan(actor: Actor, permission: Permission): void {
  if (!can(actor, permission)) throw new DomainError('forbidden');
}

const MAX_TAGS_PER_JOB = 100;

/** Transactional outbox: the worker revalidates `tags` iff the transaction commits. */
export async function enqueueRevalidation(
  boss: PgBoss,
  tx: Tx,
  tags: readonly string[],
): Promise<string[]> {
  const unique = [...new Set(tags)];
  for (let i = 0; i < unique.length; i += MAX_TAGS_PER_JOB) {
    await enqueue(boss, tx, 'cache.revalidate', {
      tags: unique.slice(i, i + MAX_TAGS_PER_JOB),
      expire: 'max',
    });
  }
  return unique;
}

/** Maps a Postgres unique violation on `constraint` to a DomainError. */
export function isUniqueViolation(error: unknown, constraint?: string): boolean {
  const cause = (error as { cause?: unknown })?.cause ?? error;
  const pg = cause as { code?: string; constraint?: string };
  return pg?.code === '23505' && (!constraint || pg.constraint === constraint);
}
