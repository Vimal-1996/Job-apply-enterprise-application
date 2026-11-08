import { BadRequestException, Body, Controller, Delete, Get, HttpCode, Param, Post } from '@nestjs/common';
import { AuthUser } from '../auth/auth.types';
import { CurrentUser } from '../auth/decorators';
import { parseUploadRequest, ResumesService } from './resumes.service';

const ID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

function resumeId(id: string): string {
  if (!ID.test(id)) throw new BadRequestException('Invalid resume id');
  return id;
}

/** The signed-in user's own resumes. Every route acts only on the caller's files. */
@Controller('resumes')
export class ResumesController {
  constructor(private readonly resumes: ResumesService) {}

  @Get()
  list(@CurrentUser() user: AuthUser) {
    return this.resumes.list(user.id);
  }

  /** Step 1: describe the file; get a short-lived link to upload it straight to storage. */
  @Post('uploads')
  requestUpload(@CurrentUser() user: AuthUser, @Body() body: unknown) {
    return this.resumes.requestUpload(user.id, parseUploadRequest(body));
  }

  /** Step 2: after uploading, ask the API to verify the file and make it current. */
  @Post(':id/complete')
  @HttpCode(200)
  complete(@CurrentUser() user: AuthUser, @Param('id') id: string) {
    return this.resumes.complete(user.id, resumeId(id));
  }

  @Get(':id/download')
  download(@CurrentUser() user: AuthUser, @Param('id') id: string) {
    return this.resumes.downloadLink(user.id, resumeId(id));
  }

  @Post(':id/current')
  @HttpCode(200)
  makeCurrent(@CurrentUser() user: AuthUser, @Param('id') id: string) {
    return this.resumes.makeCurrent(user.id, resumeId(id));
  }

  @Delete(':id')
  @HttpCode(204)
  async remove(@CurrentUser() user: AuthUser, @Param('id') id: string) {
    await this.resumes.delete(user.id, resumeId(id));
  }
}
