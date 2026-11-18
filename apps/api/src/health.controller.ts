import { Controller, Get } from '@nestjs/common';
import { Public } from './core/auth.guard';

@Controller('health')
export class HealthController {
  @Public() @Get() check() { return { status: 'ok', service: 'api', time: new Date().toISOString() }; }
}
