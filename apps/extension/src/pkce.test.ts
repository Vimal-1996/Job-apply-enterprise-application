import { describe, expect, it } from 'vitest';
import { base64url, challengeFor, emailFromIdToken, randomString } from './pkce';
import { checkSettings } from './config';

describe('pkce', () => {
  it('matches the RFC 7636 example', async () => {
    expect(await challengeFor('dBjftJeZ4CVP-mB92K27uhbUJU1p1r_wW1gFWFOEjXk')).toBe('E9Melhoa2OwvFrEMTJguCHaoeK1t8URWbuGJSstw-cM');
  });
  it('makes url-safe random strings', () => {
    expect(randomString(48)).toMatch(/^[A-Za-z0-9_-]{64}$/);
    expect(base64url(new Uint8Array([251, 255]))).toBe('-_8');
  });
  it('reads the email from an ID token, or gives null', () => {
    const payload = btoa(JSON.stringify({ email: 'jane@example.com' })).replace(/=+$/, '');
    expect(emailFromIdToken(`h.${payload}.s`)).toBe('jane@example.com');
    expect(emailFromIdToken('garbage')).toBeNull();
    expect(emailFromIdToken(undefined)).toBeNull();
  });
});

describe('checkSettings', () => {
  const ok = { apiUrl: 'https://abc.cloudfront.net/api/', cognitoDomain: 'https://x.auth.us-east-1.amazoncognito.com', clientId: '2vvuu6ucikoeidtdc6sl4kapl1' };
  it('tidies good settings', () => {
    expect(checkSettings(ok)).toEqual({ ...ok, apiUrl: 'https://abc.cloudfront.net/api' });
    expect(checkSettings({ ...ok, apiUrl: 'http://localhost:3000' })).toHaveProperty('apiUrl', 'http://localhost:3000');
  });
  it('rejects http (except localhost), bad addresses and client ids', () => {
    expect(checkSettings({ ...ok, apiUrl: 'http://abc.cloudfront.net' })).toHaveProperty('error');
    expect(checkSettings({ ...ok, cognitoDomain: 'not a url' })).toHaveProperty('error');
    expect(checkSettings({ ...ok, clientId: 'x' })).toHaveProperty('error');
  });
});
