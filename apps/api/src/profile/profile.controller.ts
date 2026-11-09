import { Body, Controller, Get, HttpCode, Post, Put } from '@nestjs/common';
import { AuthUser } from '../auth/auth.types';
import { CurrentUser } from '../auth/decorators';
import { ProfileService } from './profile.service';

/** The signed-in user's own candidate profile and job preferences. */
@Controller()
export class ProfileController {
  constructor(private readonly profiles: ProfileService) {}

  @Get('profile')
  get(@CurrentUser() user: AuthUser) {
    return this.profiles.get(user.id);
  }

  /** Saves the user's edits to their profile. */
  @Put('profile')
  update(@CurrentUser() user: AuthUser, @Body() body: unknown) {
    return this.profiles.update(user.id, body);
  }

  /** Reads the current resume into the profile again (replacing it). Returns at once; poll GET /profile. */
  @Post('profile/parse')
  @HttpCode(202)
  parse(@CurrentUser() user: AuthUser) {
    return this.profiles.parseCurrentResume(user.id);
  }

  @Get('preferences')
  getPreferences(@CurrentUser() user: AuthUser) {
    return this.profiles.getPreferences(user.id);
  }

  @Put('preferences')
  updatePreferences(@CurrentUser() user: AuthUser, @Body() body: unknown) {
    return this.profiles.updatePreferences(user.id, body);
  }
}
