import { WindowCounter } from './rate-limiter';

describe('WindowCounter', () => {
  it('allows up to the limit per key, then resets with the window', () => {
    let now = 0;
    const c = new WindowCounter(2, 1000, () => now);
    expect([c.take('a'), c.take('a'), c.take('a')]).toEqual([true, true, false]);
    expect(c.take('b')).toBe(true); // keys are independent
    now = 1000;
    expect(c.take('a')).toBe(true);
  });

  it('stays bounded in memory', () => {
    let now = 0;
    const c = new WindowCounter(1, 1000, () => now, 3);
    ['a', 'b', 'c'].forEach((k) => c.take(k));
    now = 2000; // all expired
    expect(c.take('d')).toBe(true);
    expect((c as any).windows.size).toBe(1);
  });
});
