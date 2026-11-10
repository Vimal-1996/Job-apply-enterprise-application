import type { JobSummary } from '../api';
import type { PageJob } from './sites';

/**
 * A comparable form of a job address: host without "www.", Greenhouse's board
 * hosts treated as one, no query, no trailing slash or "/apply".
 */
export function normalizeJobUrl(raw: string | null): string | null {
  if (!raw) return null;
  let u: URL;
  try {
    u = new URL(raw);
  } catch {
    return null;
  }
  let host = u.hostname.toLowerCase().replace(/^www\./, '');
  if (host.endsWith('greenhouse.io')) host = 'greenhouse.io';
  let path = u.pathname.replace(/\/+$/, '').replace(/\/apply$/, '');
  if (host === 'greenhouse.io' && path === '/embed/job_app') {
    const co = u.searchParams.get('for');
    const token = u.searchParams.get('token');
    if (co && token) path = `/${co}/jobs/${token}`;
  }
  return `${host}${path.toLowerCase()}`;
}

const words = (s: string | null) =>
  new Set(
    (s ?? '')
      .toLowerCase()
      .split(/[^a-z0-9+#]+/)
      .filter((w) => w.length > 1),
  );

function overlap(a: string | null, b: string | null): number {
  const x = words(a);
  const y = words(b);
  if (!x.size || !y.size) return 0;
  let common = 0;
  for (const w of x) if (y.has(w)) common++;
  return common / Math.max(x.size, y.size);
}

/**
 * The saved job this page is most likely for: the same address first, then
 * the same company with a very similar title. Null if none is a good match.
 */
export function findSavedJob(page: PageJob, jobs: JobSummary[]): JobSummary | null {
  const here = normalizeJobUrl(page.url);
  const byUrl = jobs.find((j) => here && (normalizeJobUrl(j.url) === here || normalizeJobUrl(j.applyUrl) === here));
  if (byUrl) return byUrl;
  const company = (page.company ?? '').toLowerCase().trim();
  if (!company) return null;
  const candidates = jobs
    .filter((j) => (j.company ?? '').toLowerCase().trim() === company)
    .map((j) => ({ j, score: overlap(j.title, page.title) }))
    .filter((c) => c.score >= 0.6)
    .sort((a, b) => b.score - a.score);
  return candidates[0]?.j ?? null;
}
