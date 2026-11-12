import { serverEnv, type ServerEnv } from '@/lib/env';
import { ipInRanges, parseIpAllowlist, type IpRange } from '@/server/lib/client-ip';

import type { GatewayProvider } from './types';

/**
 * Gateway IP allowlist for IPN/webhook calls (ARCHITECTURE.md §12 Payments: "gateway IP
 * allowlist where published"). Off by default: a provider without a list accepts every
 * source, and the HMAC signature is verified either way. The source IP is the trusted client
 * IP (`TRUSTED_IP_HEADER`); with an allowlist set and no trusted IP, every call is refused.
 */

export type WebhookAllowlists = Partial<Record<GatewayProvider, IpRange[]>>;

export function createWebhookAllowlists(
  env: Pick<ServerEnv, 'VNPAY_IPN_ALLOWED_IPS' | 'PAYOS_WEBHOOK_ALLOWED_IPS'>,
): WebhookAllowlists {
  const lists: WebhookAllowlists = {};
  const vnpay = parseIpAllowlist(env.VNPAY_IPN_ALLOWED_IPS);
  const payos = parseIpAllowlist(env.PAYOS_WEBHOOK_ALLOWED_IPS);
  if (vnpay.length > 0) lists.vnpay = vnpay;
  if (payos.length > 0) lists.payos = payos;
  return lists;
}

export function isWebhookSourceAllowed(
  lists: WebhookAllowlists,
  provider: GatewayProvider,
  ip: string | null,
): boolean {
  const ranges = lists[provider];
  if (!ranges) return true;
  return ipInRanges(ip, ranges);
}

let cached: WebhookAllowlists | undefined;

export function getWebhookAllowlists(): WebhookAllowlists {
  cached ??= createWebhookAllowlists(serverEnv());
  return cached;
}
