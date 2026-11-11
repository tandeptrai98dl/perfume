import type { QueueOptions } from 'pg-boss';
import { z } from 'zod';

/**
 * Every background job: queue name, payload schema and retry policy.
 * Payloads are validated when enqueued and again when handled (the DB is not a trust boundary
 * we want to rely on across deploys).
 */

const retryPolicy = {
  retryLimit: 5,
  retryDelay: 30,
  retryBackoff: true,
  expireInSeconds: 300,
} satisfies QueueOptions;

export const JOBS = {
  'system.test-email': {
    schema: z.object({ to: z.email(), locale: z.enum(['vi', 'en']) }),
    queue: retryPolicy,
  },
  'cache.revalidate': {
    schema: z.object({
      tags: z.array(z.string().min(1).max(256)).min(1).max(100),
      expire: z.enum(['max', 'now']).default('max'),
    }),
    queue: { ...retryPolicy, retryDelay: 5 },
  },
} as const;

export type JobName = keyof typeof JOBS;
export type JobInput<N extends JobName> = z.input<(typeof JOBS)[N]['schema']>;
export type JobPayload<N extends JobName> = z.output<(typeof JOBS)[N]['schema']>;
export const JOB_NAMES = Object.keys(JOBS) as JobName[];

/** Dead-letter queue shared by all jobs: payloads that exhausted their retries. */
export const DEAD_LETTER_QUEUE = 'system.dead-letter';
