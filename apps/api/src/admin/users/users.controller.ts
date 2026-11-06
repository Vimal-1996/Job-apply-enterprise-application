import {
  BadRequestException,
  ConflictException,
  Controller,
  Delete,
  ForbiddenException,
  Get,
  HttpCode,
  Inject,
  Logger,
  NotFoundException,
  Param,
  Post,
  Query,
} from '@nestjs/common';
import { AccountStatusCache } from '../../auth/account-status-cache';
import { ACCOUNT_STATUS, AccountStatus, AuthUser } from '../../auth/auth.types';
import { CurrentUser, Roles } from '../../auth/decorators';
import { RoleFilter, USER_DIRECTORY, UserDetail, UserDirectory } from './user.types';

const FILTERS: RoleFilter[] = ['all', 'admin', 'user'];
const USER_ID = /^[\w-]{1,128}$/; // Cognito usernames here are UUID subs (or Google_<id>)
const TOKEN = /^[\w+/=.-]{1,4096}$/;

/** Which status each action moves to, and which statuses it may start from. */
const TRANSITIONS: Record<string, { to: AccountStatus; from: AccountStatus[] }> = {
  deactivate: { to: 'inactive', from: ['active'] },
  reactivate: { to: 'active', from: ['inactive'] },
  delete: { to: 'deleted', from: ['active', 'inactive'] },
};

/** Admin-only user directory. The class-level @Roles applies to every route. */
@Controller('admin/users')
@Roles('admin')
export class UsersController {
  private readonly audit = new Logger('AdminAudit');

  constructor(
    @Inject(USER_DIRECTORY) private readonly directory: UserDirectory,
    @Inject(ACCOUNT_STATUS) private readonly statusCache: Pick<AccountStatusCache, 'invalidate'>,
  ) {}

  @Get()
  async list(
    @CurrentUser() actor: AuthUser,
    @Query('filter') filter = 'all',
    @Query('nextToken') nextToken?: string,
  ) {
    if (!FILTERS.includes(filter as RoleFilter)) throw new BadRequestException(`filter must be one of ${FILTERS.join(', ')}`);
    if (nextToken !== undefined && !TOKEN.test(nextToken)) throw new BadRequestException('Invalid nextToken');
    this.audit.log(`actor=${actor.id} action=users.list filter=${filter}`);
    return this.directory.listUsers({ filter: filter as RoleFilter, nextToken });
  }

  @Get(':id')
  async get(@CurrentUser() actor: AuthUser, @Param('id') id: string) {
    this.audit.log(`actor=${actor.id} action=users.get target=${id}`);
    return this.find(id);
  }

  @Post(':id/deactivate')
  @HttpCode(200)
  deactivate(@CurrentUser() actor: AuthUser, @Param('id') id: string) {
    return this.change(actor, id, 'deactivate');
  }

  @Post(':id/reactivate')
  @HttpCode(200)
  reactivate(@CurrentUser() actor: AuthUser, @Param('id') id: string) {
    return this.change(actor, id, 'reactivate');
  }

  /** Soft delete: the account is kept (marked deleted) so a returning user is told to contact an admin. */
  @Delete(':id')
  remove(@CurrentUser() actor: AuthUser, @Param('id') id: string) {
    return this.change(actor, id, 'delete');
  }

  private async find(id: string): Promise<UserDetail> {
    if (!USER_ID.test(id)) throw new BadRequestException('Invalid user id');
    const user = await this.directory.getUser(id);
    if (!user) throw new NotFoundException('User not found');
    return user;
  }

  private async change(actor: AuthUser, id: string, action: keyof typeof TRANSITIONS): Promise<UserDetail> {
    const target = await this.find(id);
    // Admins can't be deactivated or deleted from here (this also stops an admin
    // locking themselves out). Remove the admin role in Cognito first if needed.
    if (target.id === actor.id || target.groups.includes('admin')) {
      throw new ForbiddenException('Administrators cannot be deactivated or deleted');
    }
    const { to, from } = TRANSITIONS[action];
    if (target.accountStatus === to) return target; // idempotent
    if (!from.includes(target.accountStatus)) {
      throw new ConflictException(`Cannot ${action} a user who is ${target.accountStatus}`);
    }

    await this.directory.setStatus(id, to);
    this.statusCache.invalidate(id);
    this.audit.log(`actor=${actor.id} action=users.${action} target=${id} from=${target.accountStatus} to=${to}`);
    return { ...target, accountStatus: to };
  }
}
