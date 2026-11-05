import { Controller, Get } from '@nestjs/common';
import { AuthUser } from '../auth/auth.types';
import { CurrentUser } from '../auth/decorators';

@Controller('me')
export class MeController {
  /** Any authenticated user. */
  @Get()
  me(@CurrentUser() user: AuthUser) {
    return { id: user.id, groups: user.groups };
  }
}
