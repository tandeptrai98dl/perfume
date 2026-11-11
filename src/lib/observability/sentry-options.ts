import { scrubEvent, scrubText, scrubUrl, scrubValue, type ScrubbableEvent } from './scrub';

/** Span attributes: URLs lose their query values, other strings are PII-scrubbed. */
export function scrubAttributes(attributes: Record<string, unknown>): Record<string, unknown> {
  const scrubbed = scrubValue(attributes) as Record<string, unknown>;
  for (const [key, value] of Object.entries(attributes)) {
    if (typeof value === 'string' && /url|target|query/i.test(key)) scrubbed[key] = scrubUrl(value);
  }
  return scrubbed;
}

/**
 * Options shared by every Sentry SDK we use (@sentry/nextjs in browser and server,
 * @sentry/node in the worker). PII is never sent: default PII is off and every event,
 * transaction and breadcrumb is scrubbed before it leaves the process.
 */
export function sentryOptions(input: {
  dsn?: string;
  environment?: string;
  tracesSampleRate?: number;
}) {
  return {
    dsn: input.dsn,
    enabled: Boolean(input.dsn),
    environment: input.environment,
    sendDefaultPii: false,
    tracesSampleRate: input.tracesSampleRate ?? 0.1,
    beforeSend<T>(event: T): T {
      return scrubEvent(event as ScrubbableEvent) as T;
    },
    // Spans are streamed (SDK default), so they are scrubbed here rather than as transactions.
    beforeSendSpan<T extends { name: string; attributes: Record<string, unknown> }>(span: T): T {
      span.name = scrubUrl(span.name);
      span.attributes = scrubAttributes(span.attributes);
      return span;
    },
    beforeBreadcrumb<T extends { message?: string; data?: Record<string, unknown> }>(crumb: T): T {
      if (crumb.message) crumb.message = scrubText(crumb.message);
      if (crumb.data) crumb.data = scrubValue(crumb.data) as Record<string, unknown>;
      return crumb;
    },
  };
}
