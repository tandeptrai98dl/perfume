import { beforeEach, describe, expect, it, vi } from 'vitest';

/*
 * Admin upload route (§12): Origin (CSRF), the declared size and the staff session are all
 * checked before the multipart body is buffered, so anonymous or oversized requests never
 * cost the server memory. Auth, storage and the catalogue module are doubles.
 */

const { requirePermission, uploadMedia } = vi.hoisted(() => ({
  requirePermission: vi.fn(),
  uploadMedia: vi.fn(),
}));

vi.mock('@/server/auth/guards', () => {
  class AuthorizationError extends Error {}
  return { AuthorizationError, requirePermission };
});
vi.mock('@/server/modules/catalog', () => ({ uploadMedia }));
vi.mock('@/server/integrations/storage', () => ({ getStorage: () => ({ kind: 'memory' }) }));
vi.mock('@/server/db/client', () => ({ getDb: () => ({}) }));
vi.mock('@/lib/env', () => ({ serverEnv: () => ({ APP_URL: 'http://localhost:3000' }) }));

import { AuthorizationError } from '@/server/auth/guards';

import { POST } from './route';

const URL_ = 'http://localhost:3000/api/admin/media';

function upload(headers: Record<string, string>, body: BodyInit = 'x') {
  const request = new Request(URL_, { method: 'POST', headers, body });
  const formData = vi.spyOn(request, 'formData');
  return { request, formData };
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe('POST /api/admin/media', () => {
  it('refuses cross-site requests', async () => {
    const { request, formData } = upload({ origin: 'https://evil.example', 'content-length': '1' });
    expect((await POST(request)).status).toBe(403);
    expect(formData).not.toHaveBeenCalled();
  });

  it('refuses a body without a declared length or above 10 MB, unread', async () => {
    const missing = upload({ origin: 'http://localhost:3000' });
    expect((await POST(missing.request)).status).toBe(411);
    const huge = upload({ origin: 'http://localhost:3000', 'content-length': '20000000' });
    expect((await POST(huge.request)).status).toBe(413);
    expect(missing.formData).not.toHaveBeenCalled();
    expect(huge.formData).not.toHaveBeenCalled();
    expect(requirePermission).not.toHaveBeenCalled();
  });

  it('checks the staff session before parsing the body', async () => {
    requirePermission.mockRejectedValue(new AuthorizationError('unauthenticated'));
    const { request, formData } = upload({
      origin: 'http://localhost:3000',
      'content-length': '1',
    });
    expect((await POST(request)).status).toBe(401);
    expect(requirePermission).toHaveBeenCalledWith('admin.access');
    expect(formData).not.toHaveBeenCalled();
  });

  it('uploads for a staff session', async () => {
    requirePermission.mockResolvedValue({ user: { id: 'staff-1', role: 'editor' } });
    uploadMedia.mockResolvedValue({ id: 'media-1' });
    const form = new FormData();
    form.set('file', new File([new Uint8Array([1, 2, 3])], 'a.png', { type: 'image/png' }));
    const probe = new Request(URL_, { method: 'POST', body: form });
    const body = await probe.arrayBuffer();
    const request = new Request(URL_, {
      method: 'POST',
      headers: {
        origin: 'http://localhost:3000',
        'content-type': probe.headers.get('content-type')!,
        'content-length': String(body.byteLength),
      },
      body,
    });
    const response = await POST(request);
    expect(response.status).toBe(201);
    expect(uploadMedia).toHaveBeenCalledOnce();
  });
});
