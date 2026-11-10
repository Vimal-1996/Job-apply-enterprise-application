import { BadRequestException, Body, Controller, Delete, Get, HttpCode, Param, Patch, Post, Query } from '@nestjs/common';
import { AuthUser } from '../auth/auth.types';
import { CurrentUser } from '../auth/decorators';
import { INBOX_LIMITS, InboxService } from './inbox.service';

const ID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

function uuid(id: string, what: string): string {
  if (!ID.test(id)) throw new BadRequestException(`Invalid ${what} id`);
  return id;
}

/** An ISO date-time from the query or body, or undefined; anything else is a 400. */
function instant(v: unknown, name: string): Date | undefined {
  if (v === undefined || v === null || v === '') return undefined;
  const t = typeof v === 'string' ? Date.parse(v) : NaN;
  if (!Number.isFinite(t)) throw new BadRequestException(`${name} must be an ISO date-time`);
  return new Date(t);
}

/** A [since, until) window: both or neither, in order, and not too far back. */
export function parseWindow(sinceRaw: unknown, untilRaw: unknown): { since: Date; until: Date } | undefined {
  const since = instant(sinceRaw, 'since');
  const until = instant(untilRaw, 'until');
  if (!since && !until) return undefined;
  if (!since || !until) throw new BadRequestException('Send both since and until');
  if (since >= until) throw new BadRequestException('since must be before until');
  if (since.getTime() < Date.now() - INBOX_LIMITS.maxDaysBack * 24 * 60 * 60_000) {
    throw new BadRequestException(`Dates can go back at most ${INBOX_LIMITS.maxDaysBack / 365} years`);
  }
  return { since, until };
}

const obj = (body: unknown): Record<string, unknown> => {
  if (!body || typeof body !== 'object' || Array.isArray(body)) throw new BadRequestException('Send JSON');
  return body as Record<string, unknown>;
};

/** The user's job emails from Gmail: connecting, syncing, summaries, links to jobs and stage suggestions. */
@Controller('inbox')
export class InboxController {
  constructor(private readonly inbox: InboxService) {}

  /** The connection and emails about the user's applications, newest first. `?jobId=` for one job's; `?since=&until=` (ISO) for a time window. */
  @Get()
  view(@CurrentUser() user: AuthUser, @Query('jobId') jobId?: string, @Query('since') since?: string, @Query('until') until?: string) {
    return this.inbox.view(user.id, { jobId: jobId ? uuid(jobId, 'job') : undefined, ...parseWindow(since, until) });
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

  /** Reads job emails in the background: new mail, or `{ since, until }` (ISO) for a date range. Poll GET /inbox. */
  @Post('sync')
  @HttpCode(202)
  sync(@CurrentUser() user: AuthUser, @Body() body: unknown) {
    const b = (body && typeof body === 'object' ? body : {}) as Record<string, unknown>;
    return this.inbox.sync(user.id, parseWindow(b.since, b.until));
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
