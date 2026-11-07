export interface AppConfig {
  port: number;
  corsOrigins: string[];
  cognito: { userPoolId: string; clientId: string };
  /** Public sign-up sends email, so it is rate limited. Cognito's default sender allows 50 emails/day. */
  signup: { perIpPerHour: number; perDay: number };
  database: DatabaseConfig;
}

/**
 * `memory` runs an in-memory Postgres (local development and tests only).
 * Otherwise a real connection: TLS is on unless DB_SSL=disable, verified
 * against DB_SSL_CA (the AWS RDS bundle in the image) when given.
 */
export type DatabaseConfig =
  | { kind: 'memory' }
  | {
      kind: 'postgres';
      host: string;
      port: number;
      database: string;
      user: string;
      password: string;
      ssl: false | { caFile?: string };
      poolSize: number;
    };


function positiveInt(raw: string | undefined, fallback: number): number {
  if (raw === undefined || raw === '') return fallback;
  const n = Number(raw);
  if (!Number.isInteger(n) || n < 1) throw new Error(`Expected a positive integer, got ${raw}`);
  return n;
}

function loadDatabase(env: NodeJS.ProcessEnv, get: (n: string) => string): DatabaseConfig {
  const ssl = (env.DB_SSL ?? 'require') === 'disable' ? false : { caFile: env.DB_SSL_CA || undefined };
  const poolSize = positiveInt(env.DB_POOL_SIZE, 10);
  const url = env.DATABASE_URL;
  if (url === 'memory') {
    if (env.NODE_ENV === 'production') throw new Error('DATABASE_URL=memory is for local development only');
    return { kind: 'memory' };
  }
  if (url) {
    const u = new URL(url);
    return {
      kind: 'postgres',
      host: u.hostname,
      port: Number(u.port || 5432),
      database: decodeURIComponent(u.pathname.slice(1)),
      user: decodeURIComponent(u.username),
      password: decodeURIComponent(u.password),
      ssl,
      poolSize,
    };
  }
  // Discrete settings: how ECS supplies them (password injected from Secrets Manager).
  return {
    kind: 'postgres',
    host: get('DB_HOST'),
    port: Number(env.DB_PORT ?? 5432),
    database: get('DB_NAME'),
    user: get('DB_USER'),
    password: get('DB_PASSWORD'),
    ssl,
    poolSize,
  };
}

/** Fails fast at startup if auth or the database is not configured. */
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
    database: loadDatabase(env, get),
  };
}

