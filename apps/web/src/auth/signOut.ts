import { cognitoLogoutUrl } from './oidc';

/**
 * Sign-out state, shared outside React so it is already set when removing the
 * user triggers a re-render.
 *
 * Why this exists: removing the user makes route guards see an anonymous
 * visitor, and RequireAuth then starts signinRedirect(). That raced the
 * redirect to Cognito's logout page, and usually won (it finishes later, after
 * async PKCE setup). Cognito's session was still alive, so the user was signed
 * straight back in on the same page. While this flag is set, guards must not
 * start a sign-in.
 */
let signingOut = false;
const listeners = new Set<() => void>();

export function isSigningOut(): boolean {
  return signingOut;
}

export function subscribeSigningOut(cb: () => void): () => void {
  listeners.add(cb);
  return () => listeners.delete(cb);
}

/** Drops local tokens, then ends the Cognito session; the only way to sign out. */
export async function signOut(
  auth: { removeUser: () => Promise<void> },
  navigate: (url: string) => void = (url) => window.location.replace(url),
): Promise<void> {
  if (signingOut) return; // ignore double clicks
  signingOut = true;
  listeners.forEach((l) => l());
  try {
    await auth.removeUser();
  } finally {
    // Always leave via Cognito's logout, even if clearing local state failed;
    // replace() so Back doesn't return to a page of the signed-out session.
    navigate(cognitoLogoutUrl());
  }
}

/** Test hook. */
export function resetSignOutForTests(): void {
  signingOut = false;
}
