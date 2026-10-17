import { describe, expect, it, vi } from 'vitest';
import type { PublicDetail } from '@gif/contracts';
import { createPickerSession } from './picker-session.ts';
import { PickerReadError } from './public-read.ts';

const id = '16f72691-8f32-426f-8f86-e42b6b520879';
const gif: PublicDetail = {
  id,
  title: 'Owned animation',
  tags: [],
  creator: { id, displayName: 'Creator' },
  createdAt: '2026-10-17T00:00:00Z',
  posterUrl: `/media/${id}/poster.png`,
  displayUrl: `/media/${id}/display.gif`,
  description: null,
  attribution: 'Creator',
};
const callbacks = () => ({
  onSelect: vi.fn(),
  onCancel: vi.fn(),
  onError: vi.fn(),
});
function deferred() {
  let resolve!: (value: PublicDetail) => void;
  const promise = new Promise<PublicDetail>((r) => {
    resolve = r;
  });
  return { promise, resolve };
}
describe('one terminal callback per Picker session', () => {
  it('returns only a typed fresh reference, stripping unrelated fields', async () => {
    const events = callbacks(),
      lookup = vi.fn().mockResolvedValue(gif);
    const session = createPickerSession(events, lookup);
    await session.select(id);
    expect(lookup).toHaveBeenCalledExactlyOnceWith(id, expect.any(AbortSignal));
    expect(events.onSelect).toHaveBeenCalledExactlyOnceWith({
      id,
      kind: 'GIF',
      title: gif.title,
      posterUrl: gif.posterUrl,
      displayUrl: gif.displayUrl,
    });
    expect(events.onCancel).not.toHaveBeenCalled();
    expect(events.onError).not.toHaveBeenCalled();
  });
  it('ignores repeated events during validation and after selection', async () => {
    const events = callbacks(),
      gate = deferred();
    const lookup = vi.fn().mockReturnValue(gate.promise);
    const session = createPickerSession(events, lookup);
    const pending = session.select(id);
    await session.select(id);
    gate.resolve(gif);
    await pending;
    await session.select(id);
    session.cancel();
    expect(lookup).toHaveBeenCalledTimes(1);
    expect(events.onSelect).toHaveBeenCalledTimes(1);
    expect(events.onCancel).not.toHaveBeenCalled();
  });
  it('cancel/Escape/close repeats produce one cancellation', async () => {
    const events = callbacks(),
      lookup = vi.fn();
    const session = createPickerSession(events, lookup);
    session.cancel();
    session.cancel();
    await session.select(id);
    expect(events.onCancel).toHaveBeenCalledTimes(1);
    expect(lookup).not.toHaveBeenCalled();
  });
  it('cancellation aborts pending work and wins over a late successful read', async () => {
    const events = callbacks(),
      gate = deferred();
    const lookup = vi.fn().mockReturnValue(gate.promise);
    const session = createPickerSession(events, lookup);
    const pending = session.select(id);
    const signal = lookup.mock.calls[0]![1] as AbortSignal;
    session.cancel();
    gate.resolve(gif);
    await pending;
    expect(signal.aborted).toBe(true);
    expect(events.onCancel).toHaveBeenCalledTimes(1);
    expect(events.onSelect).not.toHaveBeenCalled();
  });
  it('unmount aborts work silently and never creates a terminal result', async () => {
    const events = callbacks(),
      gate = deferred();
    const session = createPickerSession(events, () => gate.promise);
    const pending = session.select(id);
    session.dispose();
    gate.resolve(gif);
    await pending;
    session.cancel();
    expect(events.onSelect).not.toHaveBeenCalled();
    expect(events.onCancel).not.toHaveBeenCalled();
    expect(events.onError).not.toHaveBeenCalled();
  });
  it('a transient failure permits a fresh retry without false success', async () => {
    const events = callbacks();
    const lookup = vi
      .fn()
      .mockRejectedValueOnce(new Error('network'))
      .mockResolvedValueOnce(gif);
    const session = createPickerSession(events, lookup);
    await session.select(id);
    expect(events.onError).toHaveBeenCalledExactlyOnceWith({
      code: 'SELECTION_UNAVAILABLE',
    });
    expect(events.onSelect).not.toHaveBeenCalled();
    await session.select(id);
    expect(lookup).toHaveBeenCalledTimes(2);
    expect(events.onSelect).toHaveBeenCalledTimes(1);
  });
  it('restriction never succeeds and remains cancellable', async () => {
    const events = callbacks();
    const session = createPickerSession(
      events,
      vi.fn().mockRejectedValue(new PickerReadError(true)),
    );
    await session.select(id);
    expect(events.onError).toHaveBeenCalledExactlyOnceWith({
      code: 'GIF_RESTRICTED',
    });
    expect(events.onSelect).not.toHaveBeenCalled();
    session.cancel();
    expect(events.onCancel).toHaveBeenCalledTimes(1);
  });
  it('settles before invoking a reentrant or throwing Host callback', async () => {
    const events = callbacks();
    const session = createPickerSession(events, vi.fn().mockResolvedValue(gif));
    events.onSelect.mockImplementation(() => {
      session.cancel();
      throw new Error('host');
    });
    await expect(session.select(id)).rejects.toThrow('host');
    await session.select(id);
    expect(events.onSelect).toHaveBeenCalledTimes(1);
    expect(events.onCancel).not.toHaveBeenCalled();
    expect(events.onError).not.toHaveBeenCalled();
  });
});
