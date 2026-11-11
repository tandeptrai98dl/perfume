import { eq } from 'drizzle-orm';

import type { Database } from '@/server/db/client';
import { consents, users } from '@/server/db/schema';
import { DomainError } from '@/server/lib/command-context';
import type { ProfileValues } from '@/lib/validation/account';

import { CONSENT_POLICY_VERSION } from './consents';

/**
 * Customer profile (§10.6): name, phone, birthday, preferred language (`users.locale`, used for
 * account emails) and the marketing e-mail opt-in. Consent changes are appended to `consents`
 * (never updated, Personal Data Protection Law) in the same transaction as the profile change.
 */

export type CustomerProfile = {
  id: string;
  name: string;
  email: string;
  emailVerified: boolean;
  phone: string | null;
  birthday: string | null;
  locale: 'vi' | 'en';
  marketingOptIn: boolean;
};

export async function getProfile(
  db: Pick<Database, 'select'>,
  userId: string,
): Promise<CustomerProfile | null> {
  const [row] = await db
    .select({
      id: users.id,
      name: users.name,
      email: users.email,
      emailVerified: users.emailVerified,
      phone: users.phone,
      birthday: users.birthday,
      locale: users.locale,
      marketingOptIn: users.marketingOptIn,
    })
    .from(users)
    .where(eq(users.id, userId))
    .limit(1);
  return row ?? null;
}

export type ConsentContext = { ip?: string | null; userAgent?: string | null };

export async function updateProfile(
  db: Database,
  input: { userId: string; values: ProfileValues; context?: ConsentContext },
): Promise<{ marketingChanged: boolean }> {
  return db.transaction(async (tx) => {
    const [current] = await tx
      .select({ email: users.email, marketingOptIn: users.marketingOptIn })
      .from(users)
      .where(eq(users.id, input.userId))
      .for('update');
    if (!current) throw new DomainError('notFound');
    const { values } = input;
    await tx
      .update(users)
      .set({
        name: values.name,
        phone: values.phone,
        birthday: values.birthday,
        locale: values.locale,
        marketingOptIn: values.marketingOptIn,
      })
      .where(eq(users.id, input.userId));

    const marketingChanged = current.marketingOptIn !== values.marketingOptIn;
    if (marketingChanged) {
      await tx.insert(consents).values({
        userId: input.userId,
        email: current.email,
        purpose: 'marketing_email',
        granted: values.marketingOptIn,
        policyVersion: CONSENT_POLICY_VERSION,
        locale: values.locale,
        source: 'account_profile',
        ip: input.context?.ip ?? null,
        userAgent: input.context?.userAgent?.slice(0, 512) ?? null,
      });
    }
    return { marketingChanged };
  });
}

/** Locale for account emails (verification, password reset); Vietnamese when unknown. */
export async function getUserLocale(
  db: Pick<Database, 'select'>,
  userId: string,
): Promise<'vi' | 'en'> {
  const [row] = await db
    .select({ locale: users.locale })
    .from(users)
    .where(eq(users.id, userId))
    .limit(1);
  return row?.locale ?? 'vi';
}
