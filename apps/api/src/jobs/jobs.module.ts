import { Module } from '@nestjs/common';
import { Pool } from 'pg';
import { loadConfig } from '../config/config';
import { PG_POOL } from '../db/database.module';
import { ProfileModule } from '../profile/profile.module';
import { ClaudeJobMatcher, JOB_MATCHER } from './job-matcher';
import { JobStore } from './job-store';
import { JobsController } from './jobs.controller';
import { JOB_STORE, JobsService } from './jobs.service';

/** Jobs the user adds by pasting them, matched against their profile by Claude. */
@Module({
  imports: [ProfileModule],
  controllers: [JobsController],
  providers: [
    JobsService,
    { provide: JOB_STORE, inject: [PG_POOL], useFactory: (pool: Pool) => new JobStore(pool) },
    {
      provide: JOB_MATCHER,
      // No API key: matching is switched off and the page says so.
      useFactory: () => {
        const { ai } = loadConfig();
        return ai.enabled ? new ClaudeJobMatcher(ai.model) : null;
      },
    },
  ],
})
export class JobsModule {}
