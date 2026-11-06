import { CognitoIdentityProviderClient } from '@aws-sdk/client-cognito-identity-provider';
import { Module } from '@nestjs/common';
import { loadConfig } from '../config/config';
import { AdminController } from './admin.controller';
import { CognitoUserDirectory } from './users/cognito-user-directory';
import { USER_DIRECTORY } from './users/user.types';
import { UsersController } from './users/users.controller';

@Module({
  controllers: [AdminController, UsersController],
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
  ],
})
export class AdminModule {}
