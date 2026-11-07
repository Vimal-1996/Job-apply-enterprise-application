import { randomBytes } from 'crypto';
import { Pool } from 'pg';
import { memoryPool } from './pg-mem';

const opened: Pool[] = [];

/**
 * A fresh, empty database for one test: a throwaway schema on the real
 * Postgres in TEST_DATABASE_URL (CI runs one), otherwise in-memory pg-mem.
 */
export async function testPool(): Promise<Pool> {
  const url = process.env.TEST_DATABASE_URL;
  if (!url) return memoryPool();
  const schema = `t_${randomBytes(6).toString('hex')}`;
  const admin = new Pool({ connectionString: url });
  await admin.query(`CREATE SCHEMA ${schema}`);
  await admin.end();
  const pool = new Pool({ connectionString: url, options: `-c search_path=${schema}`, max: 2 });
  opened.push(pool);
  return pool;
}

/** Call from afterAll so Jest can exit. */
export async function closeTestPools(): Promise<void> {
  await Promise.all(opened.splice(0).map((p) => p.end()));
}
