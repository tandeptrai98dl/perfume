/**
 * Payment gateway adapters (ARCHITECTURE.md §3.2 layer 5, §12 Payments). Domain code talks to
 * `PaymentGateway` only; VNPay and payOS (VietQR) implement it. Secrets come from env only
 * (ADR-0007) and never leave the adapter.
 */

export type GatewayProvider = 'vnpay' | 'payos';

/** `live` uses real credentials; `simulator` signs with public dev keys and needs no network. */
export type GatewayMode = 'live' | 'simulator';

export type CreateSessionInput = {
  /** Our unique reference (`payments.txn_ref`), numeric so payOS can use it as `orderCode`. */
  txnRef: string;
  /** Whole VND. */
  amount: number;
  orderCode: string;
  /** Transfer note / order info shown by the bank (contains the order code). */
  description: string;
  locale: 'vi' | 'en';
  returnUrl: string;
  cancelUrl: string;
  /** Customer IP (VNPay `vnp_IpAddr`). */
  ipAddress: string;
  createdAt: Date;
  expiresAt: Date;
};

export type BankAccount = { bin: string; accountNumber: string; accountName: string };

export type CreateSessionResult = {
  /** Hosted payment page (VNPay redirect, payOS checkout page). */
  checkoutUrl: string | null;
  /** EMV/VietQR payload to render as a QR code. */
  qrCode: string | null;
  providerTxnId: string | null;
  /** Merchant account the QR pays into (payOS), for display next to the QR. */
  account: BankAccount | null;
  /** Sanitized gateway response (no secrets). */
  raw: Record<string, unknown> | null;
};

/** A notification after signature verification, normalized across gateways. */
export type GatewayNotification = {
  provider: GatewayProvider;
  signatureValid: boolean;
  /** Unique per real event: a replay maps to the same key. */
  idempotencyKey: string;
  eventType: string;
  txnRef: string | null;
  amount: number | null;
  /** The gateway reports the payment as successful. */
  success: boolean;
  providerTxnId: string | null;
  bankCode: string | null;
  paidAt: Date | null;
  /** Stored in `payment_events.payload`: sanitized (no counter-party PII, no secrets). */
  payload: Record<string, unknown>;
};

export type RefundInput = {
  txnRef: string;
  providerTxnId: string | null;
  /** Amount to refund, whole VND. */
  amount: number;
  /** Original payment amount (full vs partial refund). */
  paymentAmount: number;
  /** When the original payment was created on our side (VNPay `vnp_TransactionDate`). */
  transactionDate: Date;
  reason: string;
  actor: string;
  ipAddress: string;
  now: Date;
};

export type RefundResult =
  | { ok: true; providerRef: string | null; raw: Record<string, unknown> }
  | { ok: false; error: string; raw: Record<string, unknown> | null };

export interface PaymentGateway {
  readonly provider: GatewayProvider;
  readonly mode: GatewayMode;
  createSession(input: CreateSessionInput): Promise<CreateSessionResult>;
  /**
   * Verifies and normalizes an inbound IPN/webhook (VNPay: query parameters; payOS: JSON body).
   * Never throws on bad input: returns `signatureValid: false` instead.
   */
  parseNotification(input: unknown): GatewayNotification;
  /** Gateway refund API; absent when refunds are manual (payOS has no refund API). */
  refund?(input: RefundInput): Promise<RefundResult>;
}

export class GatewayError extends Error {
  constructor(
    public readonly provider: GatewayProvider,
    public readonly reason: string,
  ) {
    super(`${provider}: ${reason}`);
    this.name = 'GatewayError';
  }
}

export type FetchLike = (input: string, init?: RequestInit) => Promise<Response>;
