import { Body, ConflictException, Controller, HttpCode, HttpException, HttpStatus, Inject, Ip, Logger, Post } from '@nestjs/common';
import { Public } from '../auth/decorators';
import { parseEmail } from '../common/email';
import { createFreshAccount, ExistingAccountError, isAdmin } from '../admin/users/create-account';
import { USER_DIRECTORY, UserDirectory, UserExistsError } from '../admin/users/user.types';
import { WindowCounter } from './rate-limiter';

export const SIGNUP_LIMITS = Symbol('SIGNUP_LIMITS');
export interface SignupLimits {
  perIp: WindowCounter;
  global: WindowCounter;
}

/** A temporary password was emailed: a new account, a deleted one started fresh, or an unfinished sign-up. */
export const SIGNUP_ACCEPTED = {
  message: "Thanks! We've sent a temporary password to your email. Check your inbox (and spam folder), then sign in.",
};

/**
 * The email already has a live account. Deliberately the same for every role
 * and status: sign-up is public, so naming the role would let anyone find out
 * which emails are administrators.
 */
export const EMAIL_IN_USE = {
  statusCode: 409,
  code: 'EMAIL_IN_USE',
  message: 'This email already has an account. Sign in instead.',
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
      // A deleted account is replaced by a fresh one (new temporary password).
      const user = await createFreshAccount(this.directory, email);
      this.audit.log(`created target=${user.id} email=${maskEmail(email)} ip=${ip}`);
    } catch (e) {
      if (!(e instanceof UserExistsError)) throw e;
      await this.existing(email, ip, (e as ExistingAccountError).existing ?? null);
    }
    return SIGNUP_ACCEPTED;
  }

  /**
   * The email already has a live account (deleted ones were replaced above),
   * or belongs to an administrator.
   * - A normal user who never finished signing up (temporary password unused,
   *   maybe expired) gets a fresh one, which only reaches the address owner.
   * - Everyone else (signed-in or deactivated users, and every admin) gets
   *   409 EMAIL_IN_USE straight away and nothing is sent. Admin accounts are
   *   never touched from public sign-up, and the reply never names the role.
   */
  private async existing(email: string, ip: string, user: Awaited<ReturnType<UserDirectory['getUser']>>) {
    if (user && isAdmin(user)) {
      this.audit.warn(`admin email used for sign-up target=${user.id} ip=${ip}; nothing sent`);
      throw new ConflictException(EMAIL_IN_USE);
    }
    if (user && user.accountStatus === 'active' && user.status === 'FORCE_CHANGE_PASSWORD') {
      await this.directory.resendInvite(user.id);
      this.audit.log(`resent target=${user.id} email=${maskEmail(email)} ip=${ip}`);
      return;
    }
    this.audit.log(`exists target=${user?.id ?? '?'} status=${user?.accountStatus ?? '?'} ip=${ip}`);
    throw new ConflictException(EMAIL_IN_USE);
  }
}
