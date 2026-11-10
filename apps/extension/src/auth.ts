import { loadSettings } from './config';
import { challengeFor, emailFromIdToken, randomString } from './pkce';

/*
 * Signs in with the same Cognito login as the web app (code flow + PKCE)
 * through chrome.identity, which returns to https://<extension-id>.chromiumapp.org/.
 * Tokens are kept in session storage only: Chrome forgets them when it closes.
 */

interface Session {
  accessToken: string;
  refreshToken: string | null;
  expiresAt: number;
  email: string | null;
}

interface TokenResponse {
  access_token: string;
  id_token?: string;
  refresh_token?: string;
  expires_in: number;
}

async function tokenRequest(params: Record<string, string>): Promise<TokenResponse> {
  const { cognitoDomain } = await loadSettings();
  const res = await fetch(`${cognitoDomain}/oauth2/token`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams(params),
  });
  if (!res.ok) throw new Error(`Sign-in failed (${res.status})`);
  return res.json();
}

async function store(t: TokenResponse, previous?: Session): Promise<Session> {
  const session: Session = {
    accessToken: t.access_token,
    refreshToken: t.refresh_token ?? previous?.refreshToken ?? null,
    expiresAt: Date.now() + t.expires_in * 1000,
    email: emailFromIdToken(t.id_token) ?? previous?.email ?? null,
  };
  await chrome.storage.session.set({ session });
  return session;
}

async function current(): Promise<Session | null> {
  const { session } = await chrome.storage.session.get('session');
  return (session as Session | undefined) ?? null;
}

/** Opens the sign-in window. Resolves with the signed-in email. */
export async function signIn(): Promise<string | null> {
  const { cognitoDomain, clientId } = await loadSettings();
  const redirectUri = chrome.identity.getRedirectURL();
  const verifier = randomString(48);
  const state = randomString(16);
  const url = new URL(`${cognitoDomain}/oauth2/authorize`);
  url.search = new URLSearchParams({
    response_type: 'code',
    client_id: clientId,
    redirect_uri: redirectUri,
    scope: 'openid email profile',
    state,
    code_challenge: await challengeFor(verifier),
    code_challenge_method: 'S256',
  }).toString();

  const returned = await chrome.identity.launchWebAuthFlow({ url: url.toString(), interactive: true });
  if (!returned) throw new Error('Sign-in was cancelled');
  const params = new URL(returned).searchParams;
  if (params.get('state') !== state) throw new Error('Sign-in failed: the response did not match the request');
  const code = params.get('code');
  if (!code) throw new Error(params.get('error_description') ?? 'Sign-in was cancelled');

  const tokens = await tokenRequest({ grant_type: 'authorization_code', client_id: clientId, code, redirect_uri: redirectUri, code_verifier: verifier });
  return (await store(tokens)).email;
}

/** A valid access token, refreshed if needed; null if signed out. */
export async function accessToken(): Promise<string | null> {
  const session = await current();
  if (!session) return null;
  if (session.expiresAt - Date.now() > 60_000) return session.accessToken;
  if (!session.refreshToken) return null;
  try {
    const { clientId } = await loadSettings();
    return (await store(await tokenRequest({ grant_type: 'refresh_token', client_id: clientId, refresh_token: session.refreshToken }), session)).accessToken;
  } catch {
    await chrome.storage.session.remove('session');
    return null;
  }
}

export async function signedInEmail(): Promise<string | null> {
  return (await accessToken()) ? ((await current())?.email ?? '') : null;
}

/** Forgets the tokens and revokes the refresh token. */
export async function signOut(): Promise<void> {
  const session = await current();
  await chrome.storage.session.remove('session');
  if (session?.refreshToken) {
    const { cognitoDomain, clientId } = await loadSettings();
    await fetch(`${cognitoDomain}/oauth2/revoke`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({ token: session.refreshToken, client_id: clientId }),
    }).catch(() => undefined);
  }
}
