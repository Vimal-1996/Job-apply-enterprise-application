export interface AppConfig {
  port: number;
  corsOrigins: string[];
  cognito: { userPoolId: string; clientId: string };
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
  };
}

