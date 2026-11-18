# ÉcoleManager Pro™
Plateforme de gestion d'écoles multi-pays, multi-tenant, bilingue FR/EN : web (Next.js/PWA), mobile (Flutter), API (NestJS), IA (FastAPI). Cahier des charges : version 1.0 (voir `docs/`). Pays pilote : Gabon.

**État** : Phase 0. Voir `docs/PROGRESS.md` (fait / reste / problèmes connus) et `docs/DECISIONS.md`.

## Démarrage rapide
```bash
git clone https://github.com/Stonycodeur/Gestion-d-ecoles-multi-pays && cd Gestion-d-ecoles-multi-pays
cp .env.example .env                       # puis renseigner les mots de passe
docker compose -f infra/docker-compose.yml --env-file .env up -d   # PostgreSQL (seed pays), Redis, RabbitMQ, MinIO, ES, Keycloak
npm run test:shared                         # moteur de notation + OAA
PGUSER=<user> npm run test:sql              # SQL : root immuable, RLS, seeds
npm install && npm --prefix apps/api run start:dev   # API (Phase 1 pour les routes métier)
npm --prefix apps/web run dev               # web
cd apps/mobile && flutter create --platforms=android,ios . && flutter pub get && flutter gen-l10n && flutter run
```
Captures d'écran : à ajouter quand les écrans existent (Phase 2).
