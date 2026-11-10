/** Recognises Greenhouse and Lever job pages and reads the job from them. */

export type Site = 'greenhouse' | 'lever';

export interface PageJob {
  site: Site;
  /** The posting's own address (without /apply), used to link it to a saved job. */
  url: string;
  title: string | null;
  company: string | null;
  /** The posting text; may be short on an application-only page (see `postingUrl`). */
  description: string;
}

const text = (el: Element | null | undefined) => (el?.textContent ?? '').replace(/\s+/g, ' ').trim();

/** "acme-corp" → "Acme Corp" (a fallback when the page doesn't name the company). */
export function prettySlug(slug: string): string {
  return slug
    .split(/[-_]+/)
    .filter(Boolean)
    .map((w) => w[0].toUpperCase() + w.slice(1))
    .join(' ');
}

export function detectSite(url: URL): Site | null {
  if (url.hostname === 'greenhouse.io' || url.hostname.endsWith('.greenhouse.io')) return 'greenhouse';
  if (url.hostname === 'jobs.lever.co' || url.hostname === 'jobs.eu.lever.co') return 'lever';
  return null;
}

/** The posting address for this page (Greenhouse embeds and Lever /apply pages point back to it). */
export function postingUrl(url: URL): { site: Site; url: string; companySlug: string | null } | null {
  const site = detectSite(url);
  if (!site) return null;
  const parts = url.pathname.split('/').filter(Boolean);
  if (site === 'greenhouse') {
    // Embedded form: boards.greenhouse.io/embed/job_app?for=acme&token=123
    if (parts[0] === 'embed') {
      const co = url.searchParams.get('for');
      const token = url.searchParams.get('token');
      if (co && token) return { site, url: `https://job-boards.greenhouse.io/${co}/jobs/${token}`, companySlug: co };
      return null;
    }
    const i = parts.indexOf('jobs');
    if (i >= 1 && parts[i + 1]) return { site, url: `${url.origin}/${parts.slice(0, i + 2).join('/')}`, companySlug: parts[i - 1] };
    return null;
  }
  // jobs.lever.co/acme/<uuid>[/apply]
  if (parts.length >= 2) return { site, url: `${url.origin}/${parts[0]}/${parts[1]}`, companySlug: parts[0] };
  return null;
}

/** Reads the job from a Greenhouse or Lever page; null if this isn't a job page. */
export function jobFromPage(doc: Document, href: string): PageJob | null {
  const url = new URL(href);
  const posting = postingUrl(url);
  if (!posting) return null;
  const meta = (p: string) => doc.querySelector(`meta[property="${p}"]`)?.getAttribute('content')?.trim() || null;

  if (posting.site === 'greenhouse') {
    const title = text(doc.querySelector('.job__title h1, .app-title, h1.section-header, h1')) || meta('og:title');
    const company =
      text(doc.querySelector('.company-name')).replace(/^at\s+/i, '') || meta('og:site_name') || (posting.companySlug ? prettySlug(posting.companySlug) : null);
    const description = text(doc.querySelector('.job__description, #content, .job-post-content, [class*="job-description"]'));
    return { site: 'greenhouse', url: posting.url, title: title || null, company, description };
  }

  const title = text(doc.querySelector('.posting-headline h2, [data-qa="posting-name"]')) || meta('og:title');
  const company = (doc.querySelector('.main-header-logo img')?.getAttribute('alt') ?? '').trim() || (posting.companySlug ? prettySlug(posting.companySlug) : null);
  const sections = [...doc.querySelectorAll('[data-qa="job-description"], .posting-page .section-wrapper .section')].map(text).filter(Boolean);
  return { site: 'lever', url: posting.url, title: title || null, company, description: sections.join('\n\n') };
}
