import { fromStored, gaps, mergeRanges, toStored } from './read-ranges';

const r = (from: number, to: number) => ({ from, to });

describe('read ranges', () => {
  it('merges overlapping and touching ranges, dropping empty ones', () => {
    expect(mergeRanges([r(50, 60), r(0, 10), r(10, 20), r(15, 30), r(40, 40)])).toEqual([r(0, 30), r(50, 60)]);
  });

  it('finds the unread parts of a window, newest first', () => {
    const have = [r(10, 20), r(30, 40)];
    expect(gaps(have, r(0, 50))).toEqual([r(40, 50), r(20, 30), r(0, 10)]);
    expect(gaps(have, r(12, 18))).toEqual([]);
    expect(gaps(have, r(15, 35))).toEqual([r(20, 30)]);
    expect(gaps([], r(5, 9))).toEqual([r(5, 9)]);
    expect(gaps([r(0, 100)], r(5, 9))).toEqual([]);
  });

  it('round-trips the stored form and ignores junk', () => {
    const ranges = [r(Date.UTC(2026, 0, 1), Date.UTC(2026, 1, 1))];
    expect(fromStored(toStored(ranges))).toEqual(ranges);
    expect(fromStored([{ from: 'nope', to: '2026-01-01T00:00:00Z' }, 'x'])).toEqual([]);
    expect(fromStored(null)).toEqual([]);
  });
});
