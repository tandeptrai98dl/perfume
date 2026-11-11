import type { Locale } from '@/i18n/routing';
import { consents } from '@/server/db/schema';
import type { Tx } from '@/server/lib/command-context';

/*
 * Append-only consent log (Personal Data Protection Law, Decree 356/2025; §10.4). Rows are
 * never updated: a withdrawal is a new row with `granted = false` (privacy centre, account
 * stream).
 */

/**
 * Version of the Terms / Privacy Policy the buyer accepted. Bump it when the published
 * policies change materially, so consents can be traced to the text that was shown.
 */
export const CONSENT_POLICY_VERSION = '2026-11-01';

export type ConsentPurpose =
  'terms' | 'privacy' | 'marketing_email' | 'marketing_sms' | 'analytics' | 'ads';

export type ConsentRecord = {
  purpose: ConsentPurpose;
  granted: boolean;
};

export async function recordConsents(
  tx: Pick<Tx, 'insert'>,
  input: {
    records: readonly ConsentRecord[];
    userId: string | null;
    email: string | null;
    phone: string | null;
    locale: Locale;
    /** Where the consent was given, e.g. `checkout`, `newsletter`, `privacy_center`. */
    source: string;
    ip: string | null;
    userAgent: string | null;
    policyVersion?: string;
  },
): Promise<void> {
  if (input.records.length === 0) return;
  await tx.insert(consents).values(
    input.records.map((record) => ({
      userId: input.userId,
      email: input.email,
      phone: input.phone,
      purpose: record.purpose,
      granted: record.granted,
      policyVersion: input.policyVersion ?? CONSENT_POLICY_VERSION,
      locale: input.locale,
      source: input.source,
      ip: input.ip,
      userAgent: input.userAgent,
    })),
  );
}
