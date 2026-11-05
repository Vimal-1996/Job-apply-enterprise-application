import { CanActivate, ExecutionContext, ForbiddenException, Injectable } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { AuthUser, Role } from './auth.types';
import { ROLES_KEY } from './decorators';

@Injectable()
export class RolesGuard implements CanActivate {
  constructor(private readonly reflector: Reflector) {}

  canActivate(context: ExecutionContext): boolean {
    const required = this.reflector.getAllAndOverride<Role[] | undefined>(ROLES_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);
    if (!required || required.length === 0) return true; // authenticated is enough

    const user: AuthUser | undefined = context.switchToHttp().getRequest().user;
    if (user && required.some((r) => user.groups.includes(r))) return true;
    throw new ForbiddenException('Insufficient permissions');
  }
}
