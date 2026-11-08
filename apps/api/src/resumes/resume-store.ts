import type { Pool, PoolClient } from 'pg';

export type ResumeStatus = 'pending' | 'ready';

export interface ResumeRow {
  id: string;
  userId: string;
  fileName: string;
  contentType: string;
  sizeBytes: number;
  s3Key: string;
  status: ResumeStatus;
  isCurrent: boolean;
  createdAt: Date;
  uploadedAt: Date | null;
}

const COLUMNS = 'id, user_id, file_name, content_type, size_bytes, s3_key, status, is_current, created_at, uploaded_at';

function toRow(r: Record<string, any>): ResumeRow {
  return {
    id: r.id,
    userId: r.user_id,
    fileName: r.file_name,
    contentType: r.content_type,
    sizeBytes: Number(r.size_bytes),
    s3Key: r.s3_key,
    status: r.status,
    isCurrent: r.is_current,
    createdAt: new Date(r.created_at),
    uploadedAt: r.uploaded_at ? new Date(r.uploaded_at) : null,
  };
}

/** Resume rows in Postgres. Every query is scoped to one user. */
export class ResumeStore {
  constructor(private readonly pool: Pool) {}

  async insertPending(r: Pick<ResumeRow, 'id' | 'userId' | 'fileName' | 'contentType' | 'sizeBytes' | 's3Key'>): Promise<ResumeRow> {
    const { rows } = await this.pool.query(
      `INSERT INTO resume (id, user_id, file_name, content_type, size_bytes, s3_key)
       VALUES ($1, $2, $3, $4, $5, $6) RETURNING ${COLUMNS}`,
      [r.id, r.userId, r.fileName, r.contentType, r.sizeBytes, r.s3Key],
    );
    return toRow(rows[0]);
  }

  async get(userId: string, id: string): Promise<ResumeRow | null> {
    const { rows } = await this.pool.query(`SELECT ${COLUMNS} FROM resume WHERE id = $1 AND user_id = $2`, [id, userId]);
    return rows[0] ? toRow(rows[0]) : null;
  }

  /** Newest first. */
  async list(userId: string, status?: ResumeStatus): Promise<ResumeRow[]> {
    const { rows } = status
      ? await this.pool.query(`SELECT ${COLUMNS} FROM resume WHERE user_id = $1 AND status = $2 ORDER BY created_at DESC, id`, [userId, status])
      : await this.pool.query(`SELECT ${COLUMNS} FROM resume WHERE user_id = $1 ORDER BY created_at DESC, id`, [userId]);
    return rows.map(toRow);
  }

  /** Marks the upload verified and makes it the only current resume, atomically. */
  async markReadyAndCurrent(userId: string, id: string, sizeBytes: number): Promise<void> {
    await this.transaction(async (c) => {
      await c.query('UPDATE resume SET is_current = false WHERE user_id = $1 AND is_current', [userId]);
      await c.query(
        `UPDATE resume SET status = 'ready', is_current = true, size_bytes = $3, uploaded_at = now() WHERE id = $1 AND user_id = $2`,
        [id, userId, sizeBytes],
      );
    });
  }

  async makeCurrent(userId: string, id: string): Promise<void> {
    await this.transaction(async (c) => {
      await c.query('UPDATE resume SET is_current = false WHERE user_id = $1 AND is_current', [userId]);
      await c.query('UPDATE resume SET is_current = true WHERE id = $1 AND user_id = $2', [id, userId]);
    });
  }

  async delete(userId: string, id: string): Promise<void> {
    await this.pool.query('DELETE FROM resume WHERE id = $1 AND user_id = $2', [id, userId]);
  }

  /** Pending uploads requested since `since` (to cap how many links one user can hold). */
  async countPendingSince(userId: string, since: Date): Promise<number> {
    const { rows } = await this.pool.query(
      `SELECT count(*) AS n FROM resume WHERE user_id = $1 AND status = 'pending' AND created_at >= $2`,
      [userId, since],
    );
    return Number(rows[0].n);
  }

  /** Pending rows older than `before`: uploads that were never finished. */
  async stalePending(userId: string, before: Date): Promise<ResumeRow[]> {
    const { rows } = await this.pool.query(
      `SELECT ${COLUMNS} FROM resume WHERE user_id = $1 AND status = 'pending' AND created_at < $2`,
      [userId, before],
    );
    return rows.map(toRow);
  }

  private async transaction(fn: (c: PoolClient) => Promise<void>): Promise<void> {
    const c = await this.pool.connect();
    try {
      await c.query('BEGIN');
      await fn(c);
      await c.query('COMMIT');
    } catch (e) {
      await c.query('ROLLBACK');
      throw e;
    } finally {
      c.release();
    }
  }
}
