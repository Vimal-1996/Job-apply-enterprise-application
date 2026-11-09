import { Module } from '@nestjs/common';
import { Pool } from 'pg';
import { loadConfig } from '../config/config';
import { PG_POOL } from '../db/database.module';
import { ClaudeProfileExtractor, PROFILE_EXTRACTOR } from './profile-extractor';
import { ProfileStore } from './profile-store';
import { ProfileController } from './profile.controller';
import { PROFILE_STORE, ProfileService } from './profile.service';

/** Candidate profiles (read from resumes by Claude, edited by users) and job preferences. */
@Module({
  controllers: [ProfileController],
  providers: [
    ProfileService,
    { provide: PROFILE_STORE, inject: [PG_POOL], useFactory: (pool: Pool) => new ProfileStore(pool) },
    {
      provide: PROFILE_EXTRACTOR,
      // No API key: reading resumes is switched off and the page says so.
      useFactory: () => {
        const { ai } = loadConfig();
        return ai.enabled ? new ClaudeProfileExtractor(ai.model) : null;
      },
    },
  ],
})
export class ProfileModule {}
