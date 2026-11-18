# Avancement

## Phase 0 : TERMINÉE (CI verte, run 44297072699 : shared+SQL, API+web, Flutter analyze/test/APK debug)
**Fait et vérifié ici**
- Moteur de notation + OAA (`packages/shared`) : 11 tests `node:test` verts (exemple 80/70/75/60 → 73 ; 14,6/20, 7,3/10, 73/100, B ; seuils ; couleurs ; arrondis ; moyennes à coefficients sur échelles mixtes ; anciennes notes conservées).
- SQL core (`infra/sql`) validé sur PostgreSQL 16 : `protect_root_admin` (UPDATE/DELETE refusés), un seul root, rôles root protégés, audit en ajout seul (UPDATE/DELETE/TRUNCATE refusés), RLS multi-tenant (isolation, absence de tenant, bypass root), seed Gabon + Côte d'Ivoire + pays à lettres. `bash infra/sql/run_tests.sh` → « SQL TESTS OK ».
- `docker compose config` valide.

**Vérifié par la CI GitHub (run 44296611421)** : `shared-and-sql` ✓, `api-web` ✓ (build + test NestJS, build Next.js). Mobile : `flutter pub get`, `gen-l10n` OK ; `flutter analyze` ne signalait que 5 avertissements `info` de dépréciation (le Flutter stable actuel déplace `material.dart` vers `package:material_ui`) ; la CI utilise `--no-fatal-infos`. **À migrer vers `material_ui` en Phase 1.**

**Non vérifiable localement** (réseau npm coupé, pas de Flutter) : (réseau npm coupé, pas de Flutter) : squelettes `apps/api` (NestJS), `apps/web` (Next.js), `apps/mobile` (Flutter), workflow CI. La CI GitHub les compilera au premier push ; tout échec sera corrigé en priorité.

**Livré** : `ARCHITECTURE.md` (avec ERD du noyau), `PERMISSIONS.md`, `README.md`, `CONTRIBUTING.md`, `DECISIONS.md`.

## Phase 1 (Core) : TERMINÉE (CI verte, run 44300037668)
**Fait et vérifié** : 19 tests shared (semver, registre de modules avec compat core et hooks isolés, TenantResolver, RBAC+ABAC dont GPS avec consentement et bypass root audité) + 3 tests module-oaa ; e2e NestJS (token obligatoire, sandbox ne produit jamais de root, module-oaa découvert dans `packages/modules` et activé par tenant seulement par un admin, isolation entre tenants, token/sous-domaine cohérents) ; mobile : choix de l'établissement, connexion, stockage sécurisé, écrans selon `/modules/active` (3 tests unitaires + 1 widget).

**Reste / limites connues de la Phase 1**
- L'authentification réelle OIDC/PKCE avec Keycloak (côté API `AUTH_MODE=oidc`, vérification JWKS) est codée mais **non testée contre un vrai Keycloak** ; le mobile utilise pour l'instant la connexion sandbox. Le flux AppAuth/PKCE mobile, la biométrie et le certificate pinning restent à brancher (prévu avec le paiement/sécurité, Phase 5 et 7), de même que MFA et le journal des connexions (Keycloak + table `sessions`).
- L'activation des modules par tenant est en mémoire dans l'API (`MemoryEnablementStore`) ; la persistance dans `feature_flags` est à faire en Phase 2 avec la couche d'accès aux données par tenant.
- Les droits `ROLE_PERMISSIONS` couvrent le noyau ; ils seront complétés module par module.
- Migration `material_ui` toujours à faire.

## Prochaine étape : Phase 2 (Pédagogie)
Établissements, élèves, personnel, classes, EDT (génération + conflits), notes et bulletins, cahier de textes, absences, web et mobile ; couche d'accès aux données par tenant ; port Dart du moteur de notation.
