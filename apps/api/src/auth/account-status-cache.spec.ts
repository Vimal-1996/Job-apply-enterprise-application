import { AccountStatusCache } from './account-status-cache';

describe('AccountStatusCache', () => {
  let now = 0;
  const source = { statusOf: jest.fn(async () => 'active' as const) };
  const cache = new AccountStatusCache(source, 1000, () => now);

  beforeEach(() => {
    now = 0;
    source.statusOf.mockClear();
    cache.invalidate('u1');
  });

  it('serves repeat lookups from cache until the TTL passes', async () => {
    await cache.statusOf('u1');
    now = 999;
    await cache.statusOf('u1');
    expect(source.statusOf).toHaveBeenCalledTimes(1);
    now = 1000;
    await cache.statusOf('u1');
    expect(source.statusOf).toHaveBeenCalledTimes(2);
  });

  it('re-reads after invalidate', async () => {
    await cache.statusOf('u1');
    cache.invalidate('u1');
    await cache.statusOf('u1');
    expect(source.statusOf).toHaveBeenCalledTimes(2);
  });

  it('does not cache failures', async () => {
    source.statusOf.mockRejectedValueOnce(new Error('aws down'));
    await expect(cache.statusOf('u1')).rejects.toThrow('aws down');
    await expect(cache.statusOf('u1')).resolves.toBe('active');
  });
});
