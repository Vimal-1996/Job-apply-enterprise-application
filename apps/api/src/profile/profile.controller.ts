import { Body, ConflictException, Controller, Get, HttpCode, Post, Put, Query, StreamableFile } from '@nestjs/common';
import { AuthUser } from '../auth/auth.types';
import { CurrentUser } from '../auth/decorators';
import { resumeChecks, resumeFileName } from '../resume-doc/resume-docx';
import { buildResumeFile, CONTENT_TYPES, parseResumeQuery } from '../resume-doc/resume-file';
import { attachmentDisposition } from '../resumes/resume-files';
import { ProfileService } from './profile.service';

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

  /** The profile as an ATS-friendly resume. `?format=pdf` for a PDF (Word by default). */
  @Get('profile/document')
  async document(@CurrentUser() user: AuthUser, @Query('layout') layoutParam?: string, @Query('format') formatParam?: string) {
    const { layout, format } = parseResumeQuery(layoutParam, formatParam);
    const { profile } = await this.profiles.get(user.id);
    if (!profile) throw new ConflictException('Set up your profile first: upload your resume, or fill in your profile by hand');
    const bytes = await buildResumeFile(profile, layout, format);
    return new StreamableFile(bytes, { type: CONTENT_TYPES[format], disposition: attachmentDisposition(resumeFileName(profile.fullName, null, format)), length: bytes.length });
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
