import type { Pool } from 'pg';

/**
 * An in-memory Postgres for tests and local development (DATABASE_URL=memory).
 * pg-mem is a dev dependency, so it is loaded lazily and is never present in
 * the production image.
 */
export function memoryPool(): Pool {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const { DataType, newDb } = require('pg-mem') as typeof import('pg-mem');
  const db = newDb();
  // Advisory locks aren't emulated; a single process needs none.
  for (const name of ['pg_advisory_lock', 'pg_advisory_unlock']) {
    db.public.registerFunction({ name, args: [DataType.integer], returns: DataType.bool, implementation: () => true });
  }
  // Built-ins pg-mem lacks, with Postgres semantics.
  db.public.registerFunction({
    name: 'left',
    args: [DataType.text, DataType.integer],
    returns: DataType.text,
    implementation: (s: string, n: number) => s.slice(0, n),
  });
  const { Pool: MemPool } = db.adapters.createPg();
  return new MemPool() as Pool;
}
