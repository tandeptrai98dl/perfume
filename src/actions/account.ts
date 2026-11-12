'use server';

import 'server-only';

import { refresh } from 'next/cache';
import { headers } from 'next/headers';
import { z } from 'zod';

import { getCustomerSession } from '@/server/auth/customer';
import { getDb } from '@/server/db/client';
import { getClientIp } from '@/server/request-ip';
import { getProducer } from '@/server/jobs/producer';
import { DomainError, type FieldIssue } from '@/server/lib/command-context';
import { errorFields, logger } from '@/server/lib/logger';
import {
  addressSchema,
  createAddress,
  deleteAddress,
  profileSchema,
  setDefaultAddress,
  updateAddress,
  updateProfile,
} from '@/server/modules/customer';
import { cancelCustomerOrder } from '@/server/modules/order';

/**
 * Account Server Actions (§10.6). Each one: Zod validation → customer session (the user can
 * only touch their own rows: every command is scoped by `session.user.id`) → module command →
 * `refresh()` so the account page re-renders in the same response. Failures come back as
 * typed results with translation codes (`account.errors.*`), never thrown to the client.
 */

export type AccountErrorCode =
  'validation' | 'unauthorized' | 'notFound' | 'invalid' | 'conflict' | 'unexpected';

export type AccountActionResult<T = null> =
  { ok: true; data: T } | { ok: false; error: AccountErrorCode; fieldErrors: FieldIssue[] };

const CODE_PATTERN = /^[a-zA-Z]+$/;

function fieldErrors(error: z.ZodError): FieldIssue[] {
  return error.issues.map((issue) => ({
    path: issue.path.map(String).join('.'),
    code: CODE_PATTERN.test(issue.message) ? issue.message : 'invalid',
  }));
}

async function requestContext() {
  const [list, ip] = await Promise.all([headers(), getClientIp()]);
  return { ip, userAgent: list.get('user-agent') };
}

async function runCustomerAction<S extends z.ZodType, T>(
  schema: S,
  raw: unknown,
  command: (userId: string, input: z.output<S>) => Promise<T>,
): Promise<AccountActionResult<T>> {
  const parsed = schema.safeParse(raw);
  if (!parsed.success) {
    return { ok: false, error: 'validation', fieldErrors: fieldErrors(parsed.error) };
  }
  const session = await getCustomerSession();
  if (!session) return { ok: false, error: 'unauthorized', fieldErrors: [] };
  try {
    const data = await command(session.user.id, parsed.data);
    refresh();
    return { ok: true, data };
  } catch (error) {
    if (error instanceof DomainError) {
      const code: AccountErrorCode =
        error.code === 'notFound' || error.code === 'conflict' || error.code === 'invalid'
          ? error.code
          : 'unexpected';
      return { ok: false, error: code, fieldErrors: error.fieldErrors };
    }
    logger.error('account.action_failed', errorFields(error));
    return { ok: false, error: 'unexpected', fieldErrors: [] };
  }
}

const idSchema = z.uuid();

const saveAddressInput = z.object({ id: idSchema.optional(), values: addressSchema });

export async function saveAddressAction(raw: unknown) {
  return runCustomerAction(saveAddressInput, raw, (userId, { id, values }) =>
    id
      ? updateAddress(getDb(), { userId, addressId: id, values })
      : createAddress(getDb(), { userId, values }),
  );
}

export async function deleteAddressAction(raw: unknown) {
  return runCustomerAction(z.object({ id: idSchema }), raw, (userId, { id }) =>
    deleteAddress(getDb(), { userId, addressId: id }),
  );
}

export async function setDefaultAddressAction(raw: unknown) {
  return runCustomerAction(z.object({ id: idSchema }), raw, (userId, { id }) =>
    setDefaultAddress(getDb(), { userId, addressId: id }),
  );
}

export async function updateProfileAction(raw: unknown) {
  return runCustomerAction(profileSchema, raw, async (userId, values) => {
    await updateProfile(getDb(), { userId, values, context: await requestContext() });
    return null;
  });
}

export async function cancelOrderAction(raw: unknown) {
  return runCustomerAction(
    z.object({ code: z.string().trim().min(1).max(32) }),
    raw,
    async (userId, { code }) => {
      const result = await cancelCustomerOrder(getDb(), await getProducer(), { userId, code });
      return { status: result.to };
    },
  );
}
