import { createHash, randomBytes } from 'crypto';
import { GmailRawMessage } from './gmail-message';

export const GMAIL_API = Symbol('GMAIL_API');

/** Read job emails (Phase 1) and send replies the user writes (Phase 2), asked for together so one consent covers both. */
export const GMAIL_SCOPES = ['https://www.googleapis.com/auth/gmail.readonly', 'https://www.googleapis.com/auth/gmail.send'];

/** Google no longer accepts the user's token, or it lacks a permission: they need to connect again. */
export class GmailAuthError extends Error {}

export interface GmailTokens {
  accessToken: string;
  /** Epoch ms. */
  expiresAt: number;
  refreshToken: string | null;
  scope: string;
}

/** Google's OAuth and Gmail REST APIs, behind an interface so tests use a fake. */
export interface GmailApi {
  authUrl(state: string, codeChallenge: string): string;
  exchangeCode(code: string, codeVerifier: string): Promise<GmailTokens>;
  refresh(refreshToken: string): Promise<GmailTokens>;
  revoke(token: string): Promise<void>;
  profileEmail(accessToken: string): Promise<string>;
  /** Message IDs matching a Gmail search, newest first, at most `max`. */
  listMessageIds(accessToken: string, query: string, max: number): Promise<string[]>;
  getMessage(accessToken: string, id: string): Promise<GmailRawMessage>;
}

/** PKCE (RFC 7636): a random verifier and its S256 challenge. */
export function pkcePair(): { verifier: string; challenge: string } {
  const verifier = randomBytes(32).toString('base64url');
  return { verifier, challenge: createHash('sha256').update(verifier).digest('base64url') };
}

/** Senders' domains that send application emails: the common hiring systems and job sites. */
export const JOB_SENDER_DOMAINS = [
  'greenhouse.io',
  'greenhouse-mail.io',
  'lever.co',
  'myworkday.com',
  'myworkdayjobs.com',
  'ashbyhq.com',
  'smartrecruiters.com',
  'icims.com',
  'jobvite.com',
  'workablemail.com',
  'bamboohr.com',
  'linkedin.com',
  'indeed.com',
  'indeedemail.com',
];

const SUBJECT_WORDS = ['application', 'applying', 'applied', 'interview', 'assessment', 'offer', 'position', 'role', 'candidate', 'candidacy', 'recruiter', 'opportunity', 'hiring'];

/**
 * The Gmail search for likely job emails in a time window (epoch ms): from a
 * hiring system or with a job-ish subject, not sent by the user. Claude then
 * decides which really are.
 */
export function jobEmailQuery(window: { from: number; to: number }): string {
  const after = Math.floor(window.from / 1000);
  const before = Math.ceil(window.to / 1000);
  return `after:${after} before:${before} -from:me -in:chats {${JOB_SENDER_DOMAINS.map((d) => `from:${d}`).join(' ')} subject:(${SUBJECT_WORDS.join(' OR ')})}`;
}

const AUTH = 'https://accounts.google.com/o/oauth2/v2/auth';
const TOKEN = 'https://oauth2.googleapis.com/token';
const REVOKE = 'https://oauth2.googleapis.com/revoke';
const GMAIL = 'https://gmail.googleapis.com/gmail/v1/users/me';

interface TokenResponse {
  access_token?: string;
  expires_in?: number;
  refresh_token?: string;
  scope?: string;
  error?: string;
  error_description?: string;
}

export class GoogleGmailApi implements GmailApi {
  constructor(private readonly client: { clientId: string; clientSecret: string; redirectUri: string }) {}

  authUrl(state: string, codeChallenge: string): string {
    const q = new URLSearchParams({
      client_id: this.client.clientId,
      redirect_uri: this.client.redirectUri,
      response_type: 'code',
      scope: GMAIL_SCOPES.join(' '),
      // A refresh token, so syncing works without the user present; prompt=consent makes Google issue one every time.
      access_type: 'offline',
      prompt: 'consent',
      include_granted_scopes: 'true',
      state,
      code_challenge: codeChallenge,
      code_challenge_method: 'S256',
    });
    return `${AUTH}?${q}`;
  }

  exchangeCode(code: string, codeVerifier: string): Promise<GmailTokens> {
    return this.token({ grant_type: 'authorization_code', code, code_verifier: codeVerifier, redirect_uri: this.client.redirectUri });
  }

  refresh(refreshToken: string): Promise<GmailTokens> {
    return this.token({ grant_type: 'refresh_token', refresh_token: refreshToken });
  }

  async revoke(token: string): Promise<void> {
    await fetch(REVOKE, { method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, body: new URLSearchParams({ token }) });
  }

  async profileEmail(accessToken: string): Promise<string> {
    const p = await this.get<{ emailAddress: string }>(accessToken, `${GMAIL}/profile`);
    return p.emailAddress;
  }

  async listMessageIds(accessToken: string, query: string, max: number): Promise<string[]> {
    const ids: string[] = [];
    let pageToken: string | undefined;
    do {
      const q = new URLSearchParams({ q: query, maxResults: String(Math.min(100, max - ids.length)) });
      if (pageToken) q.set('pageToken', pageToken);
      const page = await this.get<{ messages?: { id: string }[]; nextPageToken?: string }>(accessToken, `${GMAIL}/messages?${q}`);
      ids.push(...(page.messages ?? []).map((m) => m.id));
      pageToken = page.nextPageToken;
    } while (pageToken && ids.length < max);
    return ids.slice(0, max);
  }

  getMessage(accessToken: string, id: string): Promise<GmailRawMessage> {
    return this.get<GmailRawMessage>(accessToken, `${GMAIL}/messages/${encodeURIComponent(id)}?format=full`);
  }

  private async token(params: Record<string, string>): Promise<GmailTokens> {
    const res = await fetch(TOKEN, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({ ...params, client_id: this.client.clientId, client_secret: this.client.clientSecret }),
    });
    const body = (await res.json().catch(() => ({}))) as TokenResponse;
    if (!res.ok || !body.access_token) {
      // invalid_grant: the token expired or was revoked (or the code was already used).
      if (body.error === 'invalid_grant') throw new GmailAuthError('Google no longer accepts this connection');
      throw new Error(`Google token request failed: ${res.status} ${body.error ?? ''} ${body.error_description ?? ''}`.trim());
    }
    return {
      accessToken: body.access_token,
      expiresAt: Date.now() + (body.expires_in ?? 3600) * 1000,
      refreshToken: body.refresh_token ?? null,
      scope: body.scope ?? '',
    };
  }

  private async get<T>(accessToken: string, url: string): Promise<T> {
    const res = await fetch(url, { headers: { Authorization: `Bearer ${accessToken}` } });
    if (res.status === 401 || res.status === 403) throw new GmailAuthError(`Gmail refused access (${res.status})`);
    if (!res.ok) throw new Error(`Gmail request failed: ${res.status}`);
    return (await res.json()) as T;
  }
}
