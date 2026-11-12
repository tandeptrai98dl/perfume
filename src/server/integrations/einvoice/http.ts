import { EinvoiceError, type FetchLike } from './types';

/** HTTP helpers shared by the provider adapters (timeouts, error classification). */

export const EINVOICE_TIMEOUT_MS = 20_000;

/** Codes that never carry buyer data: safe for logs, events and staff alerts. */
export function safeCode(value: unknown): string | null {
  if (typeof value !== 'string' && typeof value !== 'number') return null;
  const text = String(value).trim();
  if (!text) return null;
  return text.replace(/[^\w.-]/g, '_').slice(0, 60);
}

export type HttpRequest = {
  url: string;
  method?: 'GET' | 'POST';
  headers?: Record<string, string>;
  /** JSON body (serialised here) or a form body. */
  json?: unknown;
  form?: Record<string, string>;
};

export type HttpResponse = { status: number; body: unknown };

/**
 * Sends a request and parses JSON. Network errors, timeouts, 429 and 5xx are retryable
 * `EinvoiceError`s; other statuses are returned to the adapter (each provider reports
 * business errors differently). Never puts the URL or body in an error (credentials, PII).
 */
export async function sendJson(fetchImpl: FetchLike, request: HttpRequest): Promise<HttpResponse> {
  const headers: Record<string, string> = { accept: 'application/json', ...request.headers };
  let body: string | undefined;
  if (request.json !== undefined) {
    headers['content-type'] = 'application/json';
    body = JSON.stringify(request.json);
  } else if (request.form) {
    headers['content-type'] = 'application/x-www-form-urlencoded;charset=UTF-8';
    body = new URLSearchParams(request.form).toString();
  }
  let response: Response;
  try {
    response = await fetchImpl(request.url, {
      method: request.method ?? 'POST',
      headers,
      body,
      signal: AbortSignal.timeout(EINVOICE_TIMEOUT_MS),
    });
  } catch (error) {
    const timeout = error instanceof Error && error.name === 'TimeoutError';
    throw new EinvoiceError(timeout ? 'timeout' : 'network_error', true);
  }
  if (response.status === 429 || response.status >= 500) {
    throw new EinvoiceError(`http_${response.status}`, true);
  }
  const text = await response.text();
  let parsed: unknown = null;
  if (text) {
    try {
      parsed = JSON.parse(text);
    } catch {
      throw new EinvoiceError('invalid_response', true);
    }
  }
  return { status: response.status, body: parsed };
}

export function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/** Some providers return JSON arrays as strings inside the envelope. */
export function parseMaybeJsonArray(value: unknown): Record<string, unknown>[] {
  let rows = value;
  if (typeof rows === 'string') {
    if (!rows) return [];
    try {
      rows = JSON.parse(rows);
    } catch {
      return [];
    }
  }
  return Array.isArray(rows) ? rows.filter(isRecord) : [];
}

/** `yyyy-MM-dd` in Vietnam time (GMT+7). */
export function vnDate(date: Date): string {
  const vn = new Date(date.getTime() + 7 * 60 * 60 * 1000);
  return vn.toISOString().slice(0, 10);
}

/** `yyyyMMddHHmmss` in Vietnam time (GMT+7). */
export function vnCompact(date: Date): string {
  const vn = new Date(date.getTime() + 7 * 60 * 60 * 1000);
  return vn.toISOString().slice(0, 19).replace(/[-T:]/g, '');
}
