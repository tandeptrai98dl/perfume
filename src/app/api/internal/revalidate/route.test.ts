import { beforeEach, describe, expect, it, vi } from 'vitest';

import { signedHeaders } from '@/server/lib/hmac';

/*
 * Worker → web revalidation (§14.1): HMAC-authenticated, body bounded while it is read (an
 * unauthenticated caller cannot stream an unbounded body into memory first).
 */

const { revalidateTag } = vi.hoisted(() => ({ revalidateTag: vi.fn() }));
const SECRET = 'internal-api-secret-internal-api-secret';

vi.mock('next/cache', () => ({ revalidateTag }));
vi.mock('@/server/modules/content', () => ({ invalidateRouteTable: vi.fn() }));
vi.mock('@/lib/env', () => ({ serverEnv: () => ({ INTERNAL_API_SECRET: SECRET }) }));

import { POST } from './route';

beforeEach(() => revalidateTag.mockClear());

describe('POST /api/internal/revalidate', () => {
  it('revalidates the tags of a signed request', async () => {
    const body = JSON.stringify({ tags: ['catalog:best-sellers'] });
    const headers = signedHeaders(SECRET, body);
    const response = await POST(
      new Request('http://localhost/api/internal/revalidate', { method: 'POST', headers, body }),
    );
    expect(response.status).toBe(200);
    expect(revalidateTag).toHaveBeenCalledWith('catalog:best-sellers', 'max');
  });

  it('refuses an oversized streamed body before checking the signature', async () => {
    let sent = 0;
    const chunk = new TextEncoder().encode('x'.repeat(8 * 1024));
    const body = new ReadableStream<Uint8Array>({
      pull(controller) {
        if (sent++ < 128) controller.enqueue(chunk);
        else controller.close();
      },
    });
    const response = await POST(
      new Request('http://localhost/api/internal/revalidate', {
        method: 'POST',
        body,
        duplex: 'half',
      } as RequestInit),
    );
    expect(response.status).toBe(413);
    expect(sent).toBeLessThan(10);
    expect(revalidateTag).not.toHaveBeenCalled();
  });
});
