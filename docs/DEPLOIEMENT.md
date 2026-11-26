# Déploiement / Deployment

## Français

### Prérequis
Docker 24+ (développement), ou un cluster Kubernetes avec Ingress TLS ; PostgreSQL 16 ; un Keycloak (ou tout fournisseur OIDC avec PKCE) ; un stockage S3 ; Redis, RabbitMQ, Elasticsearch, TimescaleDB, MinIO selon `infra/docker-compose.yml`.

### Développement ou démonstration (une machine)
```bash
cp .env.example .env     # renseigner les mots de passe : jamais commités
docker compose -f infra/docker-compose.yml --env-file .env up -d --build
docker compose -f infra/docker-compose.yml --env-file .env --profile seed run --rm seed
```
Web : `http://localhost:3001` · API et Swagger : `http://localhost:3000/docs` · Grafana : `http://localhost:3002`. Les scripts SQL `infra/sql/010` à `070` sont appliqués dans l'ordre à la première création de la base.

### Production (Kubernetes)
1. **Base de données** : PostgreSQL 16 géré ou opéré par vous. Créez le rôle d'exécution non-superutilisateur `app_runtime` (`infra/sql/000_runtime_role.sh`), puis appliquez dans l'ordre `010_core.sql`, `020_seed_roles.sql`, `030_seed_countries.sql`, `040_tenant_template.sql`, `050_marketplace.sql`, `060_idempotency.sql`, `070_settings.sql`, `080_tenants_admin.sql`, `100_geo.sql` (avec `psql` depuis un poste d'exploitation ou votre outil de migration ; `infra/k8s/40-jobs.yaml` ne contient que le seed de démonstration). Les établissements existants reçoivent les nouveautés en rejouant `SELECT provision_tenant_schema('<slug>')`, qui est idempotent.
2. **Secrets** : créez `ecolemanager-secrets` hors dépôt (sealed-secrets, external-secrets ou `kubectl create secret`) à partir du gabarit de `infra/k8s/00-namespace-config.yaml` : `DATABASE_URL` (rôle `app_runtime`), `DATABASE_ADMIN_URL`, `MESSAGE_KEY`, `WEBHOOK_KEY`, `GPS_KEY` (base64 de 32 octets : `openssl rand -base64 32`), `PAYMENT_WEBHOOK_SECRET`, `API_TOKEN_SECRET`, `METRICS_TOKEN`, `SENTRY_DSN` si utilisé.
3. **Configuration** : adaptez `ecolemanager-config` (`CORS_ORIGINS`, `OIDC_ISSUER`, `OIDC_JWKS_URI`, `OIDC_AUDIENCE`). `AUTH_MODE=oidc` obligatoire en production ; le mode `sandbox` est réservé au développement.
4. **Keycloak** : importez `infra/keycloak/realm-ecolemanager.json` (clients publics `ecolemanager-web` et `ecolemanager-mobile` avec PKCE, MFA, mappeurs de rôles et d'établissement) ; en production, changez les URI de redirection et créez les comptes (`npm --prefix apps/api run seed:keycloak` pour la démonstration).
5. **Déploiement** : `kubectl apply -f infra/k8s/00-namespace-config.yaml -f infra/k8s/10-api.yaml -f infra/k8s/20-web-ai.yaml -f infra/k8s/30-ingress-network.yaml` (namespace, API avec HPA et budget de disruption, web et IA, Ingress TLS, politiques réseau). N'appliquez **pas** `40-jobs.yaml` en production : c'est le seed de démonstration.
6. **Passage des adaptateurs en réel** : renseignez les clés puis passez `PAYMENT_MODE`, `PUSH_MODE`, `SMS_MODE`, `EMAIL_MODE`, `MAPS_MODE`, `LLM_MODE`, `MINISTRY_MODE` à `live`, un à la fois, avec les étapes de `docs/INTEGRATIONS.md`.
7. **Supervision** : Prometheus lit `/metrics` avec le jeton `METRICS_TOKEN` (`infra/prometheus.yml`, règles dans `infra/alerts.yml`), tableaux Grafana dans `infra/grafana`, erreurs 5xx vers Sentry si `SENTRY_DSN`.
8. **Sauvegardes** : sauvegarde quotidienne de PostgreSQL (tous les schémas `tenant_*` et `public`) et du stockage S3 ; testez la restauration. Le journal d'audit est en ajout seul : ne le purgez pas.
9. **Données de démonstration** : jamais en production (`seed:demo` est refusé sauf `ALLOW_DEMO_SEED=1`).

### Mise à jour
Déployez la nouvelle image de l'API après avoir appliqué les scripts SQL ajoutés (idempotents), puis rejouez `provision_tenant_schema` pour chaque établissement.

### Vérifications après déploiement
`GET /health` répond ; `GET /auth/config` renvoie l'émetteur OIDC ; la connexion web et mobile aboutit ; un administrateur voit `GET /modules/active` ; une notification de test arrive ; Prometheus collecte.

## English

### Prerequisites
Docker 24+ (development) or a Kubernetes cluster with a TLS Ingress; PostgreSQL 16; Keycloak (or any OIDC provider with PKCE); S3 storage; Redis, RabbitMQ, Elasticsearch, TimescaleDB and MinIO as in `infra/docker-compose.yml`.

### Development or demo (single machine)
```bash
cp .env.example .env
docker compose -f infra/docker-compose.yml --env-file .env up -d --build
docker compose -f infra/docker-compose.yml --env-file .env --profile seed run --rm seed
```
Web `http://localhost:3001`, API and Swagger `http://localhost:3000/docs`, Grafana `http://localhost:3002`. SQL scripts `010` to `080` run in order when the database is first created.

### Production (Kubernetes)
1. Database: create the non-superuser runtime role `app_runtime`, then apply `010` to `080` in order. Existing schools pick up changes by replaying the idempotent `SELECT provision_tenant_schema('<slug>')`.
2. Secrets: create `ecolemanager-secrets` out of band from the template in `infra/k8s/00-namespace-config.yaml`; generate keys with `openssl rand -base64 32`.
3. Config: adapt `CORS_ORIGINS`, `OIDC_ISSUER`, `OIDC_JWKS_URI`, `OIDC_AUDIENCE`; `AUTH_MODE=oidc` is mandatory in production.
4. Keycloak: import `infra/keycloak/realm-ecolemanager.json`, adjust redirect URIs, create accounts.
5. Deploy: `kubectl apply -f` files `00` to `30` in `infra/k8s/`. Do **not** apply `40-jobs.yaml` in production: it is the demo seed.
6. Switch adapters to live one at a time (`PAYMENT_MODE`, `PUSH_MODE`, `SMS_MODE`, `EMAIL_MODE`, `MAPS_MODE`, `LLM_MODE`, `MINISTRY_MODE`) following `docs/INTEGRATIONS.md`.
7. Monitoring: Prometheus scrapes `/metrics` with `METRICS_TOKEN`; Grafana dashboards in `infra/grafana`; 5xx errors to Sentry when `SENTRY_DSN` is set.
8. Backups: daily PostgreSQL (all `tenant_*` schemas and `public`) and S3 backups; rehearse restores; never purge the append-only audit log.
9. Never load demo data in production.

### Smoke test
`GET /health` answers; `GET /auth/config` returns the OIDC issuer; web and mobile sign-in succeed; an administrator sees `GET /modules/active`; a test notification arrives; Prometheus collects.

## Démarrage en production
L'API refuse de démarrer si la configuration est dangereuse (`docs/SECURITY.md`) : AUTH_MODE=oidc, clés de 32 octets en base64, CORS en https, tous les `*_MODE` à `live` (ou `ALLOW_SANDBOX_ADAPTERS=1` pour une démo). Les messages `[config]` des journaux listent chaque problème.
