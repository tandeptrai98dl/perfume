import { and, eq, or, sql } from 'drizzle-orm';

import {
  accounts,
  addresses,
  consents,
  customerNotes,
  newsletterSubscribers,
  sessions,
  twoFactors,
  users,
  verifications,
  wishlists,
} from '@/server/db/schema';
import type { Tx } from '@/server/lib/command-context';

import { CONSENT_POLICY_VERSION } from './consents';

/*
 * Account deletion = anonymisation (§10.6, §11.2): the customer's personal data owned by the
 * customer and auth modules is removed or overwritten in the caller's transaction. The users
 * row stays (orders and audit rows reference it) but no longer identifies anyone and can never
 * sign in again.
 *
 * Consent log: rows are append-only for decisions (purpose, granted, version, time stay as
 * evidence of the legal basis, Decree 356/2025), but their contact identifiers (e-mail, phone,
 * IP, user agent) are cleared here — the only UPDATE ever made on `consents`. A final
 * withdrawal of the marketing purposes is appended first.
 */

export type PrivacySubject = { userId: string | null; email: string };

export type CustomerErasureResult = {
  userAnonymized: boolean;
  addresses: number;
  consentsRedacted: number;
};

export const ANONYMIZED_NAME = '[anonymized]';

export function anonymizedEmail(userId: string): string {
  return `deleted+${userId}@anonymized.invalid`;
}

export async function eraseCustomerData(
  tx: Tx,
  subject: PrivacySubject,
  context: { locale: 'vi' | 'en' },
): Promise<CustomerErasureResult> {
  const { userId, email } = subject;

  // Last word in the consent log: marketing withdrawn because the data subject left.
  await tx.insert(consents).values(
    (['marketing_email', 'marketing_sms'] as const).map((purpose) => ({
      userId,
      purpose,
      granted: false,
      policyVersion: CONSENT_POLICY_VERSION,
      locale: context.locale,
      source: 'privacy_erasure',
    })),
  );
  const consentWhere = userId
    ? or(eq(consents.userId, userId), eq(consents.email, email))
    : eq(consents.email, email);
  const redacted = await tx
    .update(consents)
    .set({ email: null, phone: null, ip: null, userAgent: null })
    .where(
      and(
        consentWhere,
        sql`(${consents.email} is not null or ${consents.phone} is not null or ${consents.ip} is not null or ${consents.userAgent} is not null)`,
      ),
    )
    .returning({ id: consents.id });

  await tx.delete(newsletterSubscribers).where(eq(newsletterSubscribers.email, email));
  // Staff notes and COD risk reasons are personal data (ADR-0025).
  if (subject.userId)
    await tx.delete(customerNotes).where(eq(customerNotes.userId, subject.userId));
  // Verification / reset tokens addressed to the e-mail (Better Auth keys them by identifier).
  await tx.delete(verifications).where(eq(verifications.identifier, email));

  let removedAddresses = 0;
  if (userId) {
    removedAddresses = (
      await tx.delete(addresses).where(eq(addresses.userId, userId)).returning({ id: addresses.id })
    ).length;
    await tx.delete(wishlists).where(eq(wishlists.userId, userId));
    await tx.delete(sessions).where(eq(sessions.userId, userId));
    await tx.delete(accounts).where(eq(accounts.userId, userId));
    await tx.delete(twoFactors).where(eq(twoFactors.userId, userId));
    await tx.delete(verifications).where(eq(verifications.value, userId));
    await tx
      .update(users)
      .set({
        name: ANONYMIZED_NAME,
        email: anonymizedEmail(userId),
        emailVerified: false,
        image: null,
        phone: null,
        birthday: null,
        gender: null,
        marketingOptIn: false,
        twoFactorEnabled: false,
        banned: true,
        deletedAt: new Date(),
      })
      .where(eq(users.id, userId));
  }

  return {
    userAnonymized: !!userId,
    addresses: removedAddresses,
    consentsRedacted: redacted.length,
  };
}
