import { describe, expect, it } from 'vitest';

import { BodyTooLargeError, readTextWithLimit } from './read-body';

function streamed(parts: string[]): ReadableStream<Uint8Array> {
  const encoder = new TextEncoder();
  let pulled = 0;
  return new ReadableStream({
    pull(controller) {
      const part = parts[pulled++];
      if (part === undefined) controller.close();
      else controller.enqueue(encoder.encode(part));
    },
  });
}

function post(body: BodyInit, headers: Record<string, string> = {}) {
  return new Request('http://localhost/api/x', {
    method: 'POST',
    headers,
    body,
    duplex: 'half',
  } as RequestInit);
}

describe('readTextWithLimit', () => {
  it('returns bodies within the limit, including multi-byte text', async () => {
    expect(await readTextWithLimit(post('{"a":"Hà Nội"}'), 64)).toBe('{"a":"Hà Nội"}');
    expect(await readTextWithLimit(new Request('http://localhost/'), 64)).toBe('');
  });

  it('refuses a declared length above the limit', async () => {
    await expect(
      readTextWithLimit(post('x', { 'content-length': '1000' }), 10),
    ).rejects.toBeInstanceOf(BodyTooLargeError);
  });

  it('stops reading a chunked body as soon as it passes the limit', async () => {
    const parts = Array.from({ length: 1000 }, () => 'x'.repeat(1024));
    const body = streamed(parts);
    await expect(readTextWithLimit(post(body), 4096)).rejects.toBeInstanceOf(BodyTooLargeError);
  });
});
