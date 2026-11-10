import { Module } from '@nestjs/common';
import { AdminModule } from './admin/admin.module';
import { AuthModule } from './auth/auth.module';
import { DatabaseModule } from './db/database.module';
import { HealthController } from './health/health.controller';
import { IdentityModule } from './identity/identity.module';
import { InboxModule } from './inbox/inbox.module';
import { MeController } from './me/me.controller';
import { JobsModule } from './jobs/jobs.module';
import { ProfileModule } from './profile/profile.module';
import { TailoringModule } from './tailoring/tailoring.module';
import { ResumesModule } from './resumes/resumes.module';
import { SignupModule } from './signup/signup.module';

@Module({
  imports: [DatabaseModule, ResumesModule, ProfileModule, JobsModule, TailoringModule, InboxModule, IdentityModule, AuthModule, AdminModule, SignupModule],
  controllers: [HealthController, MeController],
})
export class AppModule {}
