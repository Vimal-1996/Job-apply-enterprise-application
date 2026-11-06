import { describe, expect, it } from 'vitest';
import { ADMIN_NAV } from './adminNav';

describe('ADMIN_NAV', () => {
  const items = ADMIN_NAV.flatMap((g) => g.items);

  it('keeps every section under /admin', () => {
    expect(items.every((i) => i.to === '/admin' || i.to.startsWith('/admin/'))).toBe(true);
  });

  it('has unique routes', () => {
    expect(new Set(items.map((i) => i.to)).size).toBe(items.length);
  });

  it('includes the live Users section', () => {
    expect(items.find((i) => i.to === '/admin/users')?.soon).toBeFalsy();
  });
});
