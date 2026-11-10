/** Where the extension talks to: the API and the Cognito sign-in domain. Editable in Options. */
export interface Settings {
  apiUrl: string;
  cognitoDomain: string;
  clientId: string;
}

export const DEFAULT_SETTINGS: Settings = {
  apiUrl: __DEFAULT_API_URL__,
  cognitoDomain: __DEFAULT_COGNITO_DOMAIN__,
  clientId: __DEFAULT_CLIENT_ID__,
};

const trimSlash = (s: string) => s.trim().replace(/\/+$/, '');

/** Checks settings typed in Options; returns them tidied, or a message. */
export function checkSettings(s: Settings): Settings | { error: string } {
  const out = { apiUrl: trimSlash(s.apiUrl), cognitoDomain: trimSlash(s.cognitoDomain), clientId: s.clientId.trim() };
  for (const [name, url] of [
    ['API address', out.apiUrl],
    ['Sign-in domain', out.cognitoDomain],
  ] as const) {
    let u: URL;
    try {
      u = new URL(url);
    } catch {
      return { error: `${name} must be a full web address, e.g. https://…` };
    }
    const local = u.hostname === 'localhost' || u.hostname === '127.0.0.1';
    if (u.protocol !== 'https:' && !(local && u.protocol === 'http:')) return { error: `${name} must use https (http only for localhost)` };
  }
  if (!/^[a-z0-9]{10,128}$/i.test(out.clientId)) return { error: 'Client ID looks wrong' };
  return out;
}

export async function loadSettings(): Promise<Settings> {
  const { settings } = await chrome.storage.local.get('settings');
  return { ...DEFAULT_SETTINGS, ...(settings as Partial<Settings> | undefined) };
}

export async function saveSettings(s: Settings): Promise<void> {
  await chrome.storage.local.set({ settings: s });
}
