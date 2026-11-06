import { Module } from '@nestjs/common';
import { AdminModule } from './admin/admin.module';
import { AuthModule } from './auth/auth.module';
import { HealthController } from './health/health.controller';
import { MeController } from './me/me.controller';

@Module({
  imports: [AuthModule, AdminModule],
  controllers: [HealthController, MeController],
})
export class AppModule {}
