import { createCipheriv, createDecipheriv, randomBytes } from 'crypto';

/**
 * AES-256-GCM with one server-side key: encrypts Gmail refresh tokens at rest,
 * and seals the OAuth `state` so it can be neither read (it carries the PKCE
 * verifier) nor forged (it names the user who started connecting).
 */
export class TokenCrypto {
  constructor(private readonly key: Buffer) {
    if (key.length !== 32) throw new Error('TokenCrypto needs a 32-byte key');
  }

  /** A key for this process only: anything sealed with it is unreadable after a restart. */
  static ephemeral(): TokenCrypto {
    return new TokenCrypto(randomBytes(32));
  }

  /** base64url( iv | tag | ciphertext ). */
  seal(plain: string): string {
    const iv = randomBytes(12);
    const cipher = createCipheriv('aes-256-gcm', this.key, iv);
    const body = Buffer.concat([cipher.update(plain, 'utf8'), cipher.final()]);
    return Buffer.concat([iv, cipher.getAuthTag(), body]).toString('base64url');
  }

  /** The plain text, or null if it was tampered with or sealed with another key. */
  open(sealed: string): string | null {
    try {
      const raw = Buffer.from(sealed, 'base64url');
      if (raw.length < 29) return null;
      const decipher = createDecipheriv('aes-256-gcm', this.key, raw.subarray(0, 12));
      decipher.setAuthTag(raw.subarray(12, 28));
      return Buffer.concat([decipher.update(raw.subarray(28)), decipher.final()]).toString('utf8');
    } catch {
      return null;
    }
  }
}

export interface ConnectState {
  userId: string;
  verifier: string;
  /** Epoch ms after which the state is refused. */
  exp: number;
}

export const STATE_TTL_MS = 10 * 60_000;

export function sealState(crypto: TokenCrypto, s: ConnectState): string {
  return crypto.seal(JSON.stringify(s));
}

/** The state if it's genuine and not expired; otherwise null. */
export function openState(crypto: TokenCrypto, sealed: string, now = Date.now()): ConnectState | null {
  const plain = crypto.open(sealed);
  if (!plain) return null;
  try {
    const s = JSON.parse(plain) as ConnectState;
    if (typeof s.userId !== 'string' || typeof s.verifier !== 'string' || typeof s.exp !== 'number' || s.exp < now) return null;
    return s;
  } catch {
    return null;
  }
}
