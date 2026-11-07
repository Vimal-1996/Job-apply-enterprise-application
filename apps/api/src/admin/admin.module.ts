import { Module } from '@nestjs/common';
import { AdminController } from './admin.controller';
import { UsersController } from './users/users.controller';

// USER_DIRECTORY and ACCOUNT_STATUS come from the global IdentityModule.
@Module({
  controllers: [AdminController, UsersController],
})
export class AdminModule {}
