import { Module } from '@nestjs/common';
import { APP_GUARD } from '@nestjs/core';
import { loadConfig } from '../config/config';
import { TOKEN_VERIFIER } from './auth.types';
import { createCognitoVerifier } from './cognito-verifier';
import { JwtAuthGuard } from './jwt-auth.guard';
import { RolesGuard } from './roles.guard';

@Module({
  providers: [
    {
      provide: TOKEN_VERIFIER,
      useFactory: () => {
        const { cognito } = loadConfig();
        return createCognitoVerifier(cognito.userPoolId, cognito.clientId);
      },
    },
    // Order matters: authenticate first, then authorize.
    { provide: APP_GUARD, useClass: JwtAuthGuard },
    { provide: APP_GUARD, useClass: RolesGuard },
  ],
  exports: [TOKEN_VERIFIER],
})
export class AuthModule {}
