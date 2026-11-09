import type { Pool } from 'pg';
import { CandidateProfile, JobPreferences } from './profile.schema';

export type ProfileStatus = 'parsing' | 'ready' | 'failed';

export interface ProfileRow {
  userId: string;
  status: ProfileStatus;
  runId: string | null;
  sourceResumeId: string | null;
  sourceFileName: string | null;
  profile: CandidateProfile | null;
  error: string | null;
  parsedAt: Date | null;
  editedAt: Date | null;
  updatedAt: Date;
}

const COLUMNS =
  'user_id, status, run_id, source_resume_id, source_file_name, profile, error, parsed_at, edited_at, updated_at';

const date = (v: unknown) => (v ? new Date(v as string) : null);

function toRow(r: Record<string, any>): ProfileRow {
  return {
    userId: r.user_id,
    status: r.status,
    runId: r.run_id,
    sourceResumeId: r.source_resume_id,
    sourceFileName: r.source_file_name,
    profile: typeof r.profile === 'string' ? JSON.parse(r.profile) : r.profile,
    error: r.error,
    parsedAt: date(r.parsed_at),
    editedAt: date(r.edited_at),
    updatedAt: new Date(r.updated_at),
  };
}

/** Candidate profiles and job preferences in Postgres. Every query is scoped to one user. */
export class ProfileStore {
  constructor(private readonly pool: Pool) {}

  async get(userId: string): Promise<ProfileRow | null> {
    const { rows } = await this.pool.query(`SELECT ${COLUMNS} FROM candidate_profile WHERE user_id = $1`, [userId]);
    return rows[0] ? toRow(rows[0]) : null;
  }

  /** Records that a reading of this resume has started (keeping any existing profile). */
  async startParse(userId: string, runId: string, resumeId: string, fileName: string): Promise<void> {
    const { rowCount } = await this.pool.query(
      `UPDATE candidate_profile
          SET status = 'parsing', run_id = $2, source_resume_id = $3, source_file_name = $4, error = NULL, updated_at = now()
        WHERE user_id = $1`,
      [userId, runId, resumeId, fileName],
    );
    if (!rowCount) {
      await this.pool.query(
        `INSERT INTO candidate_profile (user_id, status, run_id, source_resume_id, source_file_name)
         VALUES ($1, 'parsing', $2, $3, $4)`,
        [userId, runId, resumeId, fileName],
      );
    }
  }

  /** Stores the profile from a finished reading. False if a newer reading has replaced this one. */
  async finishParse(userId: string, runId: string, profile: CandidateProfile): Promise<boolean> {
    const { rowCount } = await this.pool.query(
      `UPDATE candidate_profile
          SET status = 'ready', profile = $3, error = NULL, parsed_at = now(), edited_at = NULL, run_id = NULL, updated_at = now()
        WHERE user_id = $1 AND run_id = $2`,
      [userId, runId, JSON.stringify(profile)],
    );
    return rowCount === 1;
  }

  /** Records why a reading failed; the previous profile, if any, stays. */
  async failParse(userId: string, runId: string, error: string): Promise<void> {
    await this.pool.query(
      `UPDATE candidate_profile SET status = 'failed', error = $3, run_id = NULL, updated_at = now()
        WHERE user_id = $1 AND run_id = $2`,
      [userId, runId, error],
    );
  }

  /** Saves the user's own edits. */
  async saveEdited(userId: string, profile: CandidateProfile): Promise<void> {
    const json = JSON.stringify(profile);
    const { rowCount } = await this.pool.query(
      `UPDATE candidate_profile SET profile = $2, edited_at = now(), updated_at = now() WHERE user_id = $1`,
      [userId, json],
    );
    if (!rowCount) {
      await this.pool.query(
        `INSERT INTO candidate_profile (user_id, status, profile, edited_at) VALUES ($1, 'ready', $2, now())`,
        [userId, json],
      );
    }
  }

  async getPreferences(userId: string): Promise<JobPreferences | null> {
    const { rows } = await this.pool.query('SELECT preferences FROM job_preferences WHERE user_id = $1', [userId]);
    if (!rows[0]) return null;
    const p = rows[0].preferences;
    return typeof p === 'string' ? JSON.parse(p) : p;
  }

  async savePreferences(userId: string, preferences: JobPreferences): Promise<void> {
    const json = JSON.stringify(preferences);
    const { rowCount } = await this.pool.query(
      'UPDATE job_preferences SET preferences = $2, updated_at = now() WHERE user_id = $1',
      [userId, json],
    );
    if (!rowCount) await this.pool.query('INSERT INTO job_preferences (user_id, preferences) VALUES ($1, $2)', [userId, json]);
  }
}
