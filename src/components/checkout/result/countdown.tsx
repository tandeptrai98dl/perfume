'use client';

import { useTranslations } from 'next-intl';
import { useEffect, useState } from 'react';

function remaining(expiresAt: string): number {
  return Math.max(0, Math.floor((new Date(expiresAt).getTime() - Date.now()) / 1000));
}

function format(seconds: number): string {
  const m = Math.floor(seconds / 60);
  const s = seconds % 60;
  return `${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
}

/**
 * Payment session countdown (ADR-0006: 15 minutes). The visible timer updates every second;
 * screen readers get a polite announcement only once per minute and at expiry.
 */
export function Countdown({ expiresAt, onExpire }: { expiresAt: string; onExpire?: () => void }) {
  const t = useTranslations('checkoutResult.countdown');
  const [seconds, setSeconds] = useState<number | null>(null);

  useEffect(() => {
    const tick = () => {
      const left = remaining(expiresAt);
      setSeconds(left);
      if (left === 0) {
        clearInterval(timer);
        onExpire?.();
      }
    };
    const timer = setInterval(tick, 1000);
    tick();
    return () => clearInterval(timer);
  }, [expiresAt, onExpire]);

  if (seconds === null) return <p className="text-small text-taupe-600">&nbsp;</p>;
  if (seconds === 0) {
    return (
      <p className="text-small text-danger" role="status">
        {t('expired')}
      </p>
    );
  }
  const announced = format(Math.ceil(seconds / 60) * 60);
  return (
    <p className="text-small flex items-center gap-2">
      <span aria-hidden className="text-taupe-600">
        {t('label')}
      </span>
      <span aria-hidden className="text-h3 tabular-nums" data-testid="payment-countdown">
        {format(seconds)}
      </span>
      <span className="sr-only" role="timer" aria-live="off">
        {t('expiresIn', { time: announced })}
      </span>
    </p>
  );
}
