import {
  BadRequestException,
  ConflictException,
  HttpException,
  HttpStatus,
  Inject,
  Injectable,
  Logger,
  NotFoundException,
  UnprocessableEntityException,
} from '@nestjs/common';
import { randomUUID } from 'crypto';
import { PresignedUpload, RESUME_FILES, ResumeFiles, userPrefix } from './resume-files';
import { ResumeRow, ResumeStore } from './resume-store';

export const RESUME_STORE = Symbol('RESUME_STORE');

/**
 * Called after a new upload is verified and has become the current resume.
 * The upload's reply waits for it, so it should only start slow work, not do it.
 */
export type ResumeReadyListener = (userId: string, resume: ResumeView) => Promise<void> | void;

export const MAX_BYTES = 5 * 1024 * 1024;
export const KEEP_VERSIONS = 5;
/** Upload links a user may request per hour without finishing them. */
const MAX_PENDING_PER_HOUR = 5;

export const FILE_TYPES = {
  'application/pdf': { ext: '.pdf', label: 'PDF' },
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document': { ext: '.docx', label: 'Word' },
} as const;
export type ResumeContentType = keyof typeof FILE_TYPES;

/** What the API returns about a resume: never the storage key. */
export interface ResumeView {
  id: string;
  fileName: string;
  contentType: string;
  sizeBytes: number;
  isCurrent: boolean;
  uploadedAt: string | null;
}

export function toView(r: ResumeRow): ResumeView {
  return {
    id: r.id,
    fileName: r.fileName,
    contentType: r.contentType,
    sizeBytes: r.sizeBytes,
    isCurrent: r.isCurrent,
    uploadedAt: r.uploadedAt?.toISOString() ?? null,
  };
}

export interface UploadRequest {
  fileName: string;
  contentType: ResumeContentType;
  sizeBytes: number;
}

/** Validates the browser's description of a file before any link is issued. */
export function parseUploadRequest(body: unknown): UploadRequest {
  const b = (body ?? {}) as Record<string, unknown>;
  const contentType = b.contentType;
  if (typeof contentType !== 'string' || !(contentType in FILE_TYPES)) {
    throw new BadRequestException('Upload a PDF or Word (.docx) file');
  }
  const type = contentType as ResumeContentType;
  // Keep only the base name, without control characters or path separators.
  const raw = typeof b.fileName === 'string' ? b.fileName : '';
  const fileName = raw.split(/[\\/]/).pop()!.replace(/[\x00-\x1f\x7f]/g, '').trim();
  if (!fileName || fileName.length > 200) throw new BadRequestException('File name must be 1–200 characters');
  if (!fileName.toLowerCase().endsWith(FILE_TYPES[type].ext)) {
    throw new BadRequestException(`A ${FILE_TYPES[type].label} file name must end in ${FILE_TYPES[type].ext}`);
  }
  const size = b.sizeBytes;
  if (typeof size !== 'number' || !Number.isInteger(size) || size < 1) throw new BadRequestException('File is empty');
  if (size > MAX_BYTES) throw new BadRequestException('File is larger than 5 MB');
  return { fileName, contentType: type, sizeBytes: size };
}

/** What the stored file's first bytes say it is, regardless of what the browser claimed. */
export function looksLike(contentType: ResumeContentType, start: Buffer): boolean {
  if (contentType === 'application/pdf') return start.subarray(0, 5).toString('latin1') === '%PDF-';
  // .docx is a ZIP archive: local file header "PK\x03\x04".
  return start.length >= 4 && start[0] === 0x50 && start[1] === 0x4b && start[2] === 0x03 && start[3] === 0x04;
}

@Injectable()
export class ResumesService {
  private readonly logger = new Logger(ResumesService.name);
  private readonly readyListeners: ResumeReadyListener[] = [];

  constructor(
    @Inject(RESUME_STORE) private readonly store: ResumeStore,
    @Inject(RESUME_FILES) private readonly files: ResumeFiles,
  ) {}

  /** Lets another module react to new resumes (e.g. read it into a profile) without a circular dependency. */
  onResumeReady(listener: ResumeReadyListener): void {
    this.readyListeners.push(listener);
  }

  /** Whether the user has a current resume; cheap (doesn't fetch the file). */
  async hasCurrent(userId: string): Promise<boolean> {
    return (await this.store.list(userId, 'ready')).some((r) => r.isCurrent);
  }

  /** The current resume's record and file, or null if the user has none. */
  async readCurrent(userId: string): Promise<{ resume: ResumeView; bytes: Buffer } | null> {
    const row = (await this.store.list(userId, 'ready')).find((r) => r.isCurrent);
    if (!row) return null;
    return { resume: toView(row), bytes: await this.files.read(row.s3Key) };
  }

  async list(userId: string): Promise<ResumeView[]> {
    const ready = await this.store.list(userId, 'ready');
    return ready.sort((a, b) => Number(b.isCurrent) - Number(a.isCurrent)).map(toView);
  }

  async requestUpload(userId: string, req: UploadRequest): Promise<{ resume: ResumeView; upload: PresignedUpload }> {
    await this.clearAbandoned(userId);
    if ((await this.store.countPendingSince(userId, new Date(Date.now() - 3600_000))) >= MAX_PENDING_PER_HOUR) {
      throw new HttpException(
        { statusCode: 429, message: 'Too many unfinished uploads. Please try again later.' },
        HttpStatus.TOO_MANY_REQUESTS,
      );
    }
    const id = randomUUID();
    const row = await this.store.insertPending({
      id,
      userId,
      fileName: req.fileName,
      contentType: req.contentType,
      sizeBytes: req.sizeBytes,
      s3Key: `${userPrefix(userId)}${id}`,
    });
    const upload = await this.files.presignUpload(row.s3Key, req.contentType, MAX_BYTES);
    return { resume: toView(row), upload };
  }

  /** Verifies the stored file, then makes it the current resume. Safe to call twice. */
  async complete(userId: string, id: string): Promise<ResumeView> {
    const row = await this.store.get(userId, id);
    if (!row) throw new NotFoundException('Resume not found');
    if (row.status === 'ready') return toView(row);

    const stored = await this.files.head(row.s3Key);
    if (!stored) throw new ConflictException('The file hasn\'t finished uploading');
    const start = await this.files.readStart(row.s3Key, 8);
    if (stored.size < 1 || stored.size > MAX_BYTES || !looksLike(row.contentType as ResumeContentType, start)) {
      // Not what was promised: remove it rather than keep an unverified file.
      await this.files.delete(row.s3Key);
      await this.store.delete(userId, id);
      throw new UnprocessableEntityException(
        `That doesn't look like a valid ${FILE_TYPES[row.contentType as ResumeContentType].label} file`,
      );
    }

    await this.files.markReady(row.s3Key);
    await this.store.markReadyAndCurrent(userId, id, stored.size);
    await this.trimHistory(userId);
    const view = toView((await this.store.get(userId, id))!);
    for (const listener of this.readyListeners) {
      try {
        await listener(userId, view);
      } catch (e) {
        this.logger.error(`Resume-ready listener failed: ${(e as Error).message}`);
      }
    }
    return view;
  }

  async downloadLink(userId: string, id: string): Promise<{ url: string; expiresInSeconds: number }> {
    const row = await this.readyResume(userId, id);
    return { url: await this.files.presignDownload(row.s3Key, row.fileName, row.contentType), expiresInSeconds: 60 };
  }

  async makeCurrent(userId: string, id: string): Promise<ResumeView> {
    await this.readyResume(userId, id);
    await this.store.makeCurrent(userId, id);
    return toView((await this.store.get(userId, id))!);
  }

  async delete(userId: string, id: string): Promise<void> {
    const row = await this.store.get(userId, id);
    if (!row) throw new NotFoundException('Resume not found');
    await this.files.delete(row.s3Key);
    await this.store.delete(userId, id);
    // If it was the current one, the newest remaining version takes over.
    if (row.isCurrent) {
      const [next] = await this.store.list(userId, 'ready');
      if (next) await this.store.makeCurrent(userId, next.id);
    }
  }

  private async readyResume(userId: string, id: string): Promise<ResumeRow> {
    const row = await this.store.get(userId, id);
    if (!row || row.status !== 'ready') throw new NotFoundException('Resume not found');
    return row;
  }

  /** Keeps the newest KEEP_VERSIONS ready resumes; older ones are deleted with their files. */
  private async trimHistory(userId: string): Promise<void> {
    const ready = await this.store.list(userId, 'ready');
    for (const old of ready.slice(KEEP_VERSIONS)) {
      await this.files.delete(old.s3Key);
      await this.store.delete(userId, old.id);
      this.logger.log(`removed old resume version ${old.id} for ${userId}`);
    }
  }

  /** Upload links never finished within a day: drop the rows (the bucket expires the files). */
  private async clearAbandoned(userId: string): Promise<void> {
    for (const r of await this.store.stalePending(userId, new Date(Date.now() - 24 * 3600_000))) {
      await this.store.delete(userId, r.id);
    }
  }
}
