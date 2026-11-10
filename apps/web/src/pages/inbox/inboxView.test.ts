import { describe, expect, it } from 'vitest';
import type { GmailConnection, InboxEmail } from '../../api/types';
import { dueLabel, filterCounts, filterEmails, sender, shouldAutoSync } from './inboxView';

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
