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
import { PaymentsController } from './payments/payments.controller';
import { PaymentsService } from './payments/payments.service';
import { PaymentProviders } from './payments/providers';
import { GpsController } from './gps/gps.controller';
import { GpsService } from './gps/gps.service';
import { CommsController } from './comms/comms.controller';
import { CommsService } from './comms/comms.service';
import { NotificationService } from './comms/notification.service';
import { RealtimeGateway } from './comms/realtime.gateway';
import { OrientationController } from './orientation/orientation.controller';
import { OrientationService } from './orientation/orientation.service';
import { PublicController, VisitorAdminController } from './visitor/visitor.controller';
import { VisitorService } from './visitor/visitor.service';
import { ResourcesController } from './resources/resources.controller';
import { ResourcesService } from './resources/resources.service';

@Module({
  controllers: [HealthController, AuthController, ModulesController, PedagogyController, CommsController, OaaController, GamificationController, PredictiveController, PaymentsController, GpsController, OrientationController, PublicController, VisitorAdminController, ResourcesController],
  providers: [AuthService, AuditService, ModulesService, TenantDb, PedagogyService, Adapters, RealtimeGateway, NotificationService, CommsService, OaaService, GamificationService, PredictiveService, PaymentProviders, PaymentsService, GpsService, OrientationService, VisitorService, ResourcesService, { provide: APP_GUARD, useClass: CoreGuard }],
})
export class AppModule implements NestModule {
  configure(consumer: MiddlewareConsumer) { consumer.apply(TenantMiddleware).forRoutes('*'); }
}
