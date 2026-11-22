# ÉcoleManager Pro™

Plateforme de gestion d'écoles **multi-pays, multi-tenant, bilingue FR/EN (et RTL)** : application web (Next.js 14, PWA), application mobile native Android/iOS (Flutter), API NestJS (REST + GraphQL, OpenAPI), service IA (FastAPI), avec un référentiel pays configurable (pays pilote : Gabon).

| Dossier | Contenu |
|---|---|
| `apps/api` | API NestJS (multi-tenant PostgreSQL schéma + RLS, modules à plugins, adaptateurs réels et simulés) |
| `apps/web` | Web Next.js, responsive, PWA, mode hors ligne |
| `apps/mobile` | Flutter (Android + iOS), hors ligne chiffré, push, GPS en arrière-plan |
| `apps/ai` | IA prédictive explicable (SHAP) et assistant pédagogique |
| `packages/shared` | Règles métier testées (notation, OAA, droits, hors ligne, PKCE…) |
| `packages/modules/*` | Modules du registre (manifeste JSON) |
| `infra` | SQL, docker-compose, Keycloak, Kubernetes, Prometheus, Grafana |
| `store` | Fiches Google Play / App Store, déclarations de confidentialité |
| `docs` | Architecture, décisions, droits, intégrations, publication, guides |

## Démarrage en 8 commandes (API + web, données de démonstration Gabon)
```bash
git clone https://github.com/Stonycodeur/Gestion-d-ecoles-multi-pays && cd Gestion-d-ecoles-multi-pays
cp .env.example .env            # renseigner les mots de passe et clés (jamais commités)
docker compose -f infra/docker-compose.yml --env-file .env up -d --build
docker compose -f infra/docker-compose.yml --env-file .env --profile seed run --rm seed   # 4 établissements gabonais + comptes
open http://localhost:3001      # web ; API et Swagger : http://localhost:3000/docs
```
Mode développement (`AUTH_MODE=sandbox`, par défaut) : sur l'écran de connexion, saisir le code établissement (`ga_college`, `ga_lycee`, `ga_primaire`, `ga_universite`) et un rôle. Pour une connexion réelle (Keycloak, MFA) : `AUTH_MODE=oidc`, voir `docs/INTEGRATIONS.md`.

## Mobile
```bash
cd apps/mobile
flutter create --platforms=android,ios --org com.ecolemanager --project-name ecolemanager_mobile .
(cd tool && python3 configure_native.py ..)      # permissions, signature, entitlements, identifiant
flutter pub get && flutter gen-l10n && flutter run --dart-define=API_BASE=http://10.0.2.2:3000
```
Builds signés et publication : `docs/PUBLICATION_STORES.md`.

## Tests
```bash
npm run test:shared                                  # règles métier (notation, OAA, droits, hors ligne…)
PGUSER=<user> npm run test:sql                       # root immuable, RLS, isolation des tenants
npm --prefix apps/api test                           # e2e API (PostgreSQL requis, voir .github/workflows/ci.yml)
cd apps/ai && python -m unittest discover tests      # IA : qualité, biais
cd apps/mobile && flutter analyze && flutter test
```
La CI (GitHub Actions) exécute tout cela à chaque push et construit l'APK debug.

## Documentation
`docs/ARCHITECTURE.md` · `docs/DECISIONS.md` · `docs/PERMISSIONS.md` · `docs/INTEGRATIONS.md` · `docs/PUBLICATION_STORES.md` · `docs/PROGRESS.md` · `store/`

Licence : propriétaire, tous droits réservés (en attente de décision du titulaire).
