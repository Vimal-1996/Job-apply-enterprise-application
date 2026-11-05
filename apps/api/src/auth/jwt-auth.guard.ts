import { CanActivate, ExecutionContext, Inject, Injectable, UnauthorizedException } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { AuthUser, Role, TOKEN_VERIFIER, TokenVerifier } from './auth.types';
import { IS_PUBLIC_KEY } from './decorators';

const KNOWN_ROLES: Role[] = ['admin', 'user'];

@Injectable()
export class JwtAuthGuard implements CanActivate {
  constructor(
    private readonly reflector: Reflector,
    @Inject(TOKEN_VERIFIER) private readonly verifier: TokenVerifier,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const isPublic = this.reflector.getAllAndOverride<boolean>(IS_PUBLIC_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);
    if (isPublic) return true;

    const request = context.switchToHttp().getRequest();
    const header: string | undefined = request.headers['authorization'];
    const match = header?.match(/^Bearer (.+)$/i);
    if (!match) throw new UnauthorizedException('Missing bearer token');

    try {
      const claims = await this.verifier.verify(match[1]);
      const user: AuthUser = {
        id: claims.sub,
        clientId: claims.client_id,
        groups: (claims['cognito:groups'] ?? []).filter((g): g is Role => KNOWN_ROLES.includes(g as Role)),
      };
      request.user = user;
      return true;
    } catch {
      // Never leak why verification failed (expired, bad signature, wrong client...).
      throw new UnauthorizedException('Invalid or expired token');
    }
  }
}
