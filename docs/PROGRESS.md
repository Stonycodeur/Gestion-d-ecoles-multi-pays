# Avancement

## Phase 0 (en cours de clôture)
**Fait et vérifié ici**
- Moteur de notation + OAA (`packages/shared`) : 11 tests `node:test` verts (exemple 80/70/75/60 → 73 ; 14,6/20, 7,3/10, 73/100, B ; seuils ; couleurs ; arrondis ; moyennes à coefficients sur échelles mixtes ; anciennes notes conservées).
- SQL core (`infra/sql`) validé sur PostgreSQL 16 : `protect_root_admin` (UPDATE/DELETE refusés), un seul root, rôles root protégés, audit en ajout seul (UPDATE/DELETE/TRUNCATE refusés), RLS multi-tenant (isolation, absence de tenant, bypass root), seed Gabon + Côte d'Ivoire + pays à lettres. `bash infra/sql/run_tests.sh` → « SQL TESTS OK ».
- `docker compose config` valide.

**Écrit mais NON compilé/NON testé ici** (réseau npm coupé, pas de Flutter) : squelettes `apps/api` (NestJS), `apps/web` (Next.js), `apps/mobile` (Flutter), workflow CI. La CI GitHub les compilera au premier push ; tout échec sera corrigé en priorité.

**Reste à faire en Phase 0** : `docs/ARCHITECTURE.md`, ERD, matrice de permissions complète, `README.md`, `CONTRIBUTING.md`.

## Problèmes connus
- Dossiers natifs `android/` et `ios/` non générés (nécessite `flutter create`, fait en CI et à documenter) ; icône et écran de lancement à ajouter.
- Docker : seul le fichier compose a été validé, pas le démarrage des services.
- Aucune fonctionnalité factice à ce stade.
