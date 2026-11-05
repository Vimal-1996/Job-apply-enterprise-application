import { loadConfig } from './config';

describe('loadConfig', () => {
  it('fails fast when Cognito settings are missing', () => {
    expect(() => loadConfig({})).toThrow('COGNITO_USER_POOL_ID');
  });

  it('parses settings and defaults', () => {
    const c = loadConfig({ COGNITO_USER_POOL_ID: 'p', COGNITO_CLIENT_ID: 'c' });
    expect(c).toEqual({
      port: 3000,
      corsOrigins: ['http://localhost:5173'],
      cognito: { userPoolId: 'p', clientId: 'c' },
    });
  });
});
