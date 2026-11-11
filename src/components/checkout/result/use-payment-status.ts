'use client';

import { useEffect, useRef, useState } from 'react';

export type LiveStatus = {
  status: string;
  paymentStatus: string;
  amountPaid: number;
  session: { status: string; expiresAt: string | null } | null;
};

/**
 * Polls the order's payment status (every 3 s by default, ARCHITECTURE.md §10.4) while the
 * tab is visible, and calls `onChange` once something changed compared with the first answer
 * the server rendered (`initial`).
 */
export function usePaymentStatus({
  code,
  token,
  initial,
  intervalMs = 3000,
  enabled = true,
  onChange,
}: {
  code: string;
  token: string | null;
  initial: Pick<LiveStatus, 'status' | 'paymentStatus' | 'amountPaid'>;
  intervalMs?: number;
  enabled?: boolean;
  onChange: (status: LiveStatus) => void;
}) {
  const [latest, setLatest] = useState<LiveStatus | null>(null);
  const callback = useRef(onChange);
  useEffect(() => {
    callback.current = onChange;
  }, [onChange]);

  useEffect(() => {
    if (!enabled) return;
    let stopped = false;
    const query = new URLSearchParams({ code, ...(token ? { t: token } : {}) });
    async function poll() {
      if (document.visibilityState === 'hidden') return;
      try {
        const response = await fetch(`/api/checkout/payment-status?${query.toString()}`, {
          cache: 'no-store',
        });
        if (!response.ok || stopped) return;
        const next = (await response.json()) as LiveStatus;
        setLatest(next);
        if (
          next.status !== initial.status ||
          next.paymentStatus !== initial.paymentStatus ||
          next.amountPaid !== initial.amountPaid
        ) {
          stopped = true;
          callback.current(next);
        }
      } catch {
        // Offline for a moment: the next tick tries again.
      }
    }
    const timer = setInterval(() => {
      if (!stopped) void poll();
    }, intervalMs);
    return () => {
      stopped = true;
      clearInterval(timer);
    };
  }, [code, token, intervalMs, enabled, initial.status, initial.paymentStatus, initial.amountPaid]);

  return latest;
}
