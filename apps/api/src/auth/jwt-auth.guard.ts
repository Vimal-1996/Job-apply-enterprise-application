import {
  CanActivate,
  ExecutionContext,
  ForbiddenException,
  Inject,
  Injectable,
  Logger,
  ServiceUnavailableException,
  UnauthorizedException,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import {
  ACCOUNT_STATUS,
  AccountStatus,
  AccountStatusLookup,
  AuthUser,
  BLOCKED,
  Role,
  statusFromGroups,
  TOKEN_VERIFIER,
  TokenVerifier,
} from './auth.types';
import { IS_PUBLIC_KEY } from './decorators';

const KNOWN_ROLES: Role[] = ['admin', 'user'];

@Injectable()
export class JwtAuthGuard implements CanActivate {
  private readonly logger = new Logger(JwtAuthGuard.name);

  constructor(
    private readonly reflector: Reflector,
    @Inject(TOKEN_VERIFIER) private readonly verifier: TokenVerifier,
    @Inject(ACCOUNT_STATUS) private readonly accounts: AccountStatusLookup,
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

    let claims: Awaited<ReturnType<TokenVerifier['verify']>>;
    try {
      claims = await this.verifier.verify(match[1]);
    } catch {
      // Never leak why verification failed (expired, bad signature, wrong client...).
      throw new UnauthorizedException('Invalid or expired token');
    }

    // A valid token is not enough: the account may have been deactivated or
    // deleted since it was issued. Check the token's groups first (free), then
    // the live status. Fail closed if the status can't be determined.
    let status: AccountStatus = statusFromGroups(claims['cognito:groups'] ?? []);
    if (status === 'active') {
      try {
        status = await this.accounts.statusOf(claims.sub);
      } catch (e) {
        this.logger.error(`account status lookup failed for ${claims.sub}: ${(e as Error).message}`);
        throw new ServiceUnavailableException('Could not verify account status');
      }
    }
    if (status !== 'active') throw new ForbiddenException({ statusCode: 403, ...BLOCKED[status] });

    const user: AuthUser = {
      id: claims.sub,
      clientId: claims.client_id,
      groups: (claims['cognito:groups'] ?? []).filter((g): g is Role => KNOWN_ROLES.includes(g as Role)),
    };
    request.user = user;
    return true;
  }
}
