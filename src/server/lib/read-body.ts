/**
 * Reads a request body as text, refusing it as soon as it exceeds `maxBytes` (§12). Checking
 * `body.length` after `request.text()` is too late: an unauthenticated caller could stream an
 * unbounded (chunked) body into memory first. A declared Content-Length above the limit is
 * refused without reading anything. Web streams only, so it is usable from any runtime.
 */
export class BodyTooLargeError extends Error {
  constructor() {
    super('Request body too large');
    this.name = 'BodyTooLargeError';
  }
}

export async function readTextWithLimit(request: Request, maxBytes: number): Promise<string> {
  const declared = Number(request.headers.get('content-length') ?? Number.NaN);
  if (Number.isFinite(declared) && declared > maxBytes) throw new BodyTooLargeError();
  if (!request.body) return '';

  const reader = request.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    total += value.byteLength;
    if (total > maxBytes) {
      await reader.cancel().catch(() => {});
      throw new BodyTooLargeError();
    }
    chunks.push(value);
  }
  return new TextDecoder().decode(Buffer.concat(chunks));
}
