import { ExecutionContext, ForbiddenException } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { Roles } from './decorators';
import { RolesGuard } from './roles.guard';

function ctx(handler: Function, user?: { groups: string[] }): ExecutionContext {
  return {
    getHandler: () => handler,
    getClass: () => class {},
    switchToHttp: () => ({ getRequest: () => ({ user }) }),
  } as unknown as ExecutionContext;
}

describe('RolesGuard', () => {
  const guard = new RolesGuard(new Reflector());

  class C {
    @Roles('admin') adminOnly() {}
    open() {}
  }

  it('allows routes without role requirements', () => {
    expect(guard.canActivate(ctx(C.prototype.open, { groups: [] }))).toBe(true);
  });

  it('allows a user holding the required role', () => {
    expect(guard.canActivate(ctx(C.prototype.adminOnly, { groups: ['admin'] }))).toBe(true);
  });

  it('forbids a user without the required role', () => {
    expect(() => guard.canActivate(ctx(C.prototype.adminOnly, { groups: ['user'] }))).toThrow(ForbiddenException);
  });

  it('forbids when there is no user', () => {
    expect(() => guard.canActivate(ctx(C.prototype.adminOnly))).toThrow(ForbiddenException);
  });
});
