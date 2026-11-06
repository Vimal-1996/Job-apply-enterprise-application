import type { UserSummary } from '../../api/types';

type Tone = 'success' | 'warning' | 'danger' | 'neutral';

const STATUS: Record<string, { label: string; tone: Tone }> = {
  CONFIRMED: { label: 'Active', tone: 'success' },
  EXTERNAL_PROVIDER: { label: 'Active (federated)', tone: 'success' },
  FORCE_CHANGE_PASSWORD: { label: 'Invited', tone: 'warning' },
  RESET_REQUIRED: { label: 'Reset required', tone: 'warning' },
  UNCONFIRMED: { label: 'Unconfirmed', tone: 'warning' },
};

/** Disabled always wins over the Cognito status. */
export function accountStatus(u: Pick<UserSummary, 'status' | 'enabled'>): { label: string; tone: Tone } {
  if (!u.enabled) return { label: 'Disabled', tone: 'danger' };
  return STATUS[u.status] ?? { label: u.status.toLowerCase().replace(/_/g, ' '), tone: 'neutral' };
}

export function formatDate(iso: string | null): string {
  if (!iso) return '—';
  return new Date(iso).toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: 'numeric' });
}

export function formatDateTime(iso: string | null): string {
  if (!iso) return '—';
  return new Date(iso).toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' });
}

export function matchesSearch(u: UserSummary, q: string): boolean {
  const needle = q.trim().toLowerCase();
  if (!needle) return true;
  return (u.email ?? '').toLowerCase().includes(needle) || u.id.toLowerCase().includes(needle);
}
