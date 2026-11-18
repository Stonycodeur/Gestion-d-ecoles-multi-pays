import { Module } from '@nestjs/common';
import { HealthController } from './health.controller';

// Phase 1 adds: TenantResolver, Auth (OIDC), ModuleRegistry, Audit.
@Module({ controllers: [HealthController] })
export class AppModule {}
