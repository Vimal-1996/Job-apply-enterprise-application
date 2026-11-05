import { describe, expect, it } from 'vitest';
import { initials } from './ui';

describe('initials', () => {
  it('uses the first letters of the email name parts', () => {
    expect(initials('jane.doe@example.com')).toBe('JD');
  });
  it('handles a single word and digits', () => {
    expect(initials('vimal.prof19@gmail.com')).toBe('VP');
    expect(initials('admin@example.com')).toBe('A');
  });
  it('handles missing email', () => expect(initials(undefined)).toBe('?'));
});
