import {
  CanActivate,
  ExecutionContext,
  ForbiddenException,
  Inject,
  Injectable,
  Logger,
  ServiceUnavailableException,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { AuthUser, MFA_LOOKUP, MFA_REQUIRED, MfaLookup, Role } from './auth.types';
import { ROLES_KEY } from './decorators';

/** Roles whose access also requires MFA on the account. */
const MFA_ROLES: Role[] = ['admin'];

@Injectable()
export class RolesGuard implements CanActivate {
  private readonly logger = new Logger(RolesGuard.name);

  constructor(
    private readonly reflector: Reflector,
    @Inject(MFA_LOOKUP) private readonly mfa: MfaLookup,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const required = this.reflector.getAllAndOverride<Role[] | undefined>(ROLES_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);
    if (!required || required.length === 0) return true; // authenticated is enough

    const user: AuthUser | undefined = context.switchToHttp().getRequest().user;
    const granted = required.filter((r) => user?.groups.includes(r));
    if (!user || granted.length === 0) throw new ForbiddenException('Insufficient permissions');

    // Normal users sign in with a password only. Admin access additionally
    // needs MFA on the account: then Cognito challenges every admin sign-in.
    // The token doesn't say how the user signed in, so check the account.
    if (granted.every((r) => MFA_ROLES.includes(r))) {
      let enabled: boolean;
      try {
        enabled = await this.mfa.mfaEnabled(user.id);
      } catch (e) {
        this.logger.error(`MFA lookup failed for ${user.id}: ${(e as Error).message}`);
        throw new ServiceUnavailableException('Could not verify MFA status');
      }
      if (!enabled) throw new ForbiddenException({ statusCode: 403, ...MFA_REQUIRED });
    }
    return true;
  }
}
