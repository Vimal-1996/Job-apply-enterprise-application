export interface AppConfig {
  port: number;
  corsOrigins: string[];
  cognito: { userPoolId: string; clientId: string };
  /** Public sign-up sends email, so it is rate limited. Cognito's default sender allows 50 emails/day. */
  signup: { perIpPerHour: number; perDay: number };
}


function positiveInt(raw: string | undefined, fallback: number): number {
  if (raw === undefined || raw === '') return fallback;
  const n = Number(raw);
  if (!Number.isInteger(n) || n < 1) throw new Error(`Expected a positive integer, got ${raw}`);
  return n;
}

/** Fails fast at startup if auth is not configured. */
export function loadConfig(env: NodeJS.ProcessEnv = process.env): AppConfig {
  const get = (n: string) => {
    const v = env[n];
    if (!v) throw new Error(`Missing required environment variable ${n}`);
    return v;
  };
  return {
    port: Number(env.PORT ?? 3000),
    corsOrigins: (env.CORS_ORIGINS ?? 'http://localhost:5173')
      .split(',')
      .map((o) => o.trim())
      .filter(Boolean),
    cognito: { userPoolId: get('COGNITO_USER_POOL_ID'), clientId: get('COGNITO_CLIENT_ID') },
    signup: {
      perIpPerHour: positiveInt(env.SIGNUP_PER_IP_PER_HOUR, 5),
      perDay: positiveInt(env.SIGNUP_PER_DAY, 30),
    },
  };
}

