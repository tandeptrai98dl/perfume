'use client';

import { useLocale } from 'next-intl';
import { useCallback, useEffect, useRef, useState } from 'react';

import { publicEnv } from '@/lib/public-env';
import { TURNSTILE_SCRIPT_URL, type TurnstileAction } from '@/lib/turnstile';
import { cn } from '@/lib/utils';

/*
 * Cloudflare Turnstile widget (ARCHITECTURE.md §12). Renders nothing when
 * NEXT_PUBLIC_TURNSTILE_SITE_KEY is unset (development, E2E), and `token` stays null; the
 * server skips verification in that case too. The widget runs in `interaction-only` mode, so
 * most visitors never see it; the token is single-use, so call `reset()` after every submit.
 *
 *   const turnstile = useTurnstile('sign-in');
 *   …send turnstile.token with the request (header `x-turnstile-token` or an action arg)…
 *   <TurnstileWidget {...turnstile.widgetProps} />
 */

type TurnstileApi = {
  render(container: HTMLElement, options: Record<string, unknown>): string;
  reset(widgetId: string): void;
  remove(widgetId: string): void;
};

declare global {
  interface Window {
    turnstile?: TurnstileApi;
  }
}

let scriptPromise: Promise<TurnstileApi> | null = null;

function loadTurnstile(): Promise<TurnstileApi> {
  if (window.turnstile) return Promise.resolve(window.turnstile);
  scriptPromise ??= new Promise<TurnstileApi>((resolve, reject) => {
    const script = document.createElement('script');
    script.src = TURNSTILE_SCRIPT_URL;
    script.async = true;
    script.onload = () =>
      window.turnstile ? resolve(window.turnstile) : reject(new Error('turnstile_missing'));
    script.onerror = () => {
      scriptPromise = null;
      reject(new Error('turnstile_load_failed'));
    };
    document.head.appendChild(script);
  });
  return scriptPromise;
}

export type TurnstileWidgetProps = {
  action: TurnstileAction;
  onToken: (token: string | null) => void;
  /** Changing it re-issues a token (after a submit consumed the previous one). */
  resetKey: number;
  className?: string;
};

export function TurnstileWidget({ action, onToken, resetKey, className }: TurnstileWidgetProps) {
  const siteKey = publicEnv.NEXT_PUBLIC_TURNSTILE_SITE_KEY;
  const locale = useLocale();
  const container = useRef<HTMLDivElement>(null);
  const widgetId = useRef<string | null>(null);
  const onTokenRef = useRef(onToken);

  useEffect(() => {
    onTokenRef.current = onToken;
  }, [onToken]);

  useEffect(() => {
    if (!siteKey || !container.current) return;
    let cancelled = false;
    const element = container.current;
    loadTurnstile()
      .then((api) => {
        if (cancelled) return;
        widgetId.current = api.render(element, {
          sitekey: siteKey,
          action,
          language: locale,
          theme: 'light',
          appearance: 'interaction-only',
          size: 'flexible',
          callback: (token: string) => onTokenRef.current(token),
          'expired-callback': () => onTokenRef.current(null),
          'error-callback': () => onTokenRef.current(null),
        });
      })
      .catch(() => onTokenRef.current(null));
    return () => {
      cancelled = true;
      if (widgetId.current && window.turnstile) window.turnstile.remove(widgetId.current);
      widgetId.current = null;
    };
  }, [siteKey, action, locale]);

  useEffect(() => {
    if (resetKey > 0 && widgetId.current && window.turnstile) {
      window.turnstile.reset(widgetId.current);
    }
  }, [resetKey]);

  if (!siteKey) return null;
  return <div ref={container} className={cn('empty:hidden', className)} />;
}

export type TurnstileState = {
  /** False when no site key is configured: the server does not verify either. */
  enabled: boolean;
  token: string | null;
  /** Forget the used token and ask the widget for a new one. */
  reset: () => void;
  widgetProps: TurnstileWidgetProps;
};

export function useTurnstile(action: TurnstileAction): TurnstileState {
  const [token, setToken] = useState<string | null>(null);
  const [resetKey, setResetKey] = useState(0);
  const reset = useCallback(() => {
    setToken(null);
    setResetKey((key) => key + 1);
  }, []);
  return {
    enabled: Boolean(publicEnv.NEXT_PUBLIC_TURNSTILE_SITE_KEY),
    token,
    reset,
    widgetProps: { action, onToken: setToken, resetKey },
  };
}
