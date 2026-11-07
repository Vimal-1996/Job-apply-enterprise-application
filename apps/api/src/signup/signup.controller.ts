import { Body, Controller, HttpCode, HttpException, HttpStatus, Inject, Ip, Logger, Post } from '@nestjs/common';
import { Public } from '../auth/decorators';
import { parseEmail } from '../common/email';
import { USER_DIRECTORY, UserDirectory, UserExistsError } from '../admin/users/user.types';
import { WindowCounter } from './rate-limiter';

export const SIGNUP_LIMITS = Symbol('SIGNUP_LIMITS');
export interface SignupLimits {
  perIp: WindowCounter;
  global: WindowCounter;
}

/** Same reply whether or not an account was created, so the endpoint can't be used to probe emails. */
export const SIGNUP_ACCEPTED = {
  message:
    "Thanks! If this email can be used to sign up, we've sent it a temporary password. Check your inbox (and spam folder), then sign in.",
};

/** a***@example.com: enough to correlate logs, not enough to harvest addresses. */
export function maskEmail(email: string): string {
  const [local, domain] = email.split('@');
  return `${local[0]}***@${domain}`;
}

/**
 * Public self sign-up. Creates the account the same way an admin's "Add user"
 * does: the user role, and Cognito emails a temporary password (the API never
 * sees it). The pool keeps admin-only sign-up switched on, so this endpoint is
 * the only self-service way in, and it's rate limited.
 */
@Controller('signup')
export class SignupController {
  private readonly audit = new Logger('Signup');

  constructor(
    @Inject(USER_DIRECTORY) private readonly directory: UserDirectory,
    @Inject(SIGNUP_LIMITS) private readonly limits: SignupLimits,
  ) {}

  @Public()
  @Post()
  @HttpCode(HttpStatus.ACCEPTED)
  async signup(@Ip() ip: string, @Body() body: unknown) {
    const email = parseEmail(body);
    // Per-IP first, so one client hammering can't use up everyone's daily quota.
    if (!this.limits.perIp.take(ip ?? 'unknown') || !this.limits.global.take('all')) {
      this.audit.warn(`rate limited ip=${ip}`);
      throw new HttpException(
        { statusCode: 429, message: 'Too many sign-up requests. Please try again later.' },
        HttpStatus.TOO_MANY_REQUESTS,
      );
    }

    try {
      const user = await this.directory.createUser(email);
      this.audit.log(`created target=${user.id} email=${maskEmail(email)} ip=${ip}`);
    } catch (e) {
      if (!(e instanceof UserExistsError)) throw e;
      await this.existing(email, ip);
    }
    return SIGNUP_ACCEPTED;
  }

  /**
   * The email already has an account. The reply is the same either way. If
   * they never finished signing up (temporary password unused, maybe expired),
   * send a fresh one, which only reaches the address owner. Otherwise send
   * nothing: a signed-in user should sign in, and a deactivated or deleted
   * user is told to contact an admin when they do.
   */
  private async existing(email: string, ip: string) {
    const user = await this.directory.getUser(email); // the pool accepts the email as username
    if (user && user.accountStatus === 'active' && user.status === 'FORCE_CHANGE_PASSWORD') {
      await this.directory.resendInvite(user.id);
      this.audit.log(`resent target=${user.id} email=${maskEmail(email)} ip=${ip}`);
    } else {
      this.audit.log(`exists target=${user?.id ?? '?'} status=${user?.accountStatus ?? '?'} ip=${ip}`);
    }
  }
}
