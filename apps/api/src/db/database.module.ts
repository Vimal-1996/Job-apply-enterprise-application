import { Global, Inject, Logger, Module, OnApplicationShutdown } from '@nestjs/common';
import { readFileSync } from 'fs';
import { Pool } from 'pg';
import { DatabaseConfig, loadConfig } from '../config/config';
import { migrate } from './migrate';
import { memoryPool } from './pg-mem';
import { PgUserStore } from './user-store';

export const PG_POOL = Symbol('PG_POOL');
export const USER_STORE = Symbol('USER_STORE');

export function createPool(db: DatabaseConfig): Pool {
  if (db.kind === 'memory') {
    new Logger('Database').warn('Using an in-memory database: data is lost on restart (local development only)');
    return memoryPool();
  }
  return new Pool({
    host: db.host,
    port: db.port,
    database: db.database,
    user: db.user,
    password: db.password,
    max: db.poolSize,
    idleTimeoutMillis: 30_000,
    connectionTimeoutMillis: 5_000,
    ssl: db.ssl === false ? false : { rejectUnauthorized: true, ca: db.ssl.caFile ? readFileSync(db.ssl.caFile, 'utf8') : undefined },
  });
}

/** Postgres pool (migrated at startup) and the user store. Global: the identity module needs it. */
@Global()
@Module({
  providers: [
    {
      provide: PG_POOL,
      useFactory: async () => {
        const pool = createPool(loadConfig().database);
        await migrate(pool); // advisory-locked, so concurrent instances are safe
        return pool;
      },
    },
    { provide: USER_STORE, inject: [PG_POOL], useFactory: (pool: Pool) => new PgUserStore(pool) },
  ],
  exports: [PG_POOL, USER_STORE],
})
export class DatabaseModule implements OnApplicationShutdown {
  constructor(@Inject(PG_POOL) private readonly pool: Pool) {}

  async onApplicationShutdown() {
    await this.pool.end();
  }
}
