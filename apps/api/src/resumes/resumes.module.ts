import { S3Client } from '@aws-sdk/client-s3';
import { Global, Module } from '@nestjs/common';
import { Pool } from 'pg';
import { loadConfig } from '../config/config';
import { PG_POOL } from '../db/database.module';
import { RESUME_FILES, S3ResumeFiles } from './resume-files';
import { ResumeStore } from './resume-store';
import { RESUME_STORE, ResumesService } from './resumes.service';
import { ResumesController } from './resumes.controller';

/**
 * Users' resumes. Global so the identity module can delete a user's files when
 * their account is removed for good.
 */
@Global()
@Module({
  controllers: [ResumesController],
  providers: [
    ResumesService,
    { provide: RESUME_STORE, inject: [PG_POOL], useFactory: (pool: Pool) => new ResumeStore(pool) },
    {
      provide: RESUME_FILES,
      useFactory: () => {
        const { userFiles } = loadConfig();
        // Credentials: your AWS profile locally, the ECS task role in AWS.
        return new S3ResumeFiles(new S3Client({ region: userFiles.region }), userFiles.bucket);
      },
    },
  ],
  exports: [RESUME_FILES],
})
export class ResumesModule {}
