import { BadRequestException, Body, Controller, Delete, Get, HttpCode, Param, Patch, Post, Query } from '@nestjs/common';
import { AuthUser } from '../auth/auth.types';
import { CurrentUser } from '../auth/decorators';
import { InboxService } from './inbox.service';

const ID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

function uuid(id: string, what: string): string {
  if (!ID.test(id)) throw new BadRequestException(`Invalid ${what} id`);
  return id;
}

const obj = (body: unknown): Record<string, unknown> => {
  if (!body || typeof body !== 'object' || Array.isArray(body)) throw new BadRequestException('Send JSON');
  return body as Record<string, unknown>;
};

/** The user's job emails from Gmail: connecting, syncing, summaries, links to jobs and stage suggestions. */
@Controller('inbox')
export class InboxController {
  constructor(private readonly inbox: InboxService) {}

  /** The connection and job emails, newest first. `?jobId=` for one job's emails. */
  @Get()
  view(@CurrentUser() user: AuthUser, @Query('jobId') jobId?: string) {
    return this.inbox.view(user.id, jobId ? uuid(jobId, 'job') : undefined);
  }

  /** Where to send the user to allow access: `{ url }` of Google's consent page. */
  @Post('connect')
  connect(@CurrentUser() user: AuthUser) {
    return this.inbox.connectUrl(user.id);
  }

  /** Finishes connecting: `{ code, state }` from Google's redirect to the web app. */
  @Post('connect/finish')
  finish(@CurrentUser() user: AuthUser, @Body() body: unknown) {
    const b = obj(body);
    if (typeof b.code !== 'string' || !b.code || b.code.length > 2000) throw new BadRequestException('code is required');
    if (typeof b.state !== 'string' || !b.state || b.state.length > 4000) throw new BadRequestException('state is required');
    return this.inbox.finishConnect(user.id, b.code, b.state);
  }

  /** Disconnects Gmail and deletes every saved email summary. */
  @Delete('connection')
  @HttpCode(204)
  disconnect(@CurrentUser() user: AuthUser) {
    return this.inbox.disconnect(user.id);
  }

  /** Reads new job emails in the background. Poll GET /inbox. */
  @Post('sync')
  @HttpCode(202)
  sync(@CurrentUser() user: AuthUser) {
    return this.inbox.sync(user.id);
  }

  /** The email's text, fetched from Gmail (not stored). */
  @Get('emails/:id/body')
  body(@CurrentUser() user: AuthUser, @Param('id') id: string) {
    return this.inbox.body(user.id, uuid(id, 'email'));
  }

  /** Links the email to a job: `{ jobId }`, or `{ jobId: null }` to unlink. */
  @Patch('emails/:id')
  link(@CurrentUser() user: AuthUser, @Param('id') id: string, @Body() body: unknown) {
    const b = obj(body);
    if (b.jobId !== null && typeof b.jobId !== 'string') throw new BadRequestException('jobId must be a job id or null');
    return this.inbox.link(user.id, uuid(id, 'email'), b.jobId === null ? null : uuid(b.jobId, 'job'));
  }

  /** Accepts or dismisses the email's stage suggestion: `{ accept: true | false }`. */
  @Post('emails/:id/suggestion')
  @HttpCode(200)
  suggestion(@CurrentUser() user: AuthUser, @Param('id') id: string, @Body() body: unknown) {
    const b = obj(body);
    if (typeof b.accept !== 'boolean') throw new BadRequestException('accept must be true or false');
    return this.inbox.decideSuggestion(user.id, uuid(id, 'email'), b.accept);
  }
}
