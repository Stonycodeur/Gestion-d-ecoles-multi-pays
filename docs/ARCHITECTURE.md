# Architecture

```mermaid
flowchart LR
  Web[Next.js PWA] --> GW[API NestJS REST+GraphQL]
  Mob[Flutter iOS/Android] --> GW
  GW --> TR[TenantResolver: sous-domaine ou JWT]
  TR --> PG[(PostgreSQL 16: schéma par tenant + RLS)]
  GW --> KC[Keycloak OIDC/PKCE]
  GW --> RD[(Redis)]
  GW --> MQ[[RabbitMQ]]
  GW --> S3[(MinIO)]
  GW --> ES[(Elasticsearch)]
  GW --> TS[(TimescaleDB: GPS)]
  GW --> AI[Service IA FastAPI]
  GW --> WS[Socket.IO]
```

- **Cœur invariable + modules** (`packages/modules/*`, manifeste JSON conforme à `module-oaa` du CDC 4.4) chargés par un Module Registry (Phase 1).
- **Multi-tenant** : `public` (pays, tenants, users, rôles, audit) + `tenant_<slug>` par établissement, RLS forcée via `app.tenant_id`; contournement root via `app.root_bypass` (audité côté API). Voir `infra/sql/010_core.sql`.
- **Référentiel pays** : `countries`, `education_systems`, `grading_scales`, `academic_calendars` (+ surcharge `tenant_settings`). Aucun barème en dur ; moteur dans `packages/shared/src/grading.ts`.
- **Adaptateurs externes** : chaque service (paiement, push, SMS, email, cartes, LLM) = interface + implémentation `live` + `sandbox`, choisie par variable `*_MODE`.
- **Mobile** : Flutter, découverte des modules actifs via l'API du tenant, base locale chiffrée + file de synchro (Phase 2).

## ERD (noyau, Phase 0)
```mermaid
erDiagram
  countries ||--o{ education_systems : defines
  countries ||--o{ grading_scales : defines
  countries ||--o{ academic_calendars : defines
  countries ||--o{ tenants : hosts
  tenants ||--o{ feature_flags : enables
  tenants ||--o{ tenant_settings : overrides
  users ||--o{ user_roles : has
  roles ||--o{ user_roles : granted
  roles ||--o{ role_permissions : holds
  permissions ||--o{ role_permissions : in
  users ||--o{ sessions : opens
  users ||--o{ audit_logs : acts
```
Les tables par domaine (élèves, notes, EDT, paiements, GPS, IA, etc., CDC 5.3) sont ajoutées par phase, dans le schéma tenant.
