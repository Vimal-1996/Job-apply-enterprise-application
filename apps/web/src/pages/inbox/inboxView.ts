import type { EmailCategory, GmailConnection, InboxEmail } from '../../api/types';
import type { Tone } from '../../components/ui';

export const CATEGORIES: Record<EmailCategory, { label: string; tone: Tone }> = {
  application_received: { label: 'Application received', tone: 'primary' },
  interview: { label: 'Interview', tone: 'warning' },
  assessment: { label: 'Assessment', tone: 'warning' },
  rejection: { label: 'Rejection', tone: 'danger' },
  offer: { label: 'Offer', tone: 'success' },
  recruiter_outreach: { label: 'Recruiter', tone: 'primary' },
  job_alert: { label: 'Job alert', tone: 'neutral' },
  other_job: { label: 'Job email', tone: 'neutral' },
  not_job: { label: 'Not a job email', tone: 'neutral' },
};

export type InboxFilter = 'all' | 'linked' | 'action';

export const FILTERS: { value: InboxFilter; label: string }[] = [
  { value: 'all', label: 'All' },
  { value: 'linked', label: 'Linked to my jobs' },
  { value: 'action', label: 'Needs action' },
];

export function filterEmails(emails: InboxEmail[], f: InboxFilter): InboxEmail[] {
  if (f === 'linked') return emails.filter((e) => e.job);
  if (f === 'action') return emails.filter((e) => e.action || e.suggestion);
  return emails;
}

export function filterCounts(emails: InboxEmail[]): Record<InboxFilter, number> {
  return { all: emails.length, linked: filterEmails(emails, 'linked').length, action: filterEmails(emails, 'action').length };
}

/** "Due Nov 20" / "Overdue (Nov 20)"; dates are calendar days, compared in the user's time zone. */
export function dueLabel(due: string | null, now = new Date()): { text: string; overdue: boolean } | null {
  if (!due) return null;
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(due);
  if (!m) return null;
  const d = new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]));
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const text = d.toLocaleDateString('en', { month: 'short', day: 'numeric', ...(d.getFullYear() !== now.getFullYear() ? { year: 'numeric' } : {}) });
  return d < today ? { text: `Overdue (${text})`, overdue: true } : { text: `Due ${text}`, overdue: false };
}

/** Sync when the page opens if the last one was a while ago (and none is running or needed reconnecting). */
export function shouldAutoSync(c: GmailConnection | null, now = Date.now(), maxAgeMs = 10 * 60_000): boolean {
  if (!c || c.status !== 'connected' || c.syncStatus === 'syncing') return false;
  if (!c.lastSyncedAt) return c.syncStatus !== 'failed';
  return now - new Date(c.lastSyncedAt).getTime() > maxAgeMs;
}

export const sender = (e: Pick<InboxEmail, 'fromName' | 'fromAddress'>) => e.fromName ?? e.fromAddress;
