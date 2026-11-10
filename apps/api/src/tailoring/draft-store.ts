import type { Pool } from 'pg';
import { CandidateProfile } from '../profile/profile.schema';
import { Suggestion } from './tailoring.schema';

export type DraftStatus = 'suggesting' | 'ready' | 'failed';

export interface DraftRow {
  jobId: string;
  userId: string;
  status: DraftStatus;
  runId: string | null;
  baseProfile: CandidateProfile | null;
  suggestions: Suggestion[] | null;
  suggestionsId: string | null;
  error: string | null;
  suggestedAt: Date | null;
  updatedAt: Date;
}

const COLUMNS = 'job_id, user_id, status, run_id, base_profile, suggestions, suggestions_id, error, suggested_at, updated_at';
const json = (v: unknown) => (typeof v === 'string' ? JSON.parse(v) : (v ?? null));

function toRow(r: Record<string, any>): DraftRow {
  return {
    jobId: r.job_id,
    userId: r.user_id,
    status: r.status,
    runId: r.run_id,
    baseProfile: json(r.base_profile),
    suggestions: json(r.suggestions),
    suggestionsId: r.suggestions_id,
    error: r.error,
    suggestedAt: r.suggested_at ? new Date(r.suggested_at) : null,
    updatedAt: new Date(r.updated_at),
  };
}

/** Tailored-resume drafts in Postgres, one per job. Every query is scoped to one user. */
export class DraftStore {
  constructor(private readonly pool: Pool) {}

  async get(userId: string, jobId: string): Promise<DraftRow | null> {
    const { rows } = await this.pool.query(`SELECT ${COLUMNS} FROM resume_draft WHERE user_id = $1 AND job_id = $2`, [userId, jobId]);
    return rows[0] ? toRow(rows[0]) : null;
  }

  /** How many tailorings the user started in the last day. */
  async runsLastDay(userId: string): Promise<number> {
    const { rows } = await this.pool.query('SELECT count(*) AS n FROM tailoring_run WHERE user_id = $1 AND created_at > $2', [
      userId,
      new Date(Date.now() - 24 * 60 * 60_000),
    ]);
    return Number(rows[0].n);
  }

  /**
   * Starts a new tailoring, keeping the previous suggestions until it finishes,
   * unless one is already running and not yet stale. False if not started.
   */
  async start(userId: string, jobId: string, runId: string, staleBefore: Date): Promise<boolean> {
    if (await this.get(userId, jobId)) {
      // Checked in the update itself, so two requests at once can't both start one.
      const { rowCount } = await this.pool.query(
        `UPDATE resume_draft SET status = 'suggesting', run_id = $3, error = NULL, updated_at = now()
          WHERE user_id = $1 AND job_id = $2 AND (status <> 'suggesting' OR updated_at < $4)`,
        [userId, jobId, runId, staleBefore],
      );
      if (rowCount !== 1) return false;
    } else {
      const { rowCount } = await this.pool.query(
        `INSERT INTO resume_draft (job_id, user_id, status, run_id) VALUES ($1, $2, 'suggesting', $3) ON CONFLICT (job_id) DO NOTHING`,
        [jobId, userId, runId],
      );
      if (rowCount !== 1) return false;
    }
    await this.pool.query('INSERT INTO tailoring_run (user_id) VALUES ($1)', [userId]);
    return true;
  }

  /** Stores finished suggestions. False if a newer run replaced this one, or the job was deleted. */
  async finish(userId: string, jobId: string, runId: string, baseProfile: CandidateProfile, suggestions: Suggestion[]): Promise<boolean> {
    const { rowCount } = await this.pool.query(
      `UPDATE resume_draft SET status = 'ready', base_profile = $4, suggestions = $5, suggestions_id = $3, error = NULL, suggested_at = now(), run_id = NULL, updated_at = now()
        WHERE user_id = $1 AND job_id = $2 AND run_id = $3`,
      [userId, jobId, runId, JSON.stringify(baseProfile), JSON.stringify(suggestions)],
    );
    return rowCount === 1;
  }

  /** Records why a run failed; any previous suggestions stay. */
  async fail(userId: string, jobId: string, runId: string, error: string): Promise<void> {
    await this.pool.query(
      `UPDATE resume_draft SET status = 'failed', error = $4, run_id = NULL, updated_at = now() WHERE user_id = $1 AND job_id = $2 AND run_id = $3`,
      [userId, jobId, runId, error],
    );
  }

  /**
   * Saves the user's decisions, only if the suggestions weren't replaced
   * meanwhile. Compared by id, not by timestamp: Postgres keeps microseconds
   * that a JavaScript Date loses, so a timestamp read back never matches.
   */
  async saveSuggestions(userId: string, jobId: string, suggestionsId: string, suggestions: Suggestion[]): Promise<boolean> {
    const { rowCount } = await this.pool.query(
      `UPDATE resume_draft SET suggestions = $4, updated_at = now() WHERE user_id = $1 AND job_id = $2 AND suggestions_id = $3`,
      [userId, jobId, suggestionsId, JSON.stringify(suggestions)],
    );
    return rowCount === 1;
  }
}
