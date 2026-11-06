import { CognitoIdentityProviderClient } from '@aws-sdk/client-cognito-identity-provider';
import { Global, Module } from '@nestjs/common';
import { AccountStatusCache } from '../auth/account-status-cache';
import { ACCOUNT_STATUS } from '../auth/auth.types';
import { CognitoUserDirectory } from '../admin/users/cognito-user-directory';
import { USER_DIRECTORY, UserDirectory } from '../admin/users/user.types';
import { loadConfig } from '../config/config';

/**
 * The user pool as a data source. Global because both authentication (every
 * request checks account status) and the admin console need it, and they must
 * share one status cache so admin changes invalidate it.
 */
@Global()
@Module({
  providers: [
    {
      provide: USER_DIRECTORY,
      useFactory: () => {
        const { cognito } = loadConfig();
        // Credentials come from the default chain: your AWS profile locally,
        // the ECS task role in AWS. Region is the prefix of the pool id.
        const region = cognito.userPoolId.split('_')[0];
        return new CognitoUserDirectory(new CognitoIdentityProviderClient({ region }), cognito.userPoolId);
      },
    },
    {
      provide: ACCOUNT_STATUS,
      inject: [USER_DIRECTORY],
      useFactory: (directory: UserDirectory) => new AccountStatusCache(directory),
    },
  ],
  exports: [USER_DIRECTORY, ACCOUNT_STATUS],
})
export class IdentityModule {}
