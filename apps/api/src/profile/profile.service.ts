import {
  BadRequestException,
  ConflictException,
  Inject,
  Injectable,
  Logger,
  OnModuleInit,
  Optional,
  ServiceUnavailableException,
} from '@nestjs/common';
import { randomUUID } from 'crypto';
import { ResumesService } from '../resumes/resumes.service';
import { ExtractionError, PROFILE_EXTRACTOR, ProfileExtractor } from './profile-extractor';
import { ProfileStatus, ProfileStore } from './profile-store';
import {
  CandidateProfile,
  CandidateProfileSchema,
  checkProfileLimits,
  describeZodError,
  EMPTY_PREFERENCES,
  JobPreferences,
  JobPreferencesSchema,
} from './profile.schema';

export const PROFILE_STORE = Symbol('PROFILE_STORE');

/** A reading still 'parsing' after this long is treated as failed (e.g. the API restarted mid-way). */
export const PARSE_TIMEOUT_MS = 5 * 60_000;

export interface ProfileView {
  /** 'none': no profile yet. */
  status: ProfileStatus | 'none';
  profile: CandidateProfile | null;
  /** The resume the profile was (or is being) read from. */
  sourceFileName: string | null;
  parsedAt: string | null;
  editedAt: string | null;
  error: string | null;
  /** False when no AI is configured, so the page can say why reading isn't offered. */
  aiEnabled: boolean;
}

@Injectable()
export class ProfileService implements OnModuleInit {
  private readonly logger = new Logger(ProfileService.name);
  /** Readings running in this process, by user; tests await them. */
  private readonly running = new Map<string, Promise<void>>();

  constructor(
    @Inject(PROFILE_STORE) private readonly store: ProfileStore,
    private readonly resumes: ResumesService,
    @Optional() @Inject(PROFILE_EXTRACTOR) private readonly extractor: ProfileExtractor | null,
  ) {}

  /**
   * Each newly uploaded resume is read into the profile automatically. The
   * upload's reply waits only for the reading to start, so the page shows
   * "reading" straight away.
   */
  onModuleInit(): void {
    this.resumes.onResumeReady(async (userId) => {
      if (!this.extractor) return;
      try {
        await this.parseCurrentResume(userId);
      } catch (e) {
        this.logger.warn(`Couldn't start reading the new resume: ${(e as Error).message}`);
      }
    });
  }

  async get(userId: string): Promise<ProfileView> {
    const row = await this.store.get(userId);
    const aiEnabled = Boolean(this.extractor);
    if (!row) {
      return { status: 'none', profile: null, sourceFileName: null, parsedAt: null, editedAt: null, error: null, aiEnabled };
    }
    const stale = row.status === 'parsing' && Date.now() - row.updatedAt.getTime() > PARSE_TIMEOUT_MS;
    return {
      status: stale ? 'failed' : row.status,
      profile: row.profile,
      sourceFileName: row.sourceFileName,
      parsedAt: row.parsedAt?.toISOString() ?? null,
      editedAt: row.editedAt?.toISOString() ?? null,
      error: stale ? 'Reading the resume took too long. Please try again.' : row.error,
      aiEnabled,
    };
  }

  /**
   * Starts reading the user's current resume into their profile and returns at
   * once; the page polls `get` until it's 'ready' or 'failed'. Replaces the
   * profile, including the user's edits, when it succeeds.
   */
  async parseCurrentResume(userId: string): Promise<ProfileView> {
    if (!this.extractor) throw new ServiceUnavailableException("Reading resumes with AI isn't set up on this server");
    const view = await this.get(userId);
    if (view.status === 'parsing') throw new ConflictException('Your resume is already being read');

    const current = await this.resumes.readCurrent(userId);
    if (!current) throw new ConflictException('Upload a resume first');

    const runId = randomUUID();
    await this.store.startParse(userId, runId, current.resume.id, current.resume.fileName);
    const extractor = this.extractor;
    const run = (async () => {
      try {
        const profile = await extractor.extract({
          fileName: current.resume.fileName,
          contentType: current.resume.contentType,
          bytes: current.bytes,
        });
        await this.store.finishParse(userId, runId, profile);
      } catch (e) {
        const message = e instanceof ExtractionError ? e.message : "Something went wrong reading your resume. Please try again.";
        if (!(e instanceof ExtractionError)) this.logger.error(`Reading a resume failed: ${(e as Error).stack ?? e}`);
        await this.store.failParse(userId, runId, message);
      }
    })().finally(() => {
      if (this.running.get(userId) === run) this.running.delete(userId);
    });
    this.running.set(userId, run);
    return this.get(userId);
  }

  /** Resolves when the user's reading (if any) has finished. For tests. */
  async whenIdle(userId: string): Promise<void> {
    await this.running.get(userId);
  }

  async update(userId: string, body: unknown): Promise<ProfileView> {
    const parsed = CandidateProfileSchema.safeParse(body);
    if (!parsed.success) throw new BadRequestException(describeZodError(parsed.error));
    const problem = checkProfileLimits(parsed.data);
    if (problem) throw new BadRequestException(problem);
    if ((await this.get(userId)).status === 'parsing') {
      throw new ConflictException('Your resume is being read. Wait for it to finish, then make your changes.');
    }
    await this.store.saveEdited(userId, parsed.data);
    return this.get(userId);
  }

  async getPreferences(userId: string): Promise<JobPreferences> {
    return (await this.store.getPreferences(userId)) ?? EMPTY_PREFERENCES;
  }

  async updatePreferences(userId: string, body: unknown): Promise<JobPreferences> {
    const parsed = JobPreferencesSchema.safeParse(body);
    if (!parsed.success) throw new BadRequestException(describeZodError(parsed.error));
    const p = parsed.data;
    // Tidy: no duplicates (case-insensitive) in the lists.
    const unique = (xs: string[]) => [...new Map(xs.map((x) => [x.toLowerCase(), x])).values()];
    const clean: JobPreferences = {
      ...p,
      targetTitles: unique(p.targetTitles),
      locations: unique(p.locations),
      workModes: [...new Set(p.workModes)],
      excludedCompanies: unique(p.excludedCompanies),
    };
    await this.store.savePreferences(userId, clean);
    return clean;
  }
}
