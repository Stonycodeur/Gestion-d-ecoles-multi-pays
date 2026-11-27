import { Body, Controller, Delete, Get, Put, Req } from '@nestjs/common';
import { ProfileService } from './profile.service';
import type { CoreRequest } from '../core/request-context';

/** Personal space: every signed-in account (root included) reads and edits its own profile. No school is needed. */
@Controller('me')
export class ProfileController {
  constructor(private readonly svc: ProfileService) {}
  @Get('profile') get(@Req() r: CoreRequest) { return this.svc.get(r.principal!.id); }
  @Put('profile') save(@Req() r: CoreRequest, @Body() b: any) { return this.svc.save(r.principal!.id, b); }
  @Put('avatar') avatar(@Req() r: CoreRequest, @Body() b: any) { return this.svc.setAvatar(r.principal!.id, b?.data_url); }
  @Delete('avatar') clear(@Req() r: CoreRequest) { return this.svc.removeAvatar(r.principal!.id); }
}
