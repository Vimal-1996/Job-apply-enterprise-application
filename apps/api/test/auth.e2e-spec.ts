import { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { AppModule } from '../src/app.module';
import { TOKEN_VERIFIER } from '../src/auth/auth.types';

// Fake tokens: the fake verifier maps a token string to claims, and rejects the rest.
const TOKENS: Record<string, { sub: string; client_id: string; 'cognito:groups'?: string[] }> = {
  'admin-token': { sub: 'u-admin', client_id: 'c', 'cognito:groups': ['admin'] },
  'user-token': { sub: 'u-user', client_id: 'c', 'cognito:groups': ['user'] },
  'nogroup-token': { sub: 'u-none', client_id: 'c' },
};

describe('auth (e2e)', () => {
  let app: INestApplication;

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] })
      .overrideProvider(TOKEN_VERIFIER)
      .useValue({
        verify: async (t: string) => {
          if (!TOKENS[t]) throw new Error('bad token');
          return TOKENS[t];
        },
      })
      .compile();
    app = moduleRef.createNestApplication();
    await app.init();
  });

  afterAll(() => app.close());

  it('GET /health is public', () => request(app.getHttpServer()).get('/health').expect(200));

  it('rejects requests with no token (401)', () => request(app.getHttpServer()).get('/me').expect(401));

  it('rejects an invalid token (401)', () =>
    request(app.getHttpServer()).get('/me').set('Authorization', 'Bearer nope').expect(401));

  it('rejects a non-bearer scheme (401)', () =>
    request(app.getHttpServer()).get('/me').set('Authorization', 'Basic abc').expect(401));

  it('returns the caller on GET /me', async () => {
    const res = await request(app.getHttpServer()).get('/me').set('Authorization', 'Bearer user-token').expect(200);
    expect(res.body).toEqual({ id: 'u-user', groups: ['user'] });
  });

  it('forbids a normal user from /admin/ping (403)', () =>
    request(app.getHttpServer()).get('/admin/ping').set('Authorization', 'Bearer user-token').expect(403));

  it('forbids a user with no groups from /admin/ping (403)', () =>
    request(app.getHttpServer()).get('/admin/ping').set('Authorization', 'Bearer nogroup-token').expect(403));

  it('allows an admin on /admin/ping (200)', () =>
    request(app.getHttpServer()).get('/admin/ping').set('Authorization', 'Bearer admin-token').expect(200));

  it('requires authentication before authorization on /admin/ping (401, not 403)', () =>
    request(app.getHttpServer()).get('/admin/ping').expect(401));
});
