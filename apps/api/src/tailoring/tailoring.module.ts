import { Module } from '@nestjs/common';
import { Pool } from 'pg';
import { loadConfig } from '../config/config';
import { PG_POOL } from '../db/database.module';
import { JobsModule } from '../jobs/jobs.module';
import { ProfileModule } from '../profile/profile.module';
import { DraftStore } from './draft-store';
import { ClaudeResumeTailor, RESUME_TAILOR } from './resume-tailor';
import { TailoringController } from './tailoring.controller';
import { DRAFT_STORE, TailoringService } from './tailoring.service';

/** Resumes tailored to a job: Claude suggests, the user approves, the app builds a Word file. */
@Module({
  imports: [JobsModule, ProfileModule],
  controllers: [TailoringController],
  providers: [
    TailoringService,
    { provide: DRAFT_STORE, inject: [PG_POOL], useFactory: (pool: Pool) => new DraftStore(pool) },
    {
      provide: RESUME_TAILOR,
      // No API key: tailoring is switched off and the page says so.
      useFactory: () => {
        const { ai } = loadConfig();
        return ai.enabled ? new ClaudeResumeTailor(ai.model) : null;
      },
    },
  ],
})
export class TailoringModule {}
