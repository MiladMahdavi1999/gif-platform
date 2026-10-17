import { afterEach, describe, expect, it, vi } from 'vitest';
import { eligibleGif, searchGifs } from './public-read.js';

const id = '16f72691-8f32-426f-8f86-e42b6b520879';
const detail = {
  id,
  title: '<script>untrusted text</script>',
  tags: [],
  creator: { id, displayName: 'Creator' },
  createdAt: '2026-10-17T00:00:00Z',
  posterUrl: `/media/${id}/poster.png`,
  displayUrl: `/media/${id}/display.gif`,
  description: null,
  attribution: 'Creator',
};
afterEach(() => vi.unstubAllGlobals());
describe('Picker reuses public HTTP contracts only', () => {
  it('fresh detail GET omits credentials and cache, forbids redirects, and binds abort', async () => {
    const request = vi.fn().mockResolvedValue(Response.json(detail));
    vi.stubGlobal('fetch', request);
    const active = new AbortController();
    expect(await eligibleGif(id, active.signal)).toEqual(detail);
    expect(request).toHaveBeenCalledExactlyOnceWith(
      `/api/v1/public/gifs/${id}`,
      expect.objectContaining({
        method: 'GET',
        cache: 'no-store',
        credentials: 'omit',
        redirect: 'error',
        signal: expect.any(AbortSignal),
      }),
    );
    active.abort();
    expect(request.mock.calls[0]![1].signal.aborted).toBe(true);
  });
  it('search encodes untrusted query/cursor and validates the B06 response', async () => {
    const request = vi
      .fn()
      .mockResolvedValue(
        Response.json({ items: [detail], nextCursor: 'next' }),
      );
    vi.stubGlobal('fetch', request);
    expect(
      (await searchGifs('x&tag=private', new AbortController().signal, 'a+b'))
        .items,
    ).toHaveLength(1);
    const url = new URL(request.mock.calls[0]![0], 'http://localhost');
    expect([...url.searchParams.entries()]).toEqual([
      ['q', 'x&tag=private'],
      ['cursor', 'a+b'],
    ]);
  });
  it.each([403, 404])(
    'maps %s to a non-disclosing restricted state',
    async (status) => {
      vi.stubGlobal(
        'fetch',
        vi.fn().mockResolvedValue(new Response('', { status })),
      );
      await expect(
        eligibleGif(id, new AbortController().signal),
      ).rejects.toMatchObject({ restricted: true });
    },
  );
  it('keeps server failures recoverable without trusting their message', async () => {
    vi.stubGlobal(
      'fetch',
      vi
        .fn()
        .mockResolvedValue(new Response('private diagnostic', { status: 503 })),
    );
    await expect(
      eligibleGif(id, new AbortController().signal),
    ).rejects.toMatchObject({
      restricted: false,
      message: 'Public read unavailable',
    });
  });
  it.each([
    { posterUrl: 'https://storage.invalid/private.png' },
    { displayUrl: '/media/16f72691-8f32-426f-8f86-e42b6b520870/display.gif' },
    { id: '16f72691-8f32-426f-8f86-e42b6b520870' },
    { description: undefined },
  ])('fails closed for invalid or mismatched detail %j', async (change) => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(Response.json({ ...detail, ...change })),
    );
    await expect(
      eligibleGif(id, new AbortController().signal),
    ).rejects.toThrow();
  });
});
