import { WebStorageStateStore } from 'oidc-client-ts';
import type { AuthProviderProps } from 'react-oidc-context';
import { config } from '../config';

/** Authorization code flow with PKCE (oidc-client-ts does PKCE by default). */
export const oidcConfig: AuthProviderProps = {
  authority: config.authority,
  client_id: config.clientId,
  redirect_uri: `${config.appUrl}/callback`,
  response_type: 'code',
  scope: 'openid email profile',
  // sessionStorage: tokens die with the tab, and are not shared across tabs.
  userStore: new WebStorageStateStore({ store: window.sessionStorage }),
  automaticSilentRenew: true,
  // Only /callback is our sign-in return. Other pages can have ?code=&state= too
  // (Google sends the Gmail connection back to /gmail/callback that way); treating
  // those as a Cognito sign-in fails and drops the user's session.
  skipSigninCallback: window.location.pathname !== '/callback',
  // Strip ?code=&state= from the URL; the /callback page then navigates on.
  onSigninCallback: () => {
    window.history.replaceState({}, document.title, window.location.pathname);
  },
};

/** Cognito's logout endpoint is not advertised in its OIDC metadata, so build it. */
export function cognitoLogoutUrl(): string {
  const params = new URLSearchParams({ client_id: config.clientId, logout_uri: `${config.appUrl}/` });
  return `${config.cognitoDomain}/logout?${params}`;
}
