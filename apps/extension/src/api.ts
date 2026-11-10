import { accessToken } from './auth';
import { loadSettings } from './config';

/** The parts of the Job Apply API the extension uses (same shapes as apps/web/src/api/types.ts). */

export interface CandidateProfile {
  fullName: string | null;
  headline: string | null;
  email: string | null;
  phone: string | null;
  location: string | null;
  links: string[];
  workHistory: { title: string; company: string; current: boolean }[];
}

export interface JobPreferences {
  needsSponsorship: boolean | null;
}

export interface ProfileView {
  status: 'none' | 'parsing' | 'ready' | 'failed';
  profile: CandidateProfile | null;
}

export type ApplicationStatus = 'saved' | 'applied' | 'interviewing' | 'offer' | 'rejected' | 'withdrawn';

export interface JobSummary {
  id: string;
  url: string | null;
  applyUrl: string | null;
  title: string | null;
  company: string | null;
  matchStatus: 'matching' | 'ready' | 'failed';
  score: number | null;
  verdict: 'strong' | 'good' | 'possible' | 'weak' | null;
  applicationStatus: ApplicationStatus;
}

export interface Resume {
  id: string;
  fileName: string;
  contentType: string;
  isCurrent: boolean;
}

export interface DraftView {
  status: 'none' | 'suggesting' | 'ready' | 'failed';
  suggestions: { decision: 'pending' | 'accepted' | 'rejected' }[];
}

export class ApiError extends Error {
  constructor(
    public status: number,
    message: string,
  ) {
    super(message);
  }
}

export const NOT_SIGNED_IN = 'Sign in to Job Apply first.';

async function call(method: string, path: string, body?: unknown): Promise<Response> {
  const token = await accessToken();
  if (!token) throw new ApiError(401, NOT_SIGNED_IN);
  const { apiUrl } = await loadSettings();
  const headers: Record<string, string> = { Authorization: `Bearer ${token}` };
  if (body !== undefined) headers['Content-Type'] = 'application/json';
  let res: Response;
  try {
    res = await fetch(`${apiUrl}${path}`, { method, headers, body: body === undefined ? undefined : JSON.stringify(body) });
  } catch {
    throw new ApiError(0, `Can't reach Job Apply at ${apiUrl}. Is it running? (Check the address in Options.)`);
  }
  if (!res.ok) {
    const data = (await res.json().catch(() => null)) as { message?: unknown } | null;
    throw new ApiError(res.status, typeof data?.message === 'string' ? data.message : `${res.status} ${res.statusText}`);
  }
  return res;
}

export const api = {
  get: async <T>(path: string) => (await call('GET', path)).json() as Promise<T>,
  post: async <T>(path: string, body?: unknown) => (await call('POST', path, body ?? {})).json() as Promise<T>,
  patch: async <T>(path: string, body: unknown) => (await call('PATCH', path, body)).json() as Promise<T>,
  /** A file from the API (with sign-in), with the name from Content-Disposition. */
  file: async (path: string) => {
    const res = await call('GET', path);
    return { bytes: new Uint8Array(await res.arrayBuffer()), contentType: res.headers.get('Content-Type') ?? 'application/octet-stream', disposition: res.headers.get('Content-Disposition') };
  },
};

/** Downloads a pre-signed S3 link (no sign-in header: the link itself grants access). */
export async function fetchSigned(url: string): Promise<Uint8Array> {
  const res = await fetch(url);
  if (!res.ok) throw new ApiError(res.status, `Could not download the resume (${res.status})`);
  return new Uint8Array(await res.arrayBuffer());
}
