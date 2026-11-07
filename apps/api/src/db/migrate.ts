import { Logger } from '@nestjs/common';
import { readdirSync, readFileSync } from 'fs';
import { join } from 'path';
import type { Pool } from 'pg';

const logger = new Logger('Migrations');
// Any fixed number; all API instances use it so only one migrates at a time.
const LOCK_ID = 727_001;

/** Default location: <repo>/db/migrations in a checkout; the image sets MIGRATIONS_DIR. */
export function defaultMigrationsDir(): string {
  return process.env.MIGRATIONS_DIR ?? join(__dirname, '..', '..', '..', '..', 'db', 'migrations');
}

/**
 * Applies pending `NNN_name.sql` files in order, each in its own transaction,
 * recording them in schema_migrations. Safe to run from every instance at
 * startup: an advisory lock serialises them and later ones find nothing to do.
 */
export async function migrate(pool: Pool, dir = defaultMigrationsDir()): Promise<string[]> {
  const files = readdirSync(dir)
    .filter((f) => /^\d+_.+\.sql$/.test(f))
    .sort();
  const client = await pool.connect();
  const applied: string[] = [];
  try {
    await client.query('SELECT pg_advisory_lock($1)', [LOCK_ID]);
    const exists = await client.query(
      "SELECT 1 FROM information_schema.tables WHERE table_schema = current_schema() AND table_name = 'schema_migrations'",
    );
    if (!exists.rowCount) {
      await client.query('CREATE TABLE schema_migrations (version text PRIMARY KEY, applied_at timestamptz NOT NULL DEFAULT now())');
    }
    const done = new Set((await client.query('SELECT version FROM schema_migrations')).rows.map((r) => r.version));
    for (const file of files) {
      if (done.has(file)) continue;
      await client.query('BEGIN');
      try {
        await client.query(readFileSync(join(dir, file), 'utf8'));
        await client.query('INSERT INTO schema_migrations (version) VALUES ($1)', [file]);
        await client.query('COMMIT');
      } catch (e) {
        await client.query('ROLLBACK');
        throw new Error(`migration ${file} failed: ${(e as Error).message}`);
      }
      applied.push(file);
      logger.log(`applied ${file}`);
    }
    return applied;
  } finally {
    await client.query('SELECT pg_advisory_unlock($1)', [LOCK_ID]).catch(() => undefined);
    client.release();
  }
}
