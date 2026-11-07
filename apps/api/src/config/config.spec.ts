import { loadConfig } from './config';

describe('loadConfig', () => {
  it('fails fast when Cognito settings are missing', () => {
    expect(() => loadConfig({})).toThrow('COGNITO_USER_POOL_ID');
    expect(() => loadConfig({ COGNITO_USER_POOL_ID: 'p', COGNITO_CLIENT_ID: 'c' })).toThrow('DB_HOST');
  });

  it('parses settings and defaults', () => {
    const c = loadConfig({ COGNITO_USER_POOL_ID: 'p', COGNITO_CLIENT_ID: 'c', DATABASE_URL: 'memory' });
    expect(c).toEqual({
      port: 3000,
      corsOrigins: ['http://localhost:5173'],
      cognito: { userPoolId: 'p', clientId: 'c' },
      signup: { perIpPerHour: 5, perDay: 30 },
      database: { kind: 'memory' },
    });
  });

  it('reads sign-up limits, rejecting nonsense', () => {
    const base = { COGNITO_USER_POOL_ID: 'p', COGNITO_CLIENT_ID: 'c', DATABASE_URL: 'memory' };
    expect(loadConfig({ ...base, SIGNUP_PER_IP_PER_HOUR: '2', SIGNUP_PER_DAY: '10' }).signup).toEqual({ perIpPerHour: 2, perDay: 10 });
    expect(() => loadConfig({ ...base, SIGNUP_PER_DAY: '0' })).toThrow('positive integer');
    expect(() => loadConfig({ ...base, SIGNUP_PER_IP_PER_HOUR: 'lots' })).toThrow('positive integer');
  });

  describe('database', () => {
    const base = { COGNITO_USER_POOL_ID: 'p', COGNITO_CLIENT_ID: 'c' };

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
