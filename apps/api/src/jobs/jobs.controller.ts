import { BadRequestException, Body, Controller, Delete, Get, HttpCode, Param, Post } from '@nestjs/common';
import { AuthUser } from '../auth/auth.types';
import { CurrentUser } from '../auth/decorators';
import { JobsService, parseNewJob } from './jobs.service';

const ID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

function jobId(id: string): string {
  if (!ID.test(id)) throw new BadRequestException('Invalid job id');
  return id;
}

/** The signed-in user's own jobs. Every route acts only on the caller's jobs. */
@Controller('jobs')
export class JobsController {
  constructor(private readonly jobs: JobsService) {}

  @Get()
  list(@CurrentUser() user: AuthUser) {
    return this.jobs.list(user.id);
  }

  /** Adds a pasted job (optionally with its link) and starts matching it. Poll GET /jobs/:id. */
  @Post()
  @HttpCode(202)
  add(@CurrentUser() user: AuthUser, @Body() body: unknown) {
    return this.jobs.add(user.id, parseNewJob(body));
  }

  @Get(':id')
  get(@CurrentUser() user: AuthUser, @Param('id') id: string) {
    return this.jobs.get(user.id, jobId(id));
  }

  /** Matches the job again, e.g. after the profile changed. */
  @Post(':id/match')
  @HttpCode(202)
  rematch(@CurrentUser() user: AuthUser, @Param('id') id: string) {
    return this.jobs.rematch(user.id, jobId(id));
  }

  @Delete(':id')
  @HttpCode(204)
  async remove(@CurrentUser() user: AuthUser, @Param('id') id: string) {
    await this.jobs.delete(user.id, jobId(id));
  }
}
