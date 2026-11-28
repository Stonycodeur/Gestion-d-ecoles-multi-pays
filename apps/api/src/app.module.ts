import { MiddlewareConsumer, Module, NestModule } from '@nestjs/common';
import { APP_GUARD, APP_INTERCEPTOR } from '@nestjs/core';
import { IdempotencyInterceptor } from './core/idempotency';
import { SchedulerService } from './core/scheduler';
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
import { SchoolConfigController } from './school/school-config.controller';
import { SchoolConfigService } from './school/school-config.service';
import { AcademicController } from './school/academic.controller';
import { AcademicService } from './school/academic.service';
import { TenantsService } from './school/tenants.service';
import { DirectoryController } from './school/directory.controller';
import { NavigationController } from './school/navigation.controller';
import { SchoolUsersController } from './school/school-users.controller';
import { SchoolUsersService } from './school/school-users.service';
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
import { MarketplaceController } from './marketplace/marketplace.controller';
import { MarketplaceService } from './marketplace/marketplace.service';
import { MinistryController } from './ministry/ministry.controller';
import { MinistryService } from './ministry/ministry.service';
import { ApiAdminController, PublicApiController } from './publicapi/publicapi.controller';
import { PublicApiService } from './publicapi/publicapi.service';
import { WebhooksService } from './publicapi/webhooks.service';

import { GenAiController } from './genai/genai.controller';
import { GenAiService } from './genai/genai.service';

import { XrController, XrPublicController } from './xr/xr.controller';
import { XrService } from './xr/xr.service';

import { AccountController } from './account/account.controller';
import { AccountService } from './account/account.service';

import { GeoController } from './geo/geo.controller';
import { GeoAdminService } from './geo/geo-admin.service';
import { ProfileController } from './account/profile.controller';
import { ProfileService } from './account/profile.service';
import { RolesController } from './admin/roles.controller';
import { PermissionsService } from './core/permissions.service';
import { TrashController } from './admin/trash.controller';
import { TrashService } from './admin/trash.service';
import { GeoService } from './geo/geo.service';
import { AdminController } from './admin/admin.controller';
import { AccountsAdminService } from './admin/accounts.service';

@Module({
  controllers: [HealthController, DirectoryController, NavigationController, SchoolUsersController, AuthController, ModulesController, PedagogyController, SchoolConfigController, AcademicController, CommsController, OaaController, GamificationController, PredictiveController, PaymentsController, GpsController, OrientationController, PublicController, VisitorAdminController, ResourcesController, MarketplaceController, MinistryController, PublicApiController, ApiAdminController, GenAiController, XrController, XrPublicController, AccountController, GeoController, AdminController, ProfileController, RolesController, TrashController],
  providers: [AuthService, AuditService, ModulesService, TenantDb, PedagogyService, SchoolConfigService, AcademicService, TenantsService, SchoolUsersService, Adapters, RealtimeGateway, NotificationService, CommsService, OaaService, GamificationService, PredictiveService, PaymentProviders, PaymentsService, GpsService, OrientationService, VisitorService, ResourcesService, MarketplaceService, MinistryService, PublicApiService, WebhooksService, GenAiService, XrService, AccountService, GeoService, GeoAdminService, ProfileService, PermissionsService, TrashService, AccountsAdminService, SchedulerService, { provide: APP_GUARD, useClass: CoreGuard }, { provide: APP_INTERCEPTOR, useClass: IdempotencyInterceptor }],
})
export class AppModule implements NestModule {
  configure(consumer: MiddlewareConsumer) { consumer.apply(TenantMiddleware).forRoutes('*'); }
}
