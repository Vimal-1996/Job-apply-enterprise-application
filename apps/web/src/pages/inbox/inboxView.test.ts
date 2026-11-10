import { describe, expect, it } from 'vitest';
import type { GmailConnection, InboxEmail } from '../../api/types';
import { dueLabel, filterCounts, filterEmails, groupByDay, isRead, presetRange, rangeLabel, rangeProblem, rangeWindow, sender, shouldAutoSync } from './inboxView';

const email = (over: Partial<InboxEmail>): InboxEmail => ({
  id: 'e',
  fromName: null,
  fromAddress: 'no-reply@greenhouse.io',
  subject: 'Hi',
  receivedAt: '2026-11-01T00:00:00Z',
  category: 'other_job',
  summary: null,
  action: null,
  actionDue: null,
  company: null,
  threadUrl: 'https://mail.google.com/mail/u/0/#all/t',
  job: null,
  linkSource: null,
  suggestion: null,
  ...over,
});

const conn = (over: Partial<GmailConnection>): GmailConnection => ({
  email: 'jane@gmail.com',
  status: 'connected',
  syncStatus: 'idle',
  syncError: null,
  lastSyncedAt: null,
  connectedAt: '2026-11-01T00:00:00Z',
  readRanges: [],
  ...over,
});

describe('inbox filters', () => {
  const job = { id: 'j', title: 'Engineer', company: 'Acme', applicationStatus: 'applied' as const };
  const emails = [
    email({ id: 'a', job }),
    email({ id: 'b', action: 'Pick a time' }),
    email({ id: 'c', job, suggestion: { status: 'interviewing' } }),
    email({ id: 'd' }),
  ];
  it('filters linked and needs-action emails, and counts them', () => {
    expect(filterEmails(emails, 'linked').map((e) => e.id)).toEqual(['a', 'c']);
    expect(filterEmails(emails, 'action').map((e) => e.id)).toEqual(['b', 'c']);
    expect(filterCounts(emails)).toEqual({ all: 4, linked: 2, action: 2 });
  });
  it('names the sender', () => {
    expect(sender(email({ fromName: 'Acme' }))).toBe('Acme');
    expect(sender(email({}))).toBe('no-reply@greenhouse.io');
  });
});

describe('dueLabel', () => {
  const now = new Date(2026, 10, 10, 15);
  it('says when an action is due, or overdue', () => {
    expect(dueLabel('2026-11-20', now)).toEqual({ text: 'Due Nov 20', overdue: false });
    expect(dueLabel('2026-11-10', now)).toEqual({ text: 'Due Nov 10', overdue: false });
    expect(dueLabel('2026-11-09', now)).toEqual({ text: 'Overdue (Nov 9)', overdue: true });
    expect(dueLabel('2027-01-05', now)?.text).toBe('Due Jan 5, 2027');
    expect(dueLabel(null, now)).toBeNull();
    expect(dueLabel('soon', now)).toBeNull();
  });
});

describe('shouldAutoSync', () => {
  const now = Date.parse('2026-11-10T12:00:00Z');
  it('syncs a new connection, or one last synced over 10 minutes ago', () => {
    expect(shouldAutoSync(null, now)).toBe(false);
    expect(shouldAutoSync(conn({}), now)).toBe(true);
    expect(shouldAutoSync(conn({ syncStatus: 'failed' }), now)).toBe(false);
    expect(shouldAutoSync(conn({ syncStatus: 'syncing' }), now)).toBe(false);
    expect(shouldAutoSync(conn({ status: 'expired' }), now)).toBe(false);
    expect(shouldAutoSync(conn({ lastSyncedAt: '2026-11-10T11:55:00Z' }), now)).toBe(false);
    expect(shouldAutoSync(conn({ lastSyncedAt: '2026-11-10T11:00:00Z' }), now)).toBe(true);
  });
});

describe('date ranges', () => {
  const now = new Date(2026, 10, 10, 15); // Nov 10, 2026, local time

  it('makes preset ranges ending today', () => {
    expect(presetRange(7, now)).toEqual({ from: '2026-11-04', to: '2026-11-10' });
    expect(presetRange(60, now)).toEqual({ from: '2026-09-12', to: '2026-11-10' });
  });

  it('checks picked dates', () => {
    expect(rangeProblem({ from: '2026-09-01', to: '2026-09-30' }, now)).toBeNull();
    expect(rangeProblem({ from: '', to: '2026-09-30' }, now)).toBe('Pick both dates.');
    expect(rangeProblem({ from: '2026-10-01', to: '2026-09-30' }, now)).toContain('after');
    expect(rangeProblem({ from: '2026-11-01', to: '2026-11-11' }, now)).toContain('future');
    expect(rangeProblem({ from: '2024-01-01', to: '2024-02-01' }, now)).toContain('2 years');
  });

  it('turns whole local days into the API window', () => {
    const w = rangeWindow({ from: '2026-09-01', to: '2026-09-30' });
    expect(new Date(w.since)).toEqual(new Date(2026, 8, 1));
    expect(new Date(w.until)).toEqual(new Date(2026, 9, 1));
  });

  it('labels ranges', () => {
    expect(rangeLabel({ from: '2026-09-01', to: '2026-09-30' }, now)).toBe('Sep 1 – Sep 30');
    expect(rangeLabel({ from: '2026-09-01', to: '2026-09-01' }, now)).toBe('Sep 1');
    expect(rangeLabel({ from: '2025-12-20', to: '2026-01-05' }, now)).toBe('Dec 20, 2025 – Jan 5, 2026');
  });

  it('knows whether a window has been read, allowing for the last few minutes', () => {
    const iso = (y: number, m: number, d: number) => new Date(y, m, d).toISOString();
    const read = [{ from: iso(2026, 8, 12), to: new Date(now.getTime() - 10 * 60_000).toISOString() }];
    expect(isRead(read, { since: iso(2026, 9, 1), until: iso(2026, 10, 11) }, now.getTime())).toBe(true);
    expect(isRead(read, { since: iso(2026, 8, 1), until: iso(2026, 8, 30) }, now.getTime())).toBe(false);
    expect(isRead([], { since: iso(2026, 9, 1), until: iso(2026, 9, 2) }, now.getTime())).toBe(false);
    const split = [
      { from: iso(2026, 0, 1), to: iso(2026, 0, 10) },
      { from: iso(2026, 0, 10), to: iso(2026, 0, 20) },
    ];
    expect(isRead(split, { since: iso(2026, 0, 2), until: iso(2026, 0, 15) }, now.getTime())).toBe(true);
  });

  it('groups emails by day, newest first', () => {
    const at = (d: number, h: number) => new Date(2026, 10, d, h).toISOString();
    const groups = groupByDay([email({ id: 'a', receivedAt: at(3, 9) }), email({ id: 'b', receivedAt: at(10, 8) }), email({ id: 'c', receivedAt: at(9, 20) }), email({ id: 'd', receivedAt: at(10, 12) })], now);
    expect(groups.map((g) => g.label)).toEqual(['Today', 'Yesterday', 'Tue, Nov 3']);
    expect(groups[0].emails.map((e) => e.id)).toEqual(['d', 'b']);
  });
});
