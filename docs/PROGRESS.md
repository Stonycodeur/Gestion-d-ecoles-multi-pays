# Avancement

## Phase 0 : TERMINÉE (CI verte, run 44297072699 : shared+SQL, API+web, Flutter analyze/test/APK debug)
**Fait et vérifié ici**
- Moteur de notation + OAA (`packages/shared`) : 11 tests `node:test` verts (exemple 80/70/75/60 → 73 ; 14,6/20, 7,3/10, 73/100, B ; seuils ; couleurs ; arrondis ; moyennes à coefficients sur échelles mixtes ; anciennes notes conservées).
- SQL core (`infra/sql`) validé sur PostgreSQL 16 : `protect_root_admin` (UPDATE/DELETE refusés), un seul root, rôles root protégés, audit en ajout seul (UPDATE/DELETE/TRUNCATE refusés), RLS multi-tenant (isolation, absence de tenant, bypass root), seed Gabon + Côte d'Ivoire + pays à lettres. `bash infra/sql/run_tests.sh` → « SQL TESTS OK ».
- `docker compose config` valide.

**Vérifié par la CI GitHub (run 44296611421)** : `shared-and-sql` ✓, `api-web` ✓ (build + test NestJS, build Next.js). Mobile : `flutter pub get`, `gen-l10n` OK ; `flutter analyze` ne signalait que 5 avertissements `info` de dépréciation (le Flutter stable actuel déplace `material.dart` vers `package:material_ui`) ; la CI utilise `--no-fatal-infos`. **À migrer vers `material_ui` en Phase 1.**

**Non vérifiable localement** (réseau npm coupé, pas de Flutter) : (réseau npm coupé, pas de Flutter) : squelettes `apps/api` (NestJS), `apps/web` (Next.js), `apps/mobile` (Flutter), workflow CI. La CI GitHub les compilera au premier push ; tout échec sera corrigé en priorité.

**Livré** : `ARCHITECTURE.md` (avec ERD du noyau), `PERMISSIONS.md`, `README.md`, `CONTRIBUTING.md`, `DECISIONS.md`.

## Prochaine étape : Phase 1 (Core)
Auth OIDC/Keycloak, TenantResolver, utilisateurs/rôles, Module Registry, audit côté API, socle mobile (OIDC, stockage sécurisé, choix du tenant), migration `material_ui`.

## Problèmes connus
- Dossiers natifs `android/` et `ios/` non générés (nécessite `flutter create`, fait en CI et à documenter) ; icône et écran de lancement à ajouter.
- Docker : seul le fichier compose a été validé, pas le démarrage des services.
- Aucune fonctionnalité factice à ce stade.
