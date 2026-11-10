import {
  BadRequestException,
  ConflictException,
  HttpException,
  Inject,
  Injectable,
  Logger,
  Optional,
  ServiceUnavailableException,
} from '@nestjs/common';
import { randomUUID } from 'crypto';
import { JobsService } from '../jobs/jobs.service';
import { ProfileService } from '../profile/profile.service';
import { DraftRow, DraftStatus, DraftStore } from './draft-store';
import { RESUME_TAILOR, ResumeTailor, TailorError, TailorInput } from './resume-tailor';
import { buildResumeDocx, resumeFileName } from './resume-docx';
import { applySuggestions, DecisionUpdate, Suggestion, TAILORING_LIMITS, tidySuggestions } from './tailoring.schema';

export const DRAFT_STORE = Symbol('DRAFT_STORE');

/** A tailoring still running after this long is treated as failed (e.g. the API restarted mid-way). */
export const TAILOR_TIMEOUT_MS = 5 * 60_000;

export interface DraftView {
  status: 'none' | DraftStatus;
  suggestions: Suggestion[];
  /** The roles suggestions point at (by workIndex), from the profile they were made against. */
  roles: { title: string; company: string }[];
  error: string | null;
  suggestedAt: string | null;
  /** The profile changed after the suggestions were made: the resume is built from the older copy. */
  profileChanged: boolean;
  aiEnabled: boolean;
}

/**
 * Tailored resumes. Claude only proposes changes; the user accepts, edits or
 * rejects each, and the Word file is built from the profile the suggestions
 * were made against plus the accepted ones.
 */
@Injectable()
export class TailoringService {
  private readonly logger = new Logger(TailoringService.name);
  /** Runs in this process, by job; tests await them. */
  private readonly running = new Map<string, Promise<void>>();

  constructor(
    @Inject(DRAFT_STORE) private readonly store: DraftStore,
    private readonly jobs: JobsService,
    private readonly profiles: ProfileService,
    @Optional() @Inject(RESUME_TAILOR) private readonly tailor: ResumeTailor | null,
  ) {}

  async get(userId: string, jobId: string): Promise<DraftView> {
    await this.jobs.get(userId, jobId); // 404 unless it's the user's job
    return this.view(userId, await this.store.get(userId, jobId));
  }

  /** Starts suggesting changes for this job and returns at once; poll `get` until 'ready' or 'failed'. */
  async start(userId: string, jobId: string): Promise<DraftView> {
    const tailor = this.tailor;
    if (!tailor) throw new ServiceUnavailableException("Tailoring resumes with AI isn't set up on this server");
    const job = await this.jobs.get(userId, jobId);
    if (!job.details) throw new ConflictException('Wait until this job has been matched, then tailor your resume to it');
    const { profile } = await this.profiles.get(userId);
    if (!profile) throw new ConflictException('Set up your profile first: upload your resume, or fill in your profile by hand');
    if ((await this.store.runsLastDay(userId)) >= TAILORING_LIMITS.perDay) {
      throw new HttpException({ statusCode: 429, message: `You can tailor up to ${TAILORING_LIMITS.perDay} resumes a day. Please try again tomorrow.` }, 429);
    }
    const runId = randomUUID();
    if (!(await this.store.start(userId, jobId, runId, new Date(Date.now() - TAILOR_TIMEOUT_MS)))) {
      throw new ConflictException('Suggestions for this job are already being made');
    }
    const input: TailorInput = { profile, job: job.details, match: job.match, description: job.description };
    const run = (async () => {
      try {
        const raw = await tailor.suggest(input);
        await this.store.finish(userId, jobId, runId, profile, tidySuggestions(profile, raw, randomUUID));
      } catch (e) {
        const message = e instanceof TailorError ? e.message : 'Something went wrong making suggestions. Please try again.';
        if (!(e instanceof TailorError)) this.logger.error(`Tailoring a resume failed: ${(e as Error).stack ?? e}`);
        await this.store.fail(userId, jobId, runId, message).catch((err) => this.logger.error(`Couldn't record a failed tailoring: ${err}`));
      }
    })().finally(() => {
      if (this.running.get(jobId) === run) this.running.delete(jobId);
    });
    this.running.set(jobId, run);
    return this.get(userId, jobId);
  }

  /** Saves the user's accept / reject / edit decisions. */
  async decide(userId: string, jobId: string, updates: DecisionUpdate[]): Promise<DraftView> {
    await this.jobs.get(userId, jobId);
    const draft = await this.store.get(userId, jobId);
    if (!draft?.suggestions || !draft.suggestedAt) throw new ConflictException('There are no suggestions to review yet');
    const byId = new Map(draft.suggestions.map((s) => [s.id, s]));
    const unknown = updates.find((u) => !byId.has(u.id));
    if (unknown) throw new BadRequestException('Unknown suggestion. Refresh the page and try again.');
    const next = draft.suggestions.map((s) => {
      const u = updates.find((x) => x.id === s.id);
      if (!u) return s;
      return { ...s, decision: u.decision, editedText: u.editedText === undefined ? s.editedText : u.editedText };
    });
    if (!(await this.store.saveSuggestions(userId, jobId, draft.suggestedAt, next))) {
      throw new ConflictException('These suggestions were replaced. Refresh the page to see the new ones.');
    }
    return this.get(userId, jobId);
  }

  /** The tailored resume as a Word file: the base profile plus the accepted suggestions. */
  async document(userId: string, jobId: string): Promise<{ fileName: string; bytes: Buffer }> {
    const job = await this.jobs.get(userId, jobId);
    const draft = await this.store.get(userId, jobId);
    if (!draft?.baseProfile || !draft.suggestions) throw new ConflictException('Get suggestions for this job first');
    const profile = applySuggestions(draft.baseProfile, draft.suggestions);
    return { fileName: resumeFileName(profile.fullName, job.company), bytes: await buildResumeDocx(profile) };
  }

  /** Resolves when every run in this process has finished. For tests. */
  async whenIdle(): Promise<void> {
    await Promise.all(this.running.values());
  }

  private async view(userId: string, row: DraftRow | null): Promise<DraftView> {
    const aiEnabled = Boolean(this.tailor);
    if (!row) return { status: 'none', suggestions: [], roles: [], error: null, suggestedAt: null, profileChanged: false, aiEnabled };
    const stale = row.status === 'suggesting' && Date.now() - row.updatedAt.getTime() > TAILOR_TIMEOUT_MS;
    let profileChanged = false;
    if (row.suggestedAt) {
      const p = await this.profiles.get(userId);
      profileChanged = [p.parsedAt, p.editedAt].some((d) => d && new Date(d).getTime() > row.suggestedAt!.getTime());
    }
    return {
      status: stale ? 'failed' : row.status,
      suggestions: row.suggestions ?? [],
      roles: (row.baseProfile?.workHistory ?? []).map((w) => ({ title: w.title, company: w.company })),
      error: stale ? 'Making suggestions took too long. Please try again.' : row.error,
      suggestedAt: row.suggestedAt?.toISOString() ?? null,
      profileChanged,
      aiEnabled,
    };
  }
}
