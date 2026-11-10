import {
  BadRequestException,
  ConflictException,
  HttpException,
  Inject,
  Injectable,
  Logger,
  NotFoundException,
  Optional,
  ServiceUnavailableException,
} from '@nestjs/common';
import { randomUUID } from 'crypto';
import { ProfileService } from '../profile/profile.service';
import { CandidateProfile, JobPreferences } from '../profile/profile.schema';
import { JobLink, JobLinkError, parseJobLink } from './job-link';
import { JOB_MATCHER, JobMatcher, MatchError } from './job-matcher';
import { APPLICATION_STATUSES, ApplicationStatus, EventSource, JobRow, JobRowSource, JobStore, MatchStatus } from './job-store';
import { JobDetails, JobMatch } from './job.schema';

export const JOB_STORE = Symbol('JOB_STORE');

/** A matching still running after this long is treated as failed (e.g. the API restarted mid-way). */
export const MATCH_TIMEOUT_MS = 5 * 60_000;

/** Keeps Claude spend per user in check. */
export const JOB_LIMITS = { perDay: 30, total: 500, descriptionMin: 200, descriptionMax: 50_000 };

export interface NewJobRequest {
  link: JobLink | null;
  description: string;
}

/** Validates the body of POST /jobs. */
export function parseNewJob(body: unknown): NewJobRequest {
  const b = (body ?? {}) as Record<string, unknown>;
  if (typeof b !== 'object' || Array.isArray(b)) throw new BadRequestException('Send the job as JSON');
  if (b.link !== undefined && b.link !== null && typeof b.link !== 'string') throw new BadRequestException('link must be text');
  if (typeof b.description !== 'string') throw new BadRequestException('Paste the job description');

  let link: JobLink | null = null;
  if (typeof b.link === 'string' && b.link.trim()) {
    try {
      link = parseJobLink(b.link);
    } catch (e) {
      if (e instanceof JobLinkError) throw new BadRequestException(e.message);
      throw e;
    }
  }
  const description = b.description.trim();
  if (description.length < JOB_LIMITS.descriptionMin) {
    throw new BadRequestException('Paste the full job description: what you pasted is too short to judge the job by');
  }
  if (description.length > JOB_LIMITS.descriptionMax) {
    throw new BadRequestException(`The job description is too long (over ${JOB_LIMITS.descriptionMax.toLocaleString('en')} characters)`);
  }
  return { link, description };
}

export const NOTES_MAX = 5000;

export interface ApplicationUpdate {
  status?: ApplicationStatus;
  notes?: string | null;
}

/** Validates the body of PATCH /jobs/:id/application: `{ status?, notes? }`. */
export function parseApplicationUpdate(body: unknown): ApplicationUpdate {
  const b = (body ?? {}) as Record<string, unknown>;
  if (typeof b !== 'object' || Array.isArray(b)) throw new BadRequestException('Send the update as JSON');
  const out: ApplicationUpdate = {};
  if (b.status !== undefined) {
    if (!APPLICATION_STATUSES.includes(b.status as ApplicationStatus)) {
      throw new BadRequestException(`status must be one of: ${APPLICATION_STATUSES.join(', ')}`);
    }
    out.status = b.status as ApplicationStatus;
  }
  if (b.notes !== undefined) {
    if (b.notes !== null && typeof b.notes !== 'string') throw new BadRequestException('notes must be text');
    if (typeof b.notes === 'string' && b.notes.length > NOTES_MAX) throw new BadRequestException(`Keep notes under ${NOTES_MAX.toLocaleString('en')} characters`);
    out.notes = typeof b.notes === 'string' && b.notes.trim() ? b.notes.trim() : null;
  }
  if (out.status === undefined && out.notes === undefined) throw new BadRequestException('Send a status or notes to update');
  return out;
}

export interface JobSummary {
  id: string;
  source: JobRowSource;
  url: string | null;
  /** The company's own application link, if the posting has one (lets the extension recognise the job). */
  applyUrl: string | null;
  title: string | null;
  company: string | null;
  location: string | null;
  matchStatus: MatchStatus;
  score: number | null;
  verdict: JobMatch['verdict'] | null;
  applicationStatus: ApplicationStatus;
  /** When the status last changed; null while it's still the initial 'saved'. */
  statusChangedAt: string | null;
  createdAt: string;
}

export interface JobView extends JobSummary {
  description: string;
  details: JobDetails | null;
  match: JobMatch | null;
  matchError: string | null;
  matchedAt: string | null;
  /** The profile was read or edited after this job was matched, so the match may be out of date. */
  profileChanged: boolean;
  notes: string | null;
  /** Status changes, oldest first, starting with when the job was saved; `source: 'email'` when accepted from an email. */
  timeline: { status: ApplicationStatus; at: string; source: EventSource }[];
}

@Injectable()
export class JobsService {
  private readonly logger = new Logger(JobsService.name);
  /** Matchings running in this process, by job; tests await them. */
  private readonly running = new Map<string, Promise<void>>();

  constructor(
    @Inject(JOB_STORE) private readonly store: JobStore,
    private readonly profiles: ProfileService,
    @Optional() @Inject(JOB_MATCHER) private readonly matcher: JobMatcher | null,
  ) {}

  async list(userId: string): Promise<JobSummary[]> {
    return (await this.store.list(userId)).map((r) => summary(fresh(r)));
  }

  async get(userId: string, id: string): Promise<JobView> {
    const row = await this.store.get(userId, id);
    if (!row) throw new NotFoundException('Job not found');
    return this.view(userId, fresh(row));
  }

  /** Adds a job and starts matching it; returns at once. Poll GET /jobs/:id until it's 'ready' or 'failed'. */
  async add(userId: string, req: NewJobRequest): Promise<JobView> {
    const matcher = this.requireMatcher();
    const source: JobRowSource = req.link?.source ?? 'pasted';
    if (req.link?.externalId) {
      const existing = await this.store.findByExternalId(userId, source, req.link.externalId);
      if (existing) throw new ConflictException({ statusCode: 409, message: "You've already added this job", jobId: existing.id });
    }
    const { total, lastDay } = await this.store.counts(userId);
    if (lastDay >= JOB_LIMITS.perDay) {
      throw new HttpException({ statusCode: 429, message: `You can add up to ${JOB_LIMITS.perDay} jobs a day. Please try again tomorrow.` }, 429);
    }
    if (total >= JOB_LIMITS.total) {
      throw new ConflictException(`You have ${JOB_LIMITS.total} jobs saved. Delete some you no longer need, then add more.`);
    }
    const { profile, preferences } = await this.matchInputs(userId);

    const id = randomUUID();
    const runId = randomUUID();
    await this.store.insert({ id, userId, source, externalId: req.link?.externalId ?? null, url: req.link?.url ?? null, description: req.description, runId });
    this.run(matcher, userId, id, runId, req.description, profile, preferences);
    return this.get(userId, id);
  }

  /** Matches the job again against the current profile and preferences. */
  async rematch(userId: string, id: string): Promise<JobView> {
    const matcher = this.requireMatcher();
    const job = await this.get(userId, id);
    const { profile, preferences } = await this.matchInputs(userId);
    const runId = randomUUID();
    // Checked in the update itself, so two requests at once can't both start one.
    if (!(await this.store.startMatch(userId, id, runId, new Date(Date.now() - MATCH_TIMEOUT_MS)))) {
      throw new ConflictException('This job is already being matched');
    }
    this.run(matcher, userId, id, runId, job.description, profile, preferences);
    return this.get(userId, id);
  }

  /** Records where the user is with this job: its status and/or private notes. */
  async updateApplication(userId: string, id: string, update: ApplicationUpdate, source: EventSource = null): Promise<JobView> {
    if (!(await this.store.updateApplication(userId, id, randomUUID(), update, source))) throw new NotFoundException('Job not found');
    return this.get(userId, id);
  }

  async delete(userId: string, id: string): Promise<void> {
    if (!(await this.store.delete(userId, id))) throw new NotFoundException('Job not found');
  }

  /** Resolves when every matching running in this process has finished. For tests. */
  async whenIdle(): Promise<void> {
    await Promise.all(this.running.values());
  }

  private requireMatcher(): JobMatcher {
    if (!this.matcher) throw new ServiceUnavailableException("Matching jobs with AI isn't set up on this server");
    return this.matcher;
  }

  private async matchInputs(userId: string): Promise<{ profile: CandidateProfile; preferences: JobPreferences }> {
    const { profile } = await this.profiles.get(userId);
    if (!profile) throw new ConflictException('Set up your profile first: upload your resume, or fill in your profile by hand');
    return { profile, preferences: await this.profiles.getPreferences(userId) };
  }

  private run(matcher: JobMatcher, userId: string, id: string, runId: string, description: string, profile: CandidateProfile, preferences: JobPreferences) {
    const run = (async () => {
      try {
        const { job, match } = await matcher.analyse({ profile, preferences, description });
        await this.store.finishMatch(userId, id, runId, job, match);
      } catch (e) {
        const message = e instanceof MatchError ? e.message : 'Something went wrong matching this job. Please try again.';
        if (!(e instanceof MatchError)) this.logger.error(`Matching a job failed: ${(e as Error).stack ?? e}`);
        await this.store.failMatch(userId, id, runId, message).catch((err) => this.logger.error(`Couldn't record a failed matching: ${err}`));
      }
    })().finally(() => {
      if (this.running.get(id) === run) this.running.delete(id);
    });
    this.running.set(id, run);
  }

  private async view(userId: string, row: JobRow): Promise<JobView> {
    let profileChanged = false;
    if (row.matchedAt) {
      const p = await this.profiles.get(userId);
      const changed = [p.parsedAt, p.editedAt].filter((d): d is string => Boolean(d)).map((d) => new Date(d).getTime());
      profileChanged = changed.some((t) => t > row.matchedAt!.getTime());
    }
    return {
      ...summary(row),
      description: row.description,
      details: row.details,
      match: row.match,
      matchError: row.matchError,
      matchedAt: row.matchedAt?.toISOString() ?? null,
      profileChanged,
      notes: row.notes,
      timeline: [
        { status: 'saved' as const, at: row.createdAt.toISOString(), source: null },
        ...(await this.store.events(userId, row.id)).map((e) => ({ status: e.status, at: e.at.toISOString(), source: e.source })),
      ],
    };
  }
}

/** A matching left running too long (e.g. the API restarted) is shown as failed. */
function fresh(row: JobRow): JobRow {
  if (row.matchStatus !== 'matching' || Date.now() - row.updatedAt.getTime() <= MATCH_TIMEOUT_MS) return row;
  return { ...row, matchStatus: 'failed', matchError: 'Matching this job took too long. Please try again.' };
}

function summary(row: JobRow): JobSummary {
  return {
    id: row.id,
    source: row.source,
    url: row.url,
    applyUrl: row.details?.applyUrl ?? null,
    title: row.details?.title ?? null,
    company: row.details?.company ?? null,
    location: row.details?.location ?? null,
    matchStatus: row.matchStatus,
    score: row.match?.score ?? null,
    verdict: row.match?.verdict ?? null,
    applicationStatus: row.applicationStatus,
    statusChangedAt: row.statusChangedAt?.toISOString() ?? null,
    createdAt: row.createdAt.toISOString(),
  };
}
