import { MiddlewareConsumer, Module, NestModule } from '@nestjs/common';
import { APP_GUARD } from '@nestjs/core';
import { HealthController } from './health.controller';
import { AuthController } from './core/auth.controller';
import { AuthService } from './core/auth.service';
import { AuditService } from './core/audit.service';
import { CoreGuard } from './core/auth.guard';
import { TenantMiddleware } from './core/tenant.middleware';
import { ModulesController } from './modules/modules.controller';
import { ModulesService } from './modules/modules.service';

@Module({
  controllers: [HealthController, AuthController, ModulesController],
  providers: [AuthService, AuditService, ModulesService, { provide: APP_GUARD, useClass: CoreGuard }],
})
export class AppModule implements NestModule {
  configure(consumer: MiddlewareConsumer) { consumer.apply(TenantMiddleware).forRoutes('*'); }
}
