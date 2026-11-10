import { BadRequestException, Body, Controller, Get, HttpCode, Param, Patch, Post, Query, StreamableFile } from '@nestjs/common';
import { AuthUser } from '../auth/auth.types';
import { CurrentUser } from '../auth/decorators';
import { parseLayout } from '../resume-doc/resume-docx';
import { attachmentDisposition } from '../resumes/resume-files';
import { parseDecisions } from './tailoring.schema';
import { TailoringService } from './tailoring.service';

const ID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

function jobId(id: string): string {
  if (!ID.test(id)) throw new BadRequestException('Invalid job id');
  return id;
}

const DOCX = 'application/vnd.openxmlformats-officedocument.wordprocessingml.document';

/** A resume tailored to one of the user's jobs: suggestions, the user's decisions, and the Word file. */
@Controller('jobs/:id/resume-draft')
export class TailoringController {
  constructor(private readonly tailoring: TailoringService) {}

  @Get()
  get(@CurrentUser() user: AuthUser, @Param('id') id: string) {
    return this.tailoring.get(user.id, jobId(id));
  }

  /** Starts (or restarts) suggesting changes. Poll GET until it's 'ready' or 'failed'. */
  @Post()
  @HttpCode(202)
  start(@CurrentUser() user: AuthUser, @Param('id') id: string) {
    return this.tailoring.start(user.id, jobId(id));
  }

  /** Accepts, rejects or edits suggestions: `{ decisions: [{ id, decision, editedText? }] }`. */
  @Patch()
  decide(@CurrentUser() user: AuthUser, @Param('id') id: string, @Body() body: unknown) {
    const updates = parseDecisions(body);
    if ('error' in updates) throw new BadRequestException(updates.error);
    return this.tailoring.decide(user.id, jobId(id), updates);
  }

  /** The tailored resume (.docx) with only the accepted changes. `?layout=workday` for Workday's resume autofill. */
  @Get('document')
  async document(@CurrentUser() user: AuthUser, @Param('id') id: string, @Query('layout') layoutParam?: string) {
    const layout = parseLayout(layoutParam);
    if (!layout) throw new BadRequestException('layout must be standard or workday');
    const { fileName, bytes } = await this.tailoring.document(user.id, jobId(id), layout);
    return new StreamableFile(bytes, { type: DOCX, disposition: attachmentDisposition(fileName), length: bytes.length });
  }
}
