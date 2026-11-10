import { Pool } from 'pg';
import { ApplicationStatus } from '../jobs/job-store';
import { EmailCategory } from './email.schema';
import { fromStored, TimeRange, toStored } from './read-ranges';

export type ConnectionStatus = 'connected' | 'expired';
export type SyncStatus = 'idle' | 'syncing' | 'failed';
export type LinkSource = 'ai' | 'thread' | 'user';
export type SuggestionState = 'pending' | 'accepted' | 'dismissed';

export interface ConnectionRow {
  userId: string;
  email: string;
  refreshTokenEnc: string;
  scopes: string;
  status: ConnectionStatus;
  syncStatus: SyncStatus;
  syncRunId: string | null;
  syncError: string | null;
  syncStartedAt: Date | null;
  lastSyncedAt: Date | null;
  connectedAt: Date;
  /** What's been read from Gmail so far, merged. */
  readRanges: TimeRange[];
}

export interface EmailRow {
  id: string;
  userId: string;
  gmailId: string;
  threadId: string;
  fromName: string | null;
  fromAddress: string;
  subject: string;
  receivedAt: Date;
  jobRelated: boolean;
  category: EmailCategory;
  summary: string | null;
  action: string | null;
  actionDue: string | null;
  company: string | null;
  jobId: string | null;
  linkSource: LinkSource | null;
  suggestedStatus: ApplicationStatus | null;
  suggestionState: SuggestionState | null;
  createdAt: Date;
}

export type NewEmail = Omit<EmailRow, 'createdAt'>;

const CONNECTION = `user_id, email, refresh_token_enc, scopes, status, sync_status, sync_run_id, sync_error, sync_started_at, last_synced_at, connected_at, read_ranges`;
const EMAIL = `id, user_id, gmail_id, thread_id, from_name, from_address, subject, received_at, job_related, category, summary, action, action_due,
  company, job_id, link_source, suggested_status, suggestion_state, created_at`;

const date = (v: unknown) => (v ? new Date(v as string) : null);

function toConnection(r: Record<string, unknown>): ConnectionRow {
  return {
    userId: r.user_id as string,
    email: r.email as string,
    refreshTokenEnc: r.refresh_token_enc as string,
    scopes: r.scopes as string,
    status: r.status as ConnectionStatus,
    syncStatus: r.sync_status as SyncStatus,
    syncRunId: (r.sync_run_id as string) ?? null,
    syncError: (r.sync_error as string) ?? null,
    syncStartedAt: date(r.sync_started_at),
    lastSyncedAt: date(r.last_synced_at),
    connectedAt: new Date(r.connected_at as string),
    readRanges: fromStored(typeof r.read_ranges === 'string' ? JSON.parse(r.read_ranges) : r.read_ranges),
  };
}

function toEmail(r: Record<string, unknown>): EmailRow {
  return {
    id: r.id as string,
    userId: r.user_id as string,
    gmailId: r.gmail_id as string,
    threadId: r.thread_id as string,
    fromName: (r.from_name as string) ?? null,
    fromAddress: r.from_address as string,
    subject: r.subject as string,
    receivedAt: new Date(r.received_at as string),
    jobRelated: Boolean(r.job_related),
    category: r.category as EmailCategory,
    summary: (r.summary as string) ?? null,
    action: (r.action as string) ?? null,
    actionDue: (r.action_due as string) ?? null,
    company: (r.company as string) ?? null,
    jobId: (r.job_id as string) ?? null,
    linkSource: (r.link_source as LinkSource) ?? null,
    suggestedStatus: (r.suggested_status as ApplicationStatus) ?? null,
    suggestionState: (r.suggestion_state as SuggestionState) ?? null,
    createdAt: new Date(r.created_at as string),
  };
}

/** The user's Gmail connection and the job emails read from it. */
export class InboxStore {
  constructor(private readonly pool: Pool) {}

  async connection(userId: string): Promise<ConnectionRow | null> {
    const { rows } = await this.pool.query(`SELECT ${CONNECTION} FROM gmail_connection WHERE user_id = $1`, [userId]);
    return rows[0] ? toConnection(rows[0]) : null;
  }

  /** Connects (or reconnects) Gmail. Another account's emails are removed first, so they never mix. */
  async saveConnection(userId: string, email: string, refreshTokenEnc: string, scopes: string): Promise<void> {
    const existing = await this.connection(userId);
    if (existing && existing.email.toLowerCase() !== email.toLowerCase()) {
      await this.pool.query('DELETE FROM inbox_email WHERE user_id = $1', [userId]);
      await this.pool.query('DELETE FROM gmail_connection WHERE user_id = $1', [userId]);
    }
    if (existing && existing.email.toLowerCase() === email.toLowerCase()) {
      await this.pool.query(
        `UPDATE gmail_connection SET refresh_token_enc = $2, scopes = $3, status = 'connected', sync_status = 'idle', sync_run_id = NULL, sync_error = NULL,
           connected_at = now() WHERE user_id = $1`,
        [userId, refreshTokenEnc, scopes],
      );
    } else {
      await this.pool.query('INSERT INTO gmail_connection (user_id, email, refresh_token_enc, scopes) VALUES ($1, $2, $3, $4)', [
        userId,
        email,
        refreshTokenEnc,
        scopes,
      ]);
    }
  }

  async setExpired(userId: string): Promise<void> {
    await this.pool.query(
      `UPDATE gmail_connection SET status = 'expired', sync_status = 'idle', sync_run_id = NULL WHERE user_id = $1`,
      [userId],
    );
  }

  /** Removes the connection and every email read from it. */
  async disconnect(userId: string): Promise<void> {
    await this.pool.query('DELETE FROM inbox_email WHERE user_id = $1', [userId]);
    await this.pool.query('DELETE FROM gmail_connection WHERE user_id = $1', [userId]);
  }

  /** Starts a sync unless one is already running (one stuck since `staleBefore` doesn't count). */
  async startSync(userId: string, runId: string, staleBefore: Date): Promise<boolean> {
    const { rowCount } = await this.pool.query(
      `UPDATE gmail_connection SET sync_status = 'syncing', sync_run_id = $2, sync_error = NULL, sync_started_at = now()
        WHERE user_id = $1 AND status = 'connected' AND (sync_status <> 'syncing' OR sync_started_at < $3)`,
      [userId, runId, staleBefore],
    );
    return rowCount === 1;
  }

  /** Ends a sync. `syncedThrough` (when the sync started) is set only when everything found was read. */
  async finishSync(userId: string, runId: string, syncedThrough: Date | null, note: string | null): Promise<void> {
    await this.pool.query(
      `UPDATE gmail_connection SET sync_status = 'idle', sync_run_id = NULL, sync_error = $4,
         last_synced_at = coalesce($3, last_synced_at) WHERE user_id = $1 AND sync_run_id = $2`,
      [userId, runId, syncedThrough, note],
    );
  }

  async failSync(userId: string, runId: string, message: string): Promise<void> {
    await this.pool.query(
      `UPDATE gmail_connection SET sync_status = 'failed', sync_run_id = NULL, sync_error = $3 WHERE user_id = $1 AND sync_run_id = $2`,
      [userId, runId, message],
    );
  }

  /** Every email already read for the user, with when it was received. */
  async knownGmailIds(userId: string): Promise<Map<string, Date>> {
    const { rows } = await this.pool.query('SELECT gmail_id, received_at FROM inbox_email WHERE user_id = $1', [userId]);
    return new Map(rows.map((r) => [r.gmail_id as string, new Date(r.received_at as string)]));
  }

  async setReadRanges(userId: string, ranges: TimeRange[]): Promise<void> {
    await this.pool.query('UPDATE gmail_connection SET read_ranges = $2 WHERE user_id = $1', [userId, JSON.stringify(toStored(ranges))]);
  }

  /** How many emails were read for the user since `since` (each one costs a little Claude time). */
  async readSince(userId: string, since: Date): Promise<number> {
    const { rows } = await this.pool.query('SELECT count(*) AS n FROM inbox_email WHERE user_id = $1 AND created_at > $2', [userId, since]);
    return Number(rows[0].n);
  }

  async insert(e: NewEmail): Promise<void> {
    await this.pool.query(
      `INSERT INTO inbox_email (id, user_id, gmail_id, thread_id, from_name, from_address, subject, received_at, job_related, category, summary,
         action, action_due, company, job_id, link_source, suggested_status, suggestion_state)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17, $18)
       ON CONFLICT (user_id, gmail_id) DO NOTHING`,
      [
        e.id,
        e.userId,
        e.gmailId,
        e.threadId,
        e.fromName,
        e.fromAddress,
        e.subject,
        e.receivedAt,
        e.jobRelated,
        e.category,
        e.summary,
        e.action,
        e.actionDue,
        e.company,
        e.jobId,
        e.linkSource,
        e.suggestedStatus,
        e.suggestionState,
      ],
    );
  }

  /** The job another email in this Gmail thread is linked to, if any. */
  async threadJob(userId: string, threadId: string): Promise<string | null> {
    const { rows } = await this.pool.query(
      'SELECT job_id FROM inbox_email WHERE user_id = $1 AND thread_id = $2 AND job_id IS NOT NULL ORDER BY received_at DESC LIMIT 1',
      [userId, threadId],
    );
    return (rows[0]?.job_id as string) ?? null;
  }

  /** Links the thread's other unlinked job emails to the same job. */
  async linkThread(userId: string, threadId: string, jobId: string): Promise<void> {
    await this.pool.query(
      `UPDATE inbox_email SET job_id = $3, link_source = 'thread'
        WHERE user_id = $1 AND thread_id = $2 AND job_id IS NULL AND job_related = true`,
      [userId, threadId, jobId],
    );
  }

  /** The user's job emails (not the ones found not to be about a job), newest first; optionally one job's, or a time window. */
  async list(userId: string, filter: { jobId?: string; since?: Date; until?: Date } = {}): Promise<EmailRow[]> {
    const where = ['user_id = $1', 'job_related = true'];
    const args: unknown[] = [userId];
    const param = (v: unknown) => `$${args.push(v)}`;
    if (filter.jobId) where.push(`job_id = ${param(filter.jobId)}`);
    if (filter.since) where.push(`received_at >= ${param(filter.since)}`);
    if (filter.until) where.push(`received_at < ${param(filter.until)}`);
    const { rows } = await this.pool.query(`SELECT ${EMAIL} FROM inbox_email WHERE ${where.join(' AND ')} ORDER BY received_at DESC, id`, args);
    return rows.map(toEmail);
  }

  async get(userId: string, id: string): Promise<EmailRow | null> {
    const { rows } = await this.pool.query(`SELECT ${EMAIL} FROM inbox_email WHERE user_id = $1 AND id = $2`, [userId, id]);
    return rows[0] ? toEmail(rows[0]) : null;
  }

  /** The user links the email to a job (or unlinks it); a stage suggestion starts over for the new job. */
  async setLink(userId: string, id: string, jobId: string | null): Promise<void> {
    await this.pool.query(
      `UPDATE inbox_email SET job_id = $3, link_source = CASE WHEN $3::text IS NULL THEN NULL ELSE 'user' END,
         suggestion_state = CASE WHEN $3::text IS NULL OR suggested_status IS NULL THEN NULL ELSE 'pending' END
        WHERE user_id = $1 AND id = $2`,
      [userId, id, jobId],
    );
  }

  async setSuggestionState(userId: string, id: string, state: SuggestionState): Promise<void> {
    await this.pool.query('UPDATE inbox_email SET suggestion_state = $3 WHERE user_id = $1 AND id = $2', [userId, id, state]);
  }
}
