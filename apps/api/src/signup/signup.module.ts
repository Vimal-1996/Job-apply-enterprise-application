import { Module } from '@nestjs/common';
import { loadConfig } from '../config/config';
import { WindowCounter } from './rate-limiter';
import { SIGNUP_LIMITS, SignupController, SignupLimits } from './signup.controller';

const HOUR = 60 * 60 * 1000;

// USER_DIRECTORY comes from the global IdentityModule.
@Module({
  controllers: [SignupController],
  providers: [
    {
      provide: SIGNUP_LIMITS,
      useFactory: (): SignupLimits => {
        const { signup } = loadConfig();
        return { perIp: new WindowCounter(signup.perIpPerHour, HOUR), global: new WindowCounter(signup.perDay, 24 * HOUR) };
      },
    },
  ],
})
export class SignupModule {}
