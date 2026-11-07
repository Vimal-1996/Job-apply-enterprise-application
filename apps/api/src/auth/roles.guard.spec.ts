import { ExecutionContext, ForbiddenException, ServiceUnavailableException } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { Roles } from './decorators';
import { RolesGuard } from './roles.guard';

function ctx(handler: Function, user?: { id?: string; groups: string[] }): ExecutionContext {
  return {
    getHandler: () => handler,
    getClass: () => class {},
    switchToHttp: () => ({ getRequest: () => ({ user: user && { id: 'u1', ...user } }) }),
  } as unknown as ExecutionContext;
}

describe('RolesGuard', () => {
  const mfa = { mfaEnabled: jest.fn(async () => true) };
  const guard = new RolesGuard(new Reflector(), mfa);

  class C {
    @Roles('admin') adminOnly() {}
    @Roles('user') userOnly() {}
    @Roles('admin', 'user') either() {}
    open() {}
  }

  beforeEach(() => {
    mfa.mfaEnabled.mockReset();
    mfa.mfaEnabled.mockResolvedValue(true);
  });

  it('allows routes without role requirements', async () => {
    await expect(guard.canActivate(ctx(C.prototype.open, { groups: [] }))).resolves.toBe(true);
  });

  it('allows an admin who has MFA', async () => {
    await expect(guard.canActivate(ctx(C.prototype.adminOnly, { groups: ['admin'] }))).resolves.toBe(true);
    expect(mfa.mfaEnabled).toHaveBeenCalledWith('u1');
  });

  it('refuses an admin without MFA, with a code the web app recognises', async () => {
    mfa.mfaEnabled.mockResolvedValue(false);
    const err = await guard.canActivate(ctx(C.prototype.adminOnly, { groups: ['admin'] })).catch((e) => e);
    expect(err).toBeInstanceOf(ForbiddenException);
    expect(err.getResponse()).toMatchObject({ code: 'MFA_REQUIRED' });
  });

  it('fails closed if MFA status cannot be read', async () => {
    mfa.mfaEnabled.mockRejectedValue(new Error('aws down'));
    await expect(guard.canActivate(ctx(C.prototype.adminOnly, { groups: ['admin'] }))).rejects.toThrow(
      ServiceUnavailableException,
    );
  });

  it('does not require MFA for normal-user routes', async () => {
    await expect(guard.canActivate(ctx(C.prototype.userOnly, { groups: ['user'] }))).resolves.toBe(true);
    await expect(guard.canActivate(ctx(C.prototype.either, { groups: ['user'] }))).resolves.toBe(true);
    await expect(guard.canActivate(ctx(C.prototype.either, { groups: ['admin', 'user'] }))).resolves.toBe(true);
    expect(mfa.mfaEnabled).not.toHaveBeenCalled();
  });

  it('forbids a user without the required role', async () => {
    await expect(guard.canActivate(ctx(C.prototype.adminOnly, { groups: ['user'] }))).rejects.toThrow(ForbiddenException);
    expect(mfa.mfaEnabled).not.toHaveBeenCalled();
  });

  it('forbids when there is no user', async () => {
    await expect(guard.canActivate(ctx(C.prototype.adminOnly))).rejects.toThrow(ForbiddenException);
  });
});
