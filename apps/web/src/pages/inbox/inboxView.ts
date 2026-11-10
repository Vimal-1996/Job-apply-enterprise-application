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

/* ---- Date ranges (calendar days in the user's time zone) ---- */

export type RangePreset = '7' | '30' | '60' | 'custom';

export const PRESETS: { value: RangePreset; label: string }[] = [
  { value: '7', label: 'Last 7 days' },
  { value: '30', label: 'Last 30 days' },
  { value: '60', label: 'Last 60 days' },
  { value: 'custom', label: 'Pick dates' },
];

/** How far back dates can be picked (matches the API). */
export const MAX_DAYS_BACK = 730;

/** A date as YYYY-MM-DD in local time (what <input type="date"> uses). */
export function ymd(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

function parseYmd(s: string): Date | null {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(s);
  return m ? new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3])) : null;
}

export interface DayRange {
  /** First day, YYYY-MM-DD. */
  from: string;
  /** Last day (included), YYYY-MM-DD. */
  to: string;
}

/** The last `days` days, ending today. */
export function presetRange(days: number, now = new Date()): DayRange {
  const start = new Date(now.getFullYear(), now.getMonth(), now.getDate() - (days - 1));
  return { from: ymd(start), to: ymd(now) };
}

/** A range the API accepts: real dates, in order, not in the future, not too far back. Null if fine, else why not. */
export function rangeProblem(r: DayRange, now = new Date()): string | null {
  const from = parseYmd(r.from);
  const to = parseYmd(r.to);
  if (!from || !to) return 'Pick both dates.';
  if (from > to) return 'The start date is after the end date.';
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  if (to > today) return "The end date can't be in the future.";
  const oldest = new Date(today.getFullYear(), today.getMonth(), today.getDate() - MAX_DAYS_BACK);
  if (from < oldest) return 'Dates can go back at most 2 years.';
  return null;
}

/** The API's [since, until) window for a range of whole local days. */
export function rangeWindow(r: DayRange): { since: string; until: string } {
  const from = parseYmd(r.from)!;
  const to = parseYmd(r.to)!;
  return { since: from.toISOString(), until: new Date(to.getFullYear(), to.getMonth(), to.getDate() + 1).toISOString() };
}

/** "Sep 1 – Sep 30, 2026"; one day shows once. */
export function rangeLabel(r: DayRange, now = new Date()): string {
  const from = parseYmd(r.from);
  const to = parseYmd(r.to);
  if (!from || !to) return '';
  const fmt = (d: Date, year: boolean) => d.toLocaleDateString('en', { month: 'short', day: 'numeric', ...(year ? { year: 'numeric' } : {}) });
  const showYear = from.getFullYear() !== now.getFullYear() || to.getFullYear() !== now.getFullYear();
  if (r.from === r.to) return fmt(from, showYear);
  return `${fmt(from, showYear && from.getFullYear() !== to.getFullYear())} – ${fmt(to, showYear)}`;
}

/** Mail from the last few minutes is never marked read (it may still be arriving), so it doesn't count as missing. */
const SETTLE_MS = 15 * 60_000;

/** Whether everything in the window has been read from Gmail already. */
export function isRead(readRanges: { from: string; to: string }[], w: { since: string; until: string }, now = Date.now()): boolean {
  const from = Date.parse(w.since);
  const to = Math.min(Date.parse(w.until), now - SETTLE_MS);
  if (to <= from) return true;
  let cursor = from;
  const sorted = readRanges.map((r) => ({ from: Date.parse(r.from), to: Date.parse(r.to) })).sort((a, b) => a.from - b.from);
  for (const r of sorted) {
    if (r.from > cursor) break;
    cursor = Math.max(cursor, r.to);
    if (cursor >= to) return true;
  }
  return cursor >= to;
}

/** Emails grouped by the local day they arrived, newest day first: "Today", "Yesterday", or "Mon, Nov 3". */
export function groupByDay(emails: InboxEmail[], now = new Date()): { key: string; label: string; emails: InboxEmail[] }[] {
  const today = ymd(now);
  const yesterday = ymd(new Date(now.getFullYear(), now.getMonth(), now.getDate() - 1));
  const groups = new Map<string, InboxEmail[]>();
  for (const e of [...emails].sort((a, b) => b.receivedAt.localeCompare(a.receivedAt))) {
    const key = ymd(new Date(e.receivedAt));
    groups.set(key, [...(groups.get(key) ?? []), e]);
  }
  return [...groups.entries()].map(([key, list]) => {
    const d = parseYmd(key)!;
    const label =
      key === today
        ? 'Today'
        : key === yesterday
          ? 'Yesterday'
          : d.toLocaleDateString('en', { weekday: 'short', month: 'short', day: 'numeric', ...(d.getFullYear() !== now.getFullYear() ? { year: 'numeric' } : {}) });
    return { key, label, emails: list };
  });
}
