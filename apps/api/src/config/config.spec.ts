import { loadConfig } from './config';

describe('loadConfig', () => {
  it('fails fast when Cognito settings are missing', () => {
    expect(() => loadConfig({})).toThrow('COGNITO_USER_POOL_ID');
    expect(() => loadConfig({ COGNITO_USER_POOL_ID: 'p', COGNITO_CLIENT_ID: 'c' })).toThrow('DB_HOST');
  });

  it('parses settings and defaults', () => {
    const c = loadConfig({ COGNITO_USER_POOL_ID: 'p', COGNITO_CLIENT_ID: 'c', DATABASE_URL: 'memory', USER_FILES_BUCKET: 'b' });
    expect(c).toEqual({
      port: 3000,
      corsOrigins: ['http://localhost:5173'],
      basePath: '',
      trustProxyHops: 0,
      cognito: { userPoolId: 'p', clientId: 'c' },
      signup: { perIpPerHour: 5, perDay: 30 },
      database: { kind: 'memory' },
      userFiles: { bucket: 'b', region: 'p' },
      ai: { enabled: false, model: 'claude-opus-5-5', emailModel: 'claude-haiku-5-5' },
      gmail: { enabled: false, clientId: '', clientSecret: '', redirectUri: 'http://localhost:5173/gmail/callback', tokenKey: null },
    });
  });

  it('turns Gmail on only with a Google client, and checks the token key', () => {
    const base = { COGNITO_USER_POOL_ID: 'p', COGNITO_CLIENT_ID: 'c', DATABASE_URL: 'memory', USER_FILES_BUCKET: 'b' };
    const google = { ...base, GOOGLE_CLIENT_ID: 'id', GOOGLE_CLIENT_SECRET: 'secret', CORS_ORIGINS: 'https://app.example.com/' };
    expect(loadConfig({ ...base, GOOGLE_CLIENT_ID: 'id' }).gmail.enabled).toBe(false);
    expect(loadConfig(google).gmail).toMatchObject({ enabled: true, redirectUri: 'https://app.example.com/gmail/callback', tokenKey: null });
    const key = Buffer.alloc(32, 7).toString('base64');
    expect(loadConfig({ ...google, GMAIL_TOKEN_KEY: key }).gmail.tokenKey).toEqual(Buffer.alloc(32, 7));
    expect(() => loadConfig({ ...google, GMAIL_TOKEN_KEY: 'c2hvcnQ=' })).toThrow('32 bytes');
    expect(() => loadConfig({ ...google, NODE_ENV: 'production', DATABASE_URL: 'postgres://u:p@h/d' })).toThrow('GMAIL_TOKEN_KEY');
  });

  it('turns AI on only when an API key is set, and reads the model', () => {
    const base = { COGNITO_USER_POOL_ID: 'p', COGNITO_CLIENT_ID: 'c', DATABASE_URL: 'memory', USER_FILES_BUCKET: 'b' };
    expect(loadConfig({ ...base, ANTHROPIC_API_KEY: 'k' }).ai).toEqual({ enabled: true, model: 'claude-opus-5-5', emailModel: 'claude-haiku-5-5' });
    expect(loadConfig({ ...base, ANTHROPIC_API_KEY: 'k', AI_MODEL: 'claude-sonnet-5-5' }).ai.model).toBe('claude-sonnet-5-5');
  });

  it('reads sign-up limits, rejecting nonsense', () => {
    const base = { COGNITO_USER_POOL_ID: 'p', COGNITO_CLIENT_ID: 'c', DATABASE_URL: 'memory', USER_FILES_BUCKET: 'b' };
    expect(loadConfig({ ...base, SIGNUP_PER_IP_PER_HOUR: '2', SIGNUP_PER_DAY: '10' }).signup).toEqual({ perIpPerHour: 2, perDay: 10 });
    expect(() => loadConfig({ ...base, SIGNUP_PER_DAY: '0' })).toThrow('positive integer');
    expect(() => loadConfig({ ...base, SIGNUP_PER_IP_PER_HOUR: 'lots' })).toThrow('positive integer');
  });

  it('reads the base path and proxy hops', () => {
    const base = { COGNITO_USER_POOL_ID: 'p', COGNITO_CLIENT_ID: 'c', DATABASE_URL: 'memory', USER_FILES_BUCKET: 'b' };
    expect(loadConfig({ ...base, API_BASE_PATH: '/api/', TRUST_PROXY_HOPS: '2' })).toMatchObject({ basePath: 'api', trustProxyHops: 2 });
    expect(() => loadConfig({ ...base, API_BASE_PATH: '/a b' })).toThrow('Invalid API_BASE_PATH');
  });

  describe('database', () => {
    const base = { COGNITO_USER_POOL_ID: 'p', COGNITO_CLIENT_ID: 'c', USER_FILES_BUCKET: 'b' };

    it('reads discrete settings (as ECS supplies them), with TLS on by default', () => {
      const db = loadConfig({
        ...base,
        DB_HOST: 'db.internal',
        DB_NAME: 'jobapply',
        DB_USER: 'app',
        DB_PASSWORD: 'p@ss/word',
        DB_SSL_CA: '/app/certs/rds.pem',
      }).database;
      expect(db).toEqual({
        kind: 'postgres',
        host: 'db.internal',
        port: 5432,
        database: 'jobapply',
        user: 'app',
        password: 'p@ss/word',
        ssl: { caFile: '/app/certs/rds.pem' },
        poolSize: 10,
      });
    });

    it('reads a DATABASE_URL, decoding credentials', () => {
      const db = loadConfig({ ...base, DATABASE_URL: 'postgres://app:p%40ss@localhost:5433/jobapply', DB_SSL: 'disable' }).database;
      expect(db).toMatchObject({ host: 'localhost', port: 5433, database: 'jobapply', user: 'app', password: 'p@ss', ssl: false });
    });

    it('refuses the in-memory database in production', () => {
      expect(() => loadConfig({ ...base, DATABASE_URL: 'memory', NODE_ENV: 'production' })).toThrow('local development only');
    });
  });
});
