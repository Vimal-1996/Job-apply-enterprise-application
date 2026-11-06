import {
  BadRequestException,
  Controller,
  Get,
  Inject,
  Logger,
  NotFoundException,
  Param,
  Query,
} from '@nestjs/common';
import { AuthUser } from '../../auth/auth.types';
import { CurrentUser, Roles } from '../../auth/decorators';
import { RoleFilter, USER_DIRECTORY, UserDirectory } from './user.types';

const FILTERS: RoleFilter[] = ['all', 'admin', 'user'];
const USER_ID = /^[\w-]{1,128}$/; // Cognito usernames here are UUID subs
const TOKEN = /^[\w+/=.-]{1,4096}$/;

/** Admin-only user directory. The class-level @Roles applies to every route. */
@Controller('admin/users')
@Roles('admin')
export class UsersController {
  private readonly audit = new Logger('AdminAudit');

  constructor(@Inject(USER_DIRECTORY) private readonly directory: UserDirectory) {}

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
    if (!USER_ID.test(id)) throw new BadRequestException('Invalid user id');
    this.audit.log(`actor=${actor.id} action=users.get target=${id}`);
    const user = await this.directory.getUser(id);
    if (!user) throw new NotFoundException('User not found');
    return user;
  }
}
