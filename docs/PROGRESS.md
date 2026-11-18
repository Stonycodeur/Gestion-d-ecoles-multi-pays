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

## Phase 2 (Pédagogie) : socle livré, reste listé ci-dessous (CI verte, run 44404108439)
**Fait et vérifié** : gabarit de schéma par établissement (17 tables, RLS forcée, index uniques anti double réservation d'enseignant, de classe et de salle) testé sur PG16 et via e2e avec un rôle non-superuser ; 29 tests shared (génération d'EDT sous contraintes avec rapport des heures non placées, conflits, iCal, moyennes à coefficients, classement ex æquo, bulletin dans l'échelle active, absences et impact sur l'axe social) ; API : classes, matières, enseignants, salles, élèves (+ hook `onStudentCreated`), EDT (génération, glisser-déposer, validation par la direction seule, publication, iCal), évaluations (échelle du référentiel figée, pas respecté), notes, bulletin JSON/PDF FR/EN, archivage, absences/justifications/décision, cahier de textes (recherche plein texte, visa) ; e2e PostgreSQL (isolation entre établissements, changement d'échelle en cours d'année sans toucher aux anciennes notes) ; web : EDT avec glisser-déposer, notes, absences, cahier de textes, file hors ligne, FR/EN/AR (RTL), service worker ; mobile : port Dart du moteur de notation (mêmes cas de test), file hors ligne avec priorité enseignant et journal de conflits (4 tests), écrans cahier de textes et classes avec cache hors ligne.

**Reste à faire pour clore la Phase 2 (non fait, rien n'est reporté après la v1)**
- Gestion du personnel : contrats, charge horaire réelle (seul `max_weekly_hours` existe) ; CRUD complet des établissements et assistant de création côté API/web (aujourd'hui insertion SQL + `provision_tenant_schema`) ; configuration web des échelles de notation par l'administrateur.
- Élèves : inscription en ligne et facture à l'inscription (facture : Phase 5 ; formulaire public : Phase 6), statuts de transfert/diplôme via l'API.
- EDT : remplacement de professeur (table `substitutions` prête, pas d'endpoint), vues jour/mois, export PDF (iCal fait), notifications de changement (Phase 3), contraintes de salle par type.
- Notes : compétences, relevés de notes université (UE, ECTS, validation, mentions), fiche BEPC (Phase 6).
- Cahier de textes : documents joints (MinIO), accès inspecteurs limité dans le temps (table prête), devoirs interactifs QCM, charge de travail par classe, brouillon/validation optionnelle.
- Mobile : écrans EDT, notes/bulletins et absences ; branchement de la file hors ligne sur les écrans de saisie ; base locale chiffrée (Drift) au lieu du stockage sécurisé.
- Sécurité : les séances du cahier de textes et les EDT publiés sont lisibles par tout utilisateur authentifié du même établissement (pas de restriction à sa propre classe) ; à restreindre.
- **Le hook `onGradeSubmitted` n'alimente pas encore l'OAA** : le module reçoit des identifiants d'élèves alors qu'il attend les 4 axes ; l'erreur est isolée (résultat `ok:false`). Le calcul des axes depuis les notes, l'assiduité et la gamification est prévu en Phase 4.
- Activation des modules par établissement toujours en mémoire (persistance dans `feature_flags` à brancher).

## Prochaine étape
Terminer le reste de la Phase 2 ci-dessus, puis Phase 3 (Communication).
