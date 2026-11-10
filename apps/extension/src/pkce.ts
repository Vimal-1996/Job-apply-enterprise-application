/** PKCE helpers (RFC 7636) for the authorization code flow. */

export function base64url(bytes: Uint8Array): string {
  let s = '';
  for (const b of bytes) s += String.fromCharCode(b);
  return btoa(s).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

export function randomString(byteLength = 32): string {
  return base64url(crypto.getRandomValues(new Uint8Array(byteLength)));
}

export async function challengeFor(verifier: string): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(verifier));
  return base64url(new Uint8Array(digest));
}

/** The email in an ID token (no verification needed: it's only shown, never trusted). */
export function emailFromIdToken(idToken: string | undefined): string | null {
  try {
    const part = idToken?.split('.')[1];
    if (!part) return null;
    const json = JSON.parse(atob(part.replace(/-/g, '+').replace(/_/g, '/')));
    return typeof json.email === 'string' ? json.email : null;
  } catch {
    return null;
  }
}
