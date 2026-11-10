import { config } from '../config';
import { dispositionFileName } from '../lib/fileName';

/** Codes the API returns (403) for an account an administrator has deactivated or deleted. */
export const BLOCKED_CODES = ['ACCOUNT_INACTIVE', 'ACCOUNT_DELETED'] as const;
export type BlockedCode = (typeof BLOCKED_CODES)[number];

/** Fired on window whenever any API call reports the account is blocked. */
export const ACCOUNT_BLOCKED_EVENT = 'job-apply:account-blocked';

export class ApiError extends Error {
  constructor(
    public status: number,
    message: string,
    public code?: string,
  ) {
    super(message);
  }

  get blocked(): BlockedCode | null {
    return this.status === 403 && BLOCKED_CODES.includes(this.code as BlockedCode) ? (this.code as BlockedCode) : null;
  }
}

/** The ApiError for a failed response, announcing a blocked account. */
async function failure(res: Response): Promise<ApiError> {
  const body = (await res.json().catch(() => null)) as { code?: unknown; message?: unknown } | null;
  const message = typeof body?.message === 'string' ? body.message : `${res.status} ${res.statusText}`;
  const err = new ApiError(res.status, message, typeof body?.code === 'string' ? body.code : undefined);
  if (err.blocked) window.dispatchEvent(new CustomEvent(ACCOUNT_BLOCKED_EVENT, { detail: err.blocked }));
  return err;
}

/** Downloads a file from the API (with sign-in) and saves it in the browser. */
export async function apiDownload(path: string, accessToken: string | undefined, fallbackName: string): Promise<void> {
  const res = await fetch(`${config.apiUrl}${path}`, { headers: accessToken ? { Authorization: `Bearer ${accessToken}` } : {} });
  if (!res.ok) throw await failure(res);
  const url = URL.createObjectURL(await res.blob());
  const a = document.createElement('a');
  a.href = url;
  a.download = dispositionFileName(res.headers.get('Content-Disposition')) ?? fallbackName;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 10_000);
}

/** Calls the API with the Cognito *access* token (what the API verifies). */
async function request<T>(method: string, path: string, accessToken: string | undefined, body?: unknown): Promise<T> {
  const headers: Record<string, string> = accessToken ? { Authorization: `Bearer ${accessToken}` } : {};
  if (body !== undefined) headers['Content-Type'] = 'application/json';
  const res = await fetch(`${config.apiUrl}${path}`, {
    method,
    headers,
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  if (!res.ok) throw await failure(res);
  if (res.status === 204) return undefined as T; // no body (e.g. a delete)
  return res.json() as Promise<T>;
}

export const apiGet = <T>(path: string, accessToken: string | undefined) => request<T>('GET', path, accessToken);
export const apiPost = <T>(path: string, accessToken: string | undefined, body?: unknown) =>
  request<T>('POST', path, accessToken, body);
export const apiPut = <T>(path: string, accessToken: string | undefined, body: unknown) =>
  request<T>('PUT', path, accessToken, body);
export const apiPatch = <T>(path: string, accessToken: string | undefined, body: unknown) =>
  request<T>('PATCH', path, accessToken, body);
export const apiDelete = <T>(path: string, accessToken: string | undefined) => request<T>('DELETE', path, accessToken);
