import type { Pool } from 'pg';
import { CandidateProfile } from '../profile/profile.schema';
import { Gap, Suggestion } from './tailoring.schema';

export type DraftStatus = 'suggesting' | 'ready' | 'failed';
export type ScoreStatus = 'scoring' | 'ready' | 'failed';
export type RunKind = 'suggest' | 'score' | 'gap';

/** One resume's match against the job: the score, its verdict and why. */
export interface ScoredMatch {
  score: number;
  verdict: string;
  summary: string;
  gaps: string[];
}

/** The original and tailored resume, matched side by side. */
export interface TailoredScore {
  original: ScoredMatch;
  tailored: ScoredMatch;
}

export interface DraftRow {
  jobId: string;
  userId: string;
  status: DraftStatus;
  runId: string | null;
  baseProfile: CandidateProfile | null;
  suggestions: Suggestion[] | null;
  suggestionsId: string | null;
  /** The job's gaps and the user's answers (null on drafts made before gaps). */
  gaps: Gap[] | null;
  error: string | null;
  suggestedAt: Date | null;
  updatedAt: Date;
  scoreStatus: ScoreStatus | null;
  scoreRunId: string | null;
  score: TailoredScore | null;
  scoreError: string | null;
  /** Identifies the decisions that were scored. */
  scoreBasis: string | null;
  scoreStartedAt: Date | null;
  scoredAt: Date | null;
}

const COLUMNS =
  'job_id, user_id, status, run_id, base_profile, suggestions, suggestions_id, error, suggested_at, updated_at, score_status, score_run_id, score, score_error, score_basis, score_started_at, scored_at, gaps';
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
    gaps: json(r.gaps),
    error: r.error,
    suggestedAt: r.suggested_at ? new Date(r.suggested_at) : null,
    updatedAt: new Date(r.updated_at),
    scoreStatus: r.score_status ?? null,
    scoreRunId: r.score_run_id ?? null,
    score: json(r.score),
    scoreError: r.score_error ?? null,
    scoreBasis: r.score_basis ?? null,
    scoreStartedAt: r.score_started_at ? new Date(r.score_started_at) : null,
    scoredAt: r.scored_at ? new Date(r.scored_at) : null,
  };
}

/** Tailored-resume drafts in Postgres, one per job. Every query is scoped to one user. */
export class DraftStore {
  constructor(private readonly pool: Pool) {}

  async get(userId: string, jobId: string): Promise<DraftRow | null> {
    const { rows } = await this.pool.query(`SELECT ${COLUMNS} FROM resume_draft WHERE user_id = $1 AND job_id = $2`, [userId, jobId]);
    return rows[0] ? toRow(rows[0]) : null;
  }

  /** How many runs of this kind the user started in the last day. */
  async runsLastDay(userId: string, kind: RunKind = 'suggest'): Promise<number> {
    const { rows } = await this.pool.query('SELECT count(*) AS n FROM tailoring_run WHERE user_id = $1 AND created_at > $2 AND kind = $3', [
      userId,
      new Date(Date.now() - 24 * 60 * 60_000),
      kind,
    ]);
    return Number(rows[0].n);
  }

  /** Starts scoring the draft unless a score is already running and not yet stale. False if not started. */
  async startScore(userId: string, jobId: string, runId: string, staleBefore: Date): Promise<boolean> {
    const { rowCount } = await this.pool.query(
      `UPDATE resume_draft SET score_status = 'scoring', score_run_id = $3, score_error = NULL, score_started_at = now()
        WHERE user_id = $1 AND job_id = $2 AND suggestions IS NOT NULL
          AND (score_status IS NULL OR score_status <> 'scoring' OR score_started_at < $4)`,
      [userId, jobId, runId, staleBefore],
    );
    if (rowCount !== 1) return false;
    await this.pool.query("INSERT INTO tailoring_run (user_id, kind) VALUES ($1, 'score')", [userId]);
    return true;
  }

  async finishScore(userId: string, jobId: string, runId: string, score: TailoredScore, basis: string): Promise<void> {
    await this.pool.query(
      `UPDATE resume_draft SET score_status = 'ready', score = $4, score_basis = $5, score_error = NULL, score_run_id = NULL, scored_at = now()
        WHERE user_id = $1 AND job_id = $2 AND score_run_id = $3`,
      [userId, jobId, runId, JSON.stringify(score), basis],
    );
  }

  /** Records why scoring failed; a previous score stays. */
  async failScore(userId: string, jobId: string, runId: string, error: string): Promise<void> {
    await this.pool.query(
      `UPDATE resume_draft SET score_status = 'failed', score_error = $4, score_run_id = NULL WHERE user_id = $1 AND job_id = $2 AND score_run_id = $3`,
      [userId, jobId, runId, error],
    );
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
  async finish(userId: string, jobId: string, runId: string, baseProfile: CandidateProfile, suggestions: Suggestion[], gaps: Gap[]): Promise<boolean> {
    const { rowCount } = await this.pool.query(
      `UPDATE resume_draft SET status = 'ready', base_profile = $4, suggestions = $5, suggestions_id = $3, gaps = $6, error = NULL, suggested_at = now(), run_id = NULL, updated_at = now(),
         score_status = NULL, score = NULL, score_error = NULL, score_basis = NULL, scored_at = NULL
        WHERE user_id = $1 AND job_id = $2 AND run_id = $3`,
      [userId, jobId, runId, JSON.stringify(baseProfile), JSON.stringify(suggestions), JSON.stringify(gaps)],
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

  /** Saves gap answers and the suggestions together, against the current set only. False if it was replaced. */
  async saveGaps(userId: string, jobId: string, suggestionsId: string, gaps: Gap[], suggestions: Suggestion[]): Promise<boolean> {
    const { rowCount } = await this.pool.query(
      `UPDATE resume_draft SET gaps = $4, suggestions = $5, updated_at = now() WHERE user_id = $1 AND job_id = $2 AND suggestions_id = $3`,
      [userId, jobId, suggestionsId, JSON.stringify(gaps), JSON.stringify(suggestions)],
    );
    return rowCount === 1;
  }

  /** Counts a Claude call of this kind towards the user's daily cap. */
  async recordRun(userId: string, kind: RunKind): Promise<void> {
    await this.pool.query('INSERT INTO tailoring_run (user_id, kind) VALUES ($1, $2)', [userId, kind]);
  }
}
