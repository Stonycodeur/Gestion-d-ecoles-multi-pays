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
import { PedagogyController } from './pedagogy/pedagogy.controller';
import { PedagogyService } from './pedagogy/pedagogy.service';
import { TenantDb } from './pedagogy/tenant-db.service';

@Module({
  controllers: [HealthController, AuthController, ModulesController, PedagogyController],
  providers: [AuthService, AuditService, ModulesService, TenantDb, PedagogyService, { provide: APP_GUARD, useClass: CoreGuard }],
})
export class AppModule implements NestModule {
  configure(consumer: MiddlewareConsumer) { consumer.apply(TenantMiddleware).forRoutes('*'); }
}
