import type { PgBoss } from 'pg-boss';

import type { Database } from '@/server/db/client';
import type { BankAccount, GatewayProvider, PaymentGateways } from '@/server/integrations/payments';

import type { PaymentStatus } from './status';

/** What payment commands need besides a staff actor: DB, outbox producer, gateways, clock. */
export type PaymentDeps = {
  db: Database;
  boss: PgBoss;
  gateways: PaymentGateways;
  now?: () => Date;
};

export type OnlineProvider = GatewayProvider;

export type PaymentAttemptStatus =
  'pending' | 'succeeded' | 'failed' | 'expired' | 'cancelled' | 'refunded';

/** A payment session as shown on the result page (no secrets). */
export type PaymentSessionView = {
  paymentId: string;
  provider: OnlineProvider;
  kind: 'full' | 'deposit' | 'balance' | 'adjustment';
  amount: number;
  status: PaymentAttemptStatus;
  txnRef: string;
  checkoutUrl: string | null;
  qrCode: string | null;
  account: BankAccount | null;
  transferNote: string;
  expiresAt: Date | null;
  simulated: boolean;
};

export type NotificationOutcome =
  | 'processed'
  | 'duplicate'
  | 'invalid_signature'
  | 'unknown_txn'
  | 'amount_mismatch'
  | 'failed_payment'
  | 'already_paid';

export type NotificationResult = {
  outcome: NotificationOutcome;
  orderId: string | null;
  paymentStatus: PaymentStatus | null;
  confirmed: boolean;
  refundId: string | null;
};

export type TimeoutRunResult = { processed: number; skipped: number };
