import { CognitoIdentityProviderClient } from '@aws-sdk/client-cognito-identity-provider';
import { Global, Logger, Module } from '@nestjs/common';
import { AccountStatusCache, MfaCache } from '../auth/account-status-cache';
import { ACCOUNT_STATUS, MFA_LOOKUP } from '../auth/auth.types';
import { CognitoUserDirectory } from '../admin/users/cognito-user-directory';
import { DbUserDirectory } from '../admin/users/db-user-directory';
import { USER_STORE } from '../db/database.module';
import { UserStore } from '../db/user-store';
import { USER_DIRECTORY, UserDirectory } from '../admin/users/user.types';
import { loadConfig } from '../config/config';

const logger = new Logger('Identity');

/**
 * Users: the app's Postgres table, with Cognito for credentials, invitation
 * emails, sign-out, MFA and the admin role. Global because both
 * authentication (every request checks account status) and the admin console
 * need it, and they must share one status cache so admin changes invalidate it.
 */
@Global()
@Module({
  providers: [
    {
      provide: USER_DIRECTORY,
      inject: [USER_STORE],
      useFactory: (store: UserStore) => {
        const { cognito } = loadConfig();
        // Credentials come from the default chain: your AWS profile locally,
        // the ECS task role in AWS. Region is the prefix of the pool id.
        const region = cognito.userPoolId.split('_')[0];
        const pool = new CognitoUserDirectory(new CognitoIdentityProviderClient({ region }), cognito.userPoolId);
        const directory = new DbUserDirectory(store, pool);
        if (process.env.SYNC_USERS_ON_START === 'true') {
          // Background, so startup isn't blocked; users are also added lazily when first seen.
          directory
            .syncFromCognito(pool.allUsers())
            .then(({ added, seen }) => logger.log(`Cognito backfill: ${added} added of ${seen} users`))
            .catch((e) => logger.error(`Cognito backfill failed: ${(e as Error).message}`));
        }
        return directory;
      },
    },
    {
      provide: ACCOUNT_STATUS,
      inject: [USER_DIRECTORY],
      useFactory: (directory: UserDirectory) => new AccountStatusCache(directory),
    },
    {
      provide: MFA_LOOKUP,
      inject: [USER_DIRECTORY],
      useFactory: (directory: UserDirectory) => new MfaCache(directory),
    },
  ],
  exports: [USER_DIRECTORY, ACCOUNT_STATUS, MFA_LOOKUP],
})
export class IdentityModule {}
