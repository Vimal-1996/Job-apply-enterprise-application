import { Module } from '@nestjs/common';
import { AdminController } from './admin/admin.controller';
import { AuthModule } from './auth/auth.module';
import { HealthController } from './health/health.controller';
import { MeController } from './me/me.controller';

@Module({
  imports: [AuthModule],
  controllers: [HealthController, MeController, AdminController],
})
export class AppModule {}
