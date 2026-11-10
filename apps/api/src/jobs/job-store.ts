import type { Pool } from 'pg';
import { JobSource } from './job-link';
import { JobDetails, JobMatch } from './job.schema';

export type JobRowSource = JobSource | 'pasted';
export type MatchStatus = 'matching' | 'ready' | 'failed';
export const APPLICATION_STATUSES = ['saved', 'applied', 'interviewing', 'offer', 'rejected', 'withdrawn'] as const;
export type ApplicationStatus = (typeof APPLICATION_STATUSES)[number];

/** Where a stage change came from: null when the user made it, 'email' when they accepted an email's suggestion. */
export type EventSource = 'email' | null;

export interface ApplicationEvent {
  status: ApplicationStatus;
  at: Date;
  source: EventSource;
}

export interface JobRow {
  id: string;
  userId: string;
  source: JobRowSource;
  externalId: string | null;
  url: string | null;
  description: string;
  details: JobDetails | null;
  matchStatus: MatchStatus;
  runId: string | null;
  match: JobMatch | null;
  matchError: string | null;
  matchedAt: Date | null;
  applicationStatus: ApplicationStatus;
  notes: string | null;
  statusChangedAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
}

export interface NewJob {
  id: string;
  userId: string;
  source: JobRowSource;
  externalId: string | null;
  url: string | null;
  description: string;
  runId: string;
}

const COLUMNS =
  'id, user_id, source, external_id, url, description, details, match_status, run_id, match, match_error, matched_at, application_status, notes, status_changed_at, created_at, updated_at';

const date = (v: unknown) => (v ? new Date(v as string) : null);
const json = (v: unknown) => (typeof v === 'string' ? JSON.parse(v) : (v ?? null));

function toRow(r: Record<string, any>): JobRow {
  return {
    id: r.id,
    userId: r.user_id,
    source: r.source,
    externalId: r.external_id,
    url: r.url,
    description: r.description,
    details: json(r.details),
    matchStatus: r.match_status,
    runId: r.run_id,
    match: json(r.match),
    matchError: r.match_error,
    matchedAt: date(r.matched_at),
    applicationStatus: r.application_status,
    notes: r.notes,
    statusChangedAt: date(r.status_changed_at),
    createdAt: new Date(r.created_at),
    updatedAt: new Date(r.updated_at),
  };
}

/** Users' jobs in Postgres. Every query is scoped to one user. */
export class JobStore {
  constructor(private readonly pool: Pool) {}

  /** Newest first. */
  async list(userId: string): Promise<JobRow[]> {
    const { rows } = await this.pool.query(`SELECT ${COLUMNS} FROM job WHERE user_id = $1 ORDER BY created_at DESC, id`, [userId]);
    return rows.map(toRow);
  }

  async get(userId: string, id: string): Promise<JobRow | null> {
    const { rows } = await this.pool.query(`SELECT ${COLUMNS} FROM job WHERE user_id = $1 AND id = $2`, [userId, id]);
    return rows[0] ? toRow(rows[0]) : null;
  }

  async findByExternalId(userId: string, source: JobRowSource, externalId: string): Promise<JobRow | null> {
    const { rows } = await this.pool.query(
      `SELECT ${COLUMNS} FROM job WHERE user_id = $1 AND source = $2 AND external_id = $3 LIMIT 1`,
      [userId, source, externalId],
    );
    return rows[0] ? toRow(rows[0]) : null;
  }

  /** How many jobs the user has, and how many they added in the last day. */
  async counts(userId: string): Promise<{ total: number; lastDay: number }> {
    const { rows } = await this.pool.query(
      `SELECT count(*) AS total, coalesce(sum(CASE WHEN created_at > $2 THEN 1 ELSE 0 END), 0) AS last_day FROM job WHERE user_id = $1`,
      [userId, new Date(Date.now() - 24 * 60 * 60_000)],
    );
    return { total: Number(rows[0].total), lastDay: Number(rows[0].last_day) };
  }

  /** Adds a job, with its first matching already started. */
  async insert(job: NewJob): Promise<void> {
    await this.pool.query(
      `INSERT INTO job (id, user_id, source, external_id, url, description, match_status, run_id)
       VALUES ($1, $2, $3, $4, $5, $6, 'matching', $7)`,
      [job.id, job.userId, job.source, job.externalId, job.url, job.description, job.runId],
    );
  }

  /**
   * Starts a new matching (keeping the previous result until it finishes),
   * unless one is already running and not yet stale. False if not started.
   */
  async startMatch(userId: string, id: string, runId: string, staleBefore: Date): Promise<boolean> {
    const { rowCount } = await this.pool.query(
      `UPDATE job SET match_status = 'matching', run_id = $3, match_error = NULL, updated_at = now()
        WHERE user_id = $1 AND id = $2 AND (match_status <> 'matching' OR updated_at < $4)`,
      [userId, id, runId, staleBefore],
    );
    return rowCount === 1;
  }

  /** Stores a finished matching. False if a newer one replaced it, or the job was deleted. */
  async finishMatch(userId: string, id: string, runId: string, details: JobDetails, match: JobMatch): Promise<boolean> {
    const { rowCount } = await this.pool.query(
      `UPDATE job SET match_status = 'ready', details = $4, match = $5, match_error = NULL, matched_at = now(), run_id = NULL, updated_at = now()
        WHERE user_id = $1 AND id = $2 AND run_id = $3`,
      [userId, id, runId, JSON.stringify(details), JSON.stringify(match)],
    );
    return rowCount === 1;
  }

  /** Records why a matching failed; any previous result stays. */
  async failMatch(userId: string, id: string, runId: string, error: string): Promise<void> {
    await this.pool.query(
      `UPDATE job SET match_status = 'failed', match_error = $4, run_id = NULL, updated_at = now() WHERE user_id = $1 AND id = $2 AND run_id = $3`,
      [userId, id, runId, error],
    );
  }

  /**
   * Updates where the user is with this job. A status change is also logged
   * for the timeline (unless the status is unchanged). False if there was no such job.
   */
  async updateApplication(
    userId: string,
    id: string,
    eventId: string,
    patch: { status?: ApplicationStatus; notes?: string | null },
    source: EventSource = null,
  ): Promise<boolean> {
    const client = await this.pool.connect();
    try {
      await client.query('BEGIN');
      const { rowCount: exists } = await client.query('SELECT 1 FROM job WHERE user_id = $1 AND id = $2', [userId, id]);
      if (!exists) {
        await client.query('ROLLBACK');
        return false;
      }
      if (patch.status !== undefined) {
        // Only an actual change counts; checked in the update itself, so two requests at once log it once.
        const { rowCount } = await client.query(
          'UPDATE job SET application_status = $3, status_changed_at = now() WHERE user_id = $1 AND id = $2 AND application_status <> $3',
          [userId, id, patch.status],
        );
        if (rowCount === 1) {
          await client.query('INSERT INTO application_event (id, job_id, user_id, status, source) VALUES ($1, $2, $3, $4, $5)', [
            eventId,
            id,
            userId,
            patch.status,
            source,
          ]);
        }
      }
      if (patch.notes !== undefined) {
        await client.query('UPDATE job SET notes = $3 WHERE user_id = $1 AND id = $2', [userId, id, patch.notes]);
      }
      await client.query('COMMIT');
      return true;
    } catch (e) {
      await client.query('ROLLBACK').catch(() => undefined);
      throw e;
    } finally {
      client.release();
    }
  }

  /** The job's status changes, oldest first. */
  async events(userId: string, id: string): Promise<ApplicationEvent[]> {
    const { rows } = await this.pool.query(
      'SELECT status, created_at, source FROM application_event WHERE user_id = $1 AND job_id = $2 ORDER BY created_at, id',
      [userId, id],
    );
    return rows.map((r) => ({ status: r.status, at: new Date(r.created_at), source: r.source ?? null }));
  }

  /** False if there was no such job. */
  async delete(userId: string, id: string): Promise<boolean> {
    const { rowCount } = await this.pool.query('DELETE FROM job WHERE user_id = $1 AND id = $2', [userId, id]);
    return rowCount === 1;
  }
}
