/*
 * Recognises what the user pasted as a job link: a LinkedIn or Indeed job (by
 * URL or bare LinkedIn job ID) or any other web page. Parsing only: the server
 * never fetches LinkedIn or Indeed pages. The ID lets us spot a job added twice,
 * and the canonical URL links back to the posting.
 */

export type JobSource = 'linkedin' | 'indeed' | 'other';

export interface JobLink {
  source: JobSource;
  /** The site's own job ID; null for other sites. */
  externalId: string | null;
  url: string;
}

export class JobLinkError extends Error {}

const MAX_URL = 2000;
const LINKEDIN_ID = /^\d{6,15}$/;
const INDEED_ID = /^[0-9a-f]{16}$/i;

const isHost = (host: string, domain: string) => host === domain || host.endsWith(`.${domain}`);

/** Indeed runs country sites such as uk.indeed.com, indeed.co.in and indeed.com.au. */
const isIndeedHost = (host: string) => isHost(host, 'indeed.com') || /(^|\.)indeed\.(co\.[a-z]{2}|com\.[a-z]{2}|[a-z]{2})$/.test(host);

/** Parses a pasted job link or LinkedIn job ID. Throws JobLinkError with a message for the user. */
export function parseJobLink(input: string): JobLink {
  const text = input.trim();
  if (LINKEDIN_ID.test(text)) return linkedin(text);
  if (text.length > MAX_URL) throw new JobLinkError('That link is too long');

  let url: URL;
  try {
    url = new URL(/^[a-z][a-z0-9+.-]*:/i.test(text) ? text : `https://${text}`);
  } catch {
    throw new JobLinkError('Paste a job link (https://…) or a LinkedIn job ID');
  }
  if (url.protocol !== 'https:' && url.protocol !== 'http:') throw new JobLinkError('Only web links (https://…) can be added');
  if (url.username || url.password) throw new JobLinkError("That link can't be used");
  const host = url.hostname.toLowerCase();

  if (isHost(host, 'linkedin.com')) {
    // /jobs/view/123, /jobs/view/senior-engineer-at-acme-123, or ?currentJobId=123 on search pages
    const fromPath = url.pathname.match(/\/jobs\/view\/(?:[^/]*-)?(\d{6,15})\/?$/)?.[1];
    const id = fromPath ?? url.searchParams.get('currentJobId');
    if (!id || !LINKEDIN_ID.test(id)) throw new JobLinkError("That LinkedIn link doesn't point to a job. Open the job and copy its link.");
    return linkedin(id);
  }

  if (isIndeedHost(host)) {
    const id = url.searchParams.get('jk') ?? url.searchParams.get('vjk');
    if (!id || !INDEED_ID.test(id)) throw new JobLinkError("That Indeed link doesn't point to a job. Open the job and copy its link.");
    return { source: 'indeed', externalId: id.toLowerCase(), url: `https://${host}/viewjob?jk=${id.toLowerCase()}` };
  }

  url.hash = '';
  return { source: 'other', externalId: null, url: url.toString() };
}

function linkedin(id: string): JobLink {
  return { source: 'linkedin', externalId: id, url: `https://www.linkedin.com/jobs/view/${id}/` };
}
