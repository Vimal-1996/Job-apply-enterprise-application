import { Controller, Get, Logger } from '@nestjs/common';
import { AuthUser } from '../auth/auth.types';
import { CurrentUser } from '../auth/decorators';
import { ProfileService } from '../profile/profile.service';

@Controller('me')
export class MeController {
  private readonly logger = new Logger(MeController.name);

  constructor(private readonly profiles: ProfileService) {}

  /** Any authenticated user. The web app calls this once per sign-in. */
  @Get()
  me(@CurrentUser() user: AuthUser) {
    // A user with a resume but no profile gets it read now, without waiting for it.
    this.profiles.readIfMissing(user.id).catch((e) => this.logger.warn(`Couldn't start reading the resume: ${(e as Error).message}`));
    return { id: user.id, groups: user.groups };
  }
}
