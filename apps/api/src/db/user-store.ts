import type { Pool } from 'pg';
import { AccountStatus, Role } from '../auth/auth.types';

export interface UserRow {
  id: string;
  email: string;
  role: Role;
  accountStatus: AccountStatus;
  createdAt: Date;
  updatedAt: Date;
  signedInAt: Date | null;
}

export interface UserListQuery {
  role?: Role;
  /** Case-insensitive email prefix. */
  search?: string;
  /** Opaque cursor from a previous page. */
  cursor?: string;
  limit: number;
}

export type NewUserRow = Pick<UserRow, 'id' | 'email' | 'role' | 'accountStatus'> & { signedInAt?: Date | null };

/** The app's own user records (Postgres). */
export interface UserStore {
  get(id: string): Promise<UserRow | null>;
  getByEmail(email: string): Promise<UserRow | null>;
  /** Inserts, or updates email/role/status if the id already exists. */
  upsert(row: NewUserRow): Promise<UserRow>;
  update(id: string, patch: Partial<Pick<UserRow, 'role' | 'accountStatus' | 'signedInAt'>>): Promise<void>;
  delete(id: string): Promise<void>;
  list(q: UserListQuery): Promise<{ rows: UserRow[]; nextCursor: string | null }>;
}

const COLUMNS = 'id, email, role, account_status, created_at, updated_at, signed_in_at';

function toRow(r: Record<string, any>): UserRow {
  return {
    id: r.id,
    email: r.email,
    role: r.role,
    accountStatus: r.account_status,
    createdAt: new Date(r.created_at),
    updatedAt: new Date(r.updated_at),
    signedInAt: r.signed_in_at ? new Date(r.signed_in_at) : null,
  };
}

/** Cursor = the last row's (email, id), so pages stay stable while users are added. */
export function encodeCursor(email: string, id: string): string {
  return Buffer.from(JSON.stringify([email, id])).toString('base64url');
}

export function decodeCursor(cursor: string): [string, string] | null {
  try {
    const v = JSON.parse(Buffer.from(cursor, 'base64url').toString('utf8'));
    return Array.isArray(v) && v.length === 2 && v.every((x) => typeof x === 'string') ? [v[0], v[1]] : null;
  } catch {
    return null;
  }
}

export class PgUserStore implements UserStore {
  constructor(private readonly pool: Pool) {}

  async get(id: string): Promise<UserRow | null> {
    const { rows } = await this.pool.query(`SELECT ${COLUMNS} FROM app_user WHERE id = $1`, [id]);
    return rows[0] ? toRow(rows[0]) : null;
  }

  async getByEmail(email: string): Promise<UserRow | null> {
    const { rows } = await this.pool.query(`SELECT ${COLUMNS} FROM app_user WHERE email = $1`, [email.toLowerCase()]);
    return rows[0] ? toRow(rows[0]) : null;
  }

  async upsert(row: NewUserRow): Promise<UserRow> {
    const { rows } = await this.pool.query(
      `INSERT INTO app_user (id, email, role, account_status, signed_in_at)
       VALUES ($1, $2, $3, $4, $5)
       ON CONFLICT (id) DO UPDATE SET email = EXCLUDED.email, role = EXCLUDED.role,
         account_status = EXCLUDED.account_status, updated_at = now()
       RETURNING ${COLUMNS}`,
      [row.id, row.email.toLowerCase(), row.role, row.accountStatus, row.signedInAt ?? null],
    );
    return toRow(rows[0]);
  }

  async update(id: string, patch: Partial<Pick<UserRow, 'role' | 'accountStatus' | 'signedInAt'>>): Promise<void> {
    const sets: string[] = [];
    const values: unknown[] = [];
    const add = (col: string, v: unknown) => {
      values.push(v);
      sets.push(`${col} = $${values.length}`);
    };
    if (patch.role !== undefined) add('role', patch.role);
    if (patch.accountStatus !== undefined) add('account_status', patch.accountStatus);
    if (patch.signedInAt !== undefined) add('signed_in_at', patch.signedInAt);
    if (!sets.length) return;
    values.push(id);
    await this.pool.query(`UPDATE app_user SET ${sets.join(', ')}, updated_at = now() WHERE id = $${values.length}`, values);
  }

  async delete(id: string): Promise<void> {
    await this.pool.query('DELETE FROM app_user WHERE id = $1', [id]);
  }

  async list(q: UserListQuery): Promise<{ rows: UserRow[]; nextCursor: string | null }> {
    const where: string[] = [];
    const values: unknown[] = [];
    const param = (v: unknown) => {
      values.push(v);
      return `$${values.length}`;
    };
    if (q.role) where.push(`role = ${param(q.role)}`);
    // Exact prefix comparison: no LIKE wildcards to escape in user input.
    if (q.search) {
      const prefix = q.search.toLowerCase();
      where.push(`left(email, ${param(prefix.length)}::int) = ${param(prefix)}`);
    }
    const after = q.cursor ? decodeCursor(q.cursor) : null;
    if (after) {
      const e = param(after[0]);
      where.push(`(email > ${e} OR (email = ${e} AND id > ${param(after[1])}))`);
    }
    const sql = `SELECT ${COLUMNS} FROM app_user ${where.length ? `WHERE ${where.join(' AND ')}` : ''}
                 ORDER BY email, id LIMIT ${param(q.limit + 1)}`;
    const { rows } = await this.pool.query(sql, values);
    const page = rows.slice(0, q.limit).map(toRow);
    const last = page[page.length - 1];
    return { rows: page, nextCursor: rows.length > q.limit && last ? encodeCursor(last.email, last.id) : null };
  }
}
