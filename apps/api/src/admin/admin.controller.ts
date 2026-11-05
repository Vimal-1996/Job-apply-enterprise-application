import { Controller, Get } from '@nestjs/common';
import { Roles } from '../auth/decorators';

@Controller('admin')
@Roles('admin')
export class AdminController {
  @Get('ping')
  ping() {
    return { ok: true, scope: 'admin' };
  }
}
