/*
 * Time ranges of the user's Gmail already read for job emails. Kept merged
 * and sorted, so a sync only reads the gaps in what the user asks for.
 */

export interface TimeRange {
  /** Inclusive start, epoch ms. */
  from: number;
  /** Exclusive end, epoch ms. */
  to: number;
}

/** Sorted, with overlapping or touching ranges joined. Empty or backwards ranges are dropped. */
export function mergeRanges(ranges: TimeRange[]): TimeRange[] {
  const sorted = ranges.filter((r) => r.to > r.from).sort((a, b) => a.from - b.from);
  const out: TimeRange[] = [];
  for (const r of sorted) {
    const last = out[out.length - 1];
    if (last && r.from <= last.to) last.to = Math.max(last.to, r.to);
    else out.push({ ...r });
  }
  return out;
}

/** The parts of `want` not covered by `have`, newest first (the user cares about recent mail most). */
export function gaps(have: TimeRange[], want: TimeRange): TimeRange[] {
  const out: TimeRange[] = [];
  let cursor = want.from;
  for (const r of mergeRanges(have)) {
    if (r.to <= cursor) continue;
    if (r.from >= want.to) break;
    if (r.from > cursor) out.push({ from: cursor, to: Math.min(r.from, want.to) });
    cursor = Math.max(cursor, r.to);
    if (cursor >= want.to) break;
  }
  if (cursor < want.to) out.push({ from: cursor, to: want.to });
  return out.reverse();
}

/** Stored form (ISO strings) ↔ epoch ms. */
export function toStored(ranges: TimeRange[]): { from: string; to: string }[] {
  return ranges.map((r) => ({ from: new Date(r.from).toISOString(), to: new Date(r.to).toISOString() }));
}

export function fromStored(raw: unknown): TimeRange[] {
  if (!Array.isArray(raw)) return [];
  return mergeRanges(
    raw
      .map((r) => ({ from: Date.parse((r as { from?: string }).from ?? ''), to: Date.parse((r as { to?: string }).to ?? '') }))
      .filter((r) => Number.isFinite(r.from) && Number.isFinite(r.to)),
  );
}
