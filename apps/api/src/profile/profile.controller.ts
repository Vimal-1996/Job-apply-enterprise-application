import { BadRequestException, Body, ConflictException, Controller, Get, HttpCode, Post, Put, Query, StreamableFile } from '@nestjs/common';
import { AuthUser } from '../auth/auth.types';
import { CurrentUser } from '../auth/decorators';
import { buildResumeDocx, parseLayout, resumeChecks, resumeFileName } from '../resume-doc/resume-docx';
import { attachmentDisposition } from '../resumes/resume-files';
import { ProfileService } from './profile.service';

const DOCX = 'application/vnd.openxmlformats-officedocument.wordprocessingml.document';

/** The signed-in user's own candidate profile and job preferences. */
@Controller()
export class ProfileController {
  constructor(private readonly profiles: ProfileService) {}

  @Get('profile')
  async get(@CurrentUser() user: AuthUser) {
    // Usually already started at sign-in; waiting here means the page shows "reading", not "no profile".
    await this.profiles.readIfMissing(user.id).catch(() => false);
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

  /** The profile as an ATS-friendly Word resume. `?layout=workday` for Workday's resume autofill. */
  @Get('profile/document')
  async document(@CurrentUser() user: AuthUser, @Query('layout') layoutParam?: string) {
    const layout = parseLayout(layoutParam);
    if (!layout) throw new BadRequestException('layout must be standard or workday');
    const { profile } = await this.profiles.get(user.id);
    if (!profile) throw new ConflictException('Set up your profile first: upload your resume, or fill in your profile by hand');
    const bytes = await buildResumeDocx(profile, layout);
    return new StreamableFile(bytes, { type: DOCX, disposition: attachmentDisposition(resumeFileName(profile.fullName, null)), length: bytes.length });
  }

  /** What the profile is missing that Workday and other ATS ask for. */
  @Get('profile/resume-checks')
  async checks(@CurrentUser() user: AuthUser) {
    const { profile } = await this.profiles.get(user.id);
    return profile ? resumeChecks(profile) : [];
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
