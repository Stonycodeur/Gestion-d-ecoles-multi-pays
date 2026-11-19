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
import { Adapters } from './adapters/adapters';
import { OaaController } from './oaa/oaa.controller';
import { OaaService } from './oaa/oaa.service';
import { GamificationController } from './gamification/gamification.controller';
import { GamificationService } from './gamification/gamification.service';
import { PredictiveController } from './predictive/predictive.controller';
import { PredictiveService } from './predictive/predictive.service';
import { CommsController } from './comms/comms.controller';
import { CommsService } from './comms/comms.service';
import { NotificationService } from './comms/notification.service';
import { RealtimeGateway } from './comms/realtime.gateway';

@Module({
  controllers: [HealthController, AuthController, ModulesController, PedagogyController, CommsController, OaaController, GamificationController, PredictiveController],
  providers: [AuthService, AuditService, ModulesService, TenantDb, PedagogyService, Adapters, RealtimeGateway, NotificationService, CommsService, OaaService, GamificationService, PredictiveService, { provide: APP_GUARD, useClass: CoreGuard }],
})
export class AppModule implements NestModule {
  configure(consumer: MiddlewareConsumer) { consumer.apply(TenantMiddleware).forRoutes('*'); }
}
