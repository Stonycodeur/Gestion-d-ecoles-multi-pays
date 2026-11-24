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

## Phase 3 (Communication) : API, web et mobile livrés en branche `phase-3-communication`
**Fait** : règles de messagerie (tableau 6.9) testées en pur ; chiffrement AES-GCM ; notifications localisées FR/EN/AR ; remplacement de professeur et charge horaire (logique pure testée, voir `staff.ts`) ; API : annuaire, fils et messages (pièces jointes ≤ 5 Mo via adaptateur stockage local/S3), actualités par public, newsletter par e-mail, sondages (un vote par compte), événements, notifications (liste, lu), enregistrement d'appareils, casier numérique (rétention configurable, purge, ABAC), passerelle Socket.IO ; adaptateurs sandbox + réels : stockage (local/S3-MinIO), push (sandbox/FCM), SMS (sandbox/Twilio), e-mail (sandbox/SMTP) ; notifications branchées sur notes, absences et publication d'EDT ; e2e comms ; web : messages (temps réel), actualités, notifications ; mobile : messages (envoi, file hors ligne), actualités, notifications, enregistrement push en mode sandbox.

**Reste (non fait, à clore avant la fin de la v1)**
- Mobile : vrai jeton FCM/APNs (`firebase_messaging` + `google-services.json` fournis par le propriétaire) ; aujourd'hui jeton sandbox. Création de fil depuis le mobile, pièces jointes mobile.
- Endpoints de la Phase 2 non encore exposés : remplacement de professeur, contrats/charge horaire, accès inspecteurs, API établissements.
- Purge automatique quotidienne du casier : appel `POST /locker/purge` disponible, planification à brancher (cron/RabbitMQ).
- Envoi SMS/e-mail selon préférences par type d'événement (seul le push et l'in-app sont déclenchés automatiquement) ; newsletter déclenchée manuellement.
- Modération des messages par la direction (`messages:all` existe, pas d'écran).

## Phase 4 (OAA, IA prédictive, gamification) : branche `phase-4-oaa-gamification`
**Fait** : calcul OAA générique par profil de niveau (73/100 → 14,6/20, 7,3/10, B vérifiés), alimentation depuis notes par catégorie de matière, assiduité, quiz et jeux ; historique, alertes à 50 % et pénalités proposées à 40 % exprimées dans l'échelle locale ; confidentialité par rôle ; gamification (XP idempotents, niveaux, badges, quiz avec mélange par tentative, réponses jamais exposées, chrono serveur, drapeau trop rapide, modes QCM/escape game/quiz d'équipe/boss, défis, équipes, classements) ; modèle de risque explicable (SHAP linéaire exact), service Python reproductible avec jeu de démonstration et fiche modèle, mesure de biais (règle des 4/5), paiement exclu ; modules `module-oaa`, `module-gamification`, `module-ia-predictive` ; e2e API ; pages web OAA / jeux / risque ; écrans mobiles quiz, classement, risque, OAA ; job CI Python.
**Corrections après la CI (branche phase-4b-fixes)** : écran mobile OAA relié au menu (`GET /me/students`), formulaires web de création de quiz/défi/équipe et de configuration OAA, permission `games:challenge`.
**Limites connues** : code vérifié par la CI (pas compilé localement) ; chemin xgboost/shap non testé ; création de jeux et configuration OAA web uniquement (D-023) ; écart D-020 à valider.

## Phase 5 (paiement, GPS, consentements) : branche `phase-5-payment-gps`
**Fait**
- Logique pure testée (13 tests) : unités mineures et devises, remises, échéanciers à somme exacte, affectation aux échéances les plus anciennes, statut de facture, rappels aux jours exacts, signature de webhook (HMAC, anti-rejeu, hex strict), conciliation, statistiques de recouvrement ; fenêtre de consentement GPS (fuseau, jours, plage passant minuit), haversine, filtre de précision, géofencing par transitions, purge, intervalle 30 s.
- Tables SQL (RLS) : plans de frais, factures, échéances, paiements, événements webhook, reçus ; consentements, zones, positions chiffrées, état, événements, journal d'accès.
- API : plans de frais, facture automatique à l'inscription (calculée par `module-payment`, enregistrée par le cœur), factures, paiement en ligne avec `Idempotency-Key`, webhook public signé idempotent, paiements manuels (espèces avec QR signé, chèque, virement), reçus PDF FR/EN, rappels (job quotidien appelable), conciliation, statistiques, annulation ; GPS : consentement révocable avec plage et durée, politique d'envoi pour l'app élève, réception des positions, alertes aux tuteurs consentants, carte/historique/événements, journal d'accès, zones, purge. Adaptateurs : sandbox pour tous les prestataires, Stripe, Airtel Money et Moov Money (réels, non testés faute de compte).
- Web : pages Paiements (famille et comptabilité) et GPS (consentement, carte, événements, zones, journal). Mobile : écrans paiement (hors achat intégré), consentement parent avec carte, envoi de position élève au premier plan et en arrière-plan (intervalle imposé par le serveur), script `tool/configure_native.py` (permissions Android/iOS, modes d'arrière-plan) exécuté en CI.
- Les écritures de paiement, de quiz et de GPS ne sont jamais mises en file hors connexion (web et mobile) : seules les consultations le sont.
**Limites connues / reste à faire**
- Adaptateurs Airtel/Moov/Stripe réels non testés en conditions réelles (identifiants requis) ; Moov au format générique.
- Les positions GPS ne sont pas poussées en temps réel par WebSocket (la page parent interroge toutes les 15 s) ; géofencing évalué à chaque position reçue.
- Reçus PDF : ouverture sur le web ; sur mobile la liste des paiements est affichée mais le PDF n'est pas encore ouvert (à traiter en phase 7).
- Les nouveaux écrans mobiles (Phase 4 et 5) utilisent des textes FR/EN en dur et pas encore les fichiers ARB ; RTL à vérifier : à traiter en phase 7.
- Entitlements iOS (push, localisation) et projet Xcode propre : phase 7 (préparation des stores).
- Surpaiement non crédité (D-029). Rappels : pas encore de tâche planifiée automatique (endpoint prêt).
- Pas de test automatisé de l'envoi de position en arrière-plan sur appareil réel (nécessite émulateur/appareil).

## Phase 6 (orientation, visiteur, ministères, API publique, marketplace…) : branche `phase-6-extensions`
**Lot 6a (CI verte)** : orientation et stages, fiche BEPC/CEP, ressources et forums, espace visiteur public (site, inscription en ligne, contact, statistiques) : API, web, mobile, tests e2e.
**Lot 6b (CI verte)** : marketplace de modules (soumission, revue automatique, décision racine, installation avec consentement, mises à jour, avis, retrait), connecteurs ministères (Gabon : MEN, MESR ; sandbox et HTTP), comptes d'inspecteurs, API publique (OAuth2 client credentials, REST, GraphQL, quotas, portail `/developers`), webhooks sortants signés avec relance, modules du registre correspondants ; web (Ministères, API, Marketplace, Développeurs) et mobile (Ministères, Marketplace). 75 tests e2e API, 80 tests shared.
**Limites connues**
- Quotas API en mémoire (un seul processus) ; le connecteur HTTP ministériel est générique (à aligner sur les API réelles) ; sandbox des modules tiers : pas d'isolation conteneur.
- Préparation des transmissions et administration des clients API / soumission de modules : web uniquement (administration lourde, documenté).
- Pas de tâche planifiée automatique pour `run-due` ni pour la relance des webhooks (endpoints prêts).
**Lot 6c (CI verte)** : assistant pédagogique génératif (résumés, QCM → brouillon de quiz, exercices, traduction, aide à la correction validée, tuteur filtré par âge) et VR/AR (`xr_assets`, rattachés aux leçons et ressources, visite publique 360°, visionneuse WebXR et mobile) ; web (/assistant, /xr, leçons, site public) et mobile (assistant, tuteur, visionneuse). Tests : 87 shared, e2e API 6c.
**Limites 6c**
- Sans `LLM_MODE=live` les réponses sont simulées et signalées comme telles ; la traduction simulée ne traduit pas (marqueur seulement).
- Les fichiers 3D/360° sont référencés par adresse : le téléversement vers MinIO n'est pas encore branché dans l'interface.
- AR mobile : dépend d'ARCore / AR Quick Look de l'appareil ; non vérifié sur appareil réel (aucun émulateur ici).
- L'assistant mobile n'enregistre pas les QCM en brouillon (web seulement).
**Phase 6 terminée** côté code ; fusion dans `main` après CI verte.

## Phase 7 (qualité, sécurité, exploitation, stores) : branche `phase-7-quality`
**Livré (CI verte sauf mention)**
- Sécurité HTTP (`applySecurity`) : en-têtes, CSP, CORS strict, limites de débit (général et /auth), taille de corps ; tests e2e.
- Suppression de compte dans l'application, demande d'effacement d'un enfant par le parent, effacement d'un élève par l'établissement (`students:erase`) ; pages légales FR/EN (modèles à compléter).
- Seed de démonstration Gabon (`npm run seed:demo`) : 4 établissements (primaire, collège, lycée, université), comptes pour chaque rôle, notes dans l'échelle locale, idempotent, refusé en production ; test e2e. Comptes sans mot de passe en mode sandbox ; `npm run seed:keycloak` les crée dans Keycloak avec le même identifiant.
- **Connexion réelle OIDC code + PKCE** (web et mobile/AppAuth), `GET /auth/config`, realm Keycloak importable (`infra/keycloak`, jetons 5 min, rotation du refresh, MFA possible), renouvellement silencieux, déconnexion unique.
- **Hors ligne corrigé** : 5xx/429/jeton expiré ne sont plus rangés à tort dans le journal des conflits (écriture conservée, ordre gardé) ; clés d'idempotence de bout en bout (table `idempotency_keys`, intercepteur global, files web et mobile) ; règles de synchronisation partagées et testées (priorité aux notes des enseignants, fusion des absences) ; données hors ligne isolées par utilisateur (poste partagé).
- Tâches planifiées (`SchedulerService`) : purge GPS, purge du casier, rappels de paiement, transmissions ministères dues, relance des webhooks ; verrou consultatif PostgreSQL (un seul réplica par cycle) ; test e2e.
- Exploitation : `/metrics` Prometheus protégé par jeton, alertes (p95 > 200 ms, 5xx, API arrêtée), tableau Grafana, Sentry sans corps ni en-têtes, Dockerfiles API/web, compose complet (API, web, seed, Keycloak avec import du realm), manifestes Kubernetes durcis (non-root, NetworkPolicy, HPA, PDB, limite au bord). Corrigés : tests SQL montés dans l'init Postgres, port du service IA.
- Préparation des stores : icône et splash, signature release depuis `key.properties`, entitlements iOS, Fastlane (piste interne Play, TestFlight), workflows `release-android` / `release-ios`, dossier `store/`, `docs/PUBLICATION_STORES.md`.
- Tests IA (qualité, biais/équité) déjà présents dans `apps/ai/tests`.
**Livré depuis (branche `phase-8-docs-finish`, CI verte)**
- Certificate pinning mobile (`pinned_client.dart`), stockage local chiffré (`encrypted_store.dart`, remplace Drift/SQLCipher : voir D-064), jeton FCM côté mobile, planificateur, métriques.
- API : configuration de l'échelle de notation par établissement, contrats et charge horaire, remplacements de professeur (notifications), `GET /timetable` pour tous les rôles + vue mensuelle + PDF, compétences (primaire), UE/ECTS et relevé PDF (supérieur), pièces jointes du cahier de textes (jusqu'à 5 Mo) et lien vers un QCM, cahier de textes filtré par classe, gestion des établissements par le Super-Admin racine.
- Mobile : écrans emploi du temps (remplacements), notes (consultation + saisie hors ligne prioritaire), absences (pointage/justification).
- Web : pages Administration (échelle, personnel, remplacements, établissements), Compétences/UE/pièces jointes, emploi du temps par rôle (semaine, mois, PDF, glisser-déposer).
- Guides utilisateur FR/EN, manuel d'administration, déploiement, script de charge `infra/loadtest/p95.mjs`.
**Livré en `phase-9-gaps` (CI verte)**
- Tests e2e web Playwright (5 scénarios : connexion, échelle de notation du lycée/primaire, emploi du temps) dans le job CI `web-e2e` (API sandbox + seed Gabon + build web de production).
- Mobile : pièces jointes (téléchargement avec jeton, aperçu des images) et lien vers le QCM dans le cahier de textes.
- Seed de démonstration : établissement et schéma créés dans une seule transaction.
**Livré en `phase-9b-keycloak`**
- Suppression de compte : désactivation de l'utilisateur Keycloak (adaptateur `IdentityAdapter`, sandbox/live, test unitaire avec faux serveur, e2e du chemin d'échec). Jamais essayé contre un vrai Keycloak.
**Livré en `phase-9c-mobile`**
- Notifications par SMS et e-mail (absences, rappels de paiement, factures, confirmations) en plus du push, avec interrupteurs par personne (`GET/PUT /me/notification-preferences`, web et mobile) ; adaptateurs sandbox/live existants (`SMS_MODE`, `EMAIL_MODE`).
- Mobile : enregistrement d'un QCM généré par l'assistant (classe + matière + validation de l'enseignant).
- Écart de lecture corrigé : la « modération des messages » citée dans les anciens restes à faire ne figure pas dans le cahier des charges ; elle n'est pas développée.
**Livré en `phase-9d-redis`**
- Limites de débit et quotas de l'API publique via Redis (`REDIS_URL`), repli local, test unitaire (faux client) et test contre un vrai Redis en CI. Le cache applicatif, RabbitMQ, Elasticsearch et TimescaleDB restent non branchés.
**Livré en `phase-9e-perf`**
- Le script de charge tourne en CI et fait échouer le job (budget 300 ms, réponses non 2xx = échec). Premier résultat : p95 de 4 à 22 ms sur 6 routes de lecture.
**Reste à faire (aucun report silencieux ; voir `RAPPORT_FINAL.md`)**
- Captures d'écran du README (nécessitent un appareil/navigateur) ; vérification visuelle RTL sur appareil.
- Charge : seule la lecture est mesurée (10 clients, base de démonstration). À faire : écritures, PDF, IA, grosse base, montée à des milliers d'utilisateurs.
**Limites connues** : code vérifié par la CI (pas compilé localement) ; chemin xgboost/shap non testé ; création de jeux et configuration OAA web uniquement (D-023) ; écart D-020 à valider.

## Phase 5 (paiement, GPS, consentements) : branche `phase-5-payment-gps`
**Fait**
- Logique pure testée (13 tests) : unités mineures et devises, remises, échéanciers à somme exacte, affectation aux échéances les plus anciennes, statut de facture, rappels aux jours exacts, signature de webhook (HMAC, anti-rejeu, hex strict), conciliation, statistiques de recouvrement ; fenêtre de consentement GPS (fuseau, jours, plage passant minuit), haversine, filtre de précision, géofencing par transitions, purge, intervalle 30 s.
- Tables SQL (RLS) : plans de frais, factures, échéances, paiements, événements webhook, reçus ; consentements, zones, positions chiffrées, état, événements, journal d'accès.
- API : plans de frais, facture automatique à l'inscription (calculée par `module-payment`, enregistrée par le cœur), factures, paiement en ligne avec `Idempotency-Key`, webhook public signé idempotent, paiements manuels (espèces avec QR signé, chèque, virement), reçus PDF FR/EN, rappels (job quotidien appelable), conciliation, statistiques, annulation ; GPS : consentement révocable avec plage et durée, politique d'envoi pour l'app élève, réception des positions, alertes aux tuteurs consentants, carte/historique/événements, journal d'accès, zones, purge. Adaptateurs : sandbox pour tous les prestataires, Stripe, Airtel Money et Moov Money (réels, non testés faute de compte).
- Web : pages Paiements (famille et comptabilité) et GPS (consentement, carte, événements, zones, journal). Mobile : écrans paiement (hors achat intégré), consentement parent avec carte, envoi de position élève au premier plan et en arrière-plan (intervalle imposé par le serveur), script `tool/configure_native.py` (permissions Android/iOS, modes d'arrière-plan) exécuté en CI.
- Les écritures de paiement, de quiz et de GPS ne sont jamais mises en file hors connexion (web et mobile) : seules les consultations le sont.
**Limites connues / reste à faire**
- Adaptateurs Airtel/Moov/Stripe réels non testés en conditions réelles (identifiants requis) ; Moov au format générique.
- Les positions GPS ne sont pas poussées en temps réel par WebSocket (la page parent interroge toutes les 15 s) ; géofencing évalué à chaque position reçue.
- Reçus PDF : ouverture sur le web ; sur mobile la liste des paiements est affichée mais le PDF n'est pas encore ouvert (à traiter en phase 7).
- Les nouveaux écrans mobiles (Phase 4 et 5) utilisent des textes FR/EN en dur et pas encore les fichiers ARB ; RTL à vérifier : à traiter en phase 7.
- Entitlements iOS (push, localisation) et projet Xcode propre : phase 7 (préparation des stores).
- Surpaiement non crédité (D-029). Rappels : pas encore de tâche planifiée automatique (endpoint prêt).
- Pas de test automatisé de l'envoi de position en arrière-plan sur appareil réel (nécessite émulateur/appareil).

## Phase 6 (orientation, visiteur, ministères, API publique, marketplace…) : branche `phase-6-extensions`
**Lot 6a (CI verte)** : orientation et stages, fiche BEPC/CEP, ressources et forums, espace visiteur public (site, inscription en ligne, contact, statistiques) : API, web, mobile, tests e2e.
**Lot 6b (CI verte)** : marketplace de modules (soumission, revue automatique, décision racine, installation avec consentement, mises à jour, avis, retrait), connecteurs ministères (Gabon : MEN, MESR ; sandbox et HTTP), comptes d'inspecteurs, API publique (OAuth2 client credentials, REST, GraphQL, quotas, portail `/developers`), webhooks sortants signés avec relance, modules du registre correspondants ; web (Ministères, API, Marketplace, Développeurs) et mobile (Ministères, Marketplace). 75 tests e2e API, 80 tests shared.
**Limites connues**
- Quotas API en mémoire (un seul processus) ; le connecteur HTTP ministériel est générique (à aligner sur les API réelles) ; sandbox des modules tiers : pas d'isolation conteneur.
- Préparation des transmissions et administration des clients API / soumission de modules : web uniquement (administration lourde, documenté).
- Pas de tâche planifiée automatique pour `run-due` ni pour la relance des webhooks (endpoints prêts).
**Lot 6c (CI verte)** : assistant pédagogique génératif (résumés, QCM → brouillon de quiz, exercices, traduction, aide à la correction validée, tuteur filtré par âge) et VR/AR (`xr_assets`, rattachés aux leçons et ressources, visite publique 360°, visionneuse WebXR et mobile) ; web (/assistant, /xr, leçons, site public) et mobile (assistant, tuteur, visionneuse). Tests : 87 shared, e2e API 6c.
**Limites 6c**
- Sans `LLM_MODE=live` les réponses sont simulées et signalées comme telles ; la traduction simulée ne traduit pas (marqueur seulement).
- Les fichiers 3D/360° sont référencés par adresse : le téléversement vers MinIO n'est pas encore branché dans l'interface.
- AR mobile : dépend d'ARCore / AR Quick Look de l'appareil ; non vérifié sur appareil réel (aucun émulateur ici).
- L'assistant mobile n'enregistre pas les QCM en brouillon (web seulement).
**Phase 6 terminée** côté code ; fusion dans `main` après CI verte.

## Phase 7 (qualité, sécurité, exploitation, stores) : branche `phase-7-quality`
**Livré (CI verte sauf mention)**
- Sécurité HTTP (`applySecurity`) : en-têtes, CSP, CORS strict, limites de débit (général et /auth), taille de corps ; tests e2e.
- Suppression de compte dans l'application, demande d'effacement d'un enfant par le parent, effacement d'un élève par l'établissement (`students:erase`) ; pages légales FR/EN (modèles à compléter).
- Seed de démonstration Gabon (`npm run seed:demo`) : 4 établissements (primaire, collège, lycée, université), comptes pour chaque rôle, notes dans l'échelle locale, idempotent, refusé en production ; test e2e. Comptes sans mot de passe en mode sandbox ; `npm run seed:keycloak` les crée dans Keycloak avec le même identifiant.
- **Connexion réelle OIDC code + PKCE** (web et mobile/AppAuth), `GET /auth/config`, realm Keycloak importable (`infra/keycloak`, jetons 5 min, rotation du refresh, MFA possible), renouvellement silencieux, déconnexion unique.
- **Hors ligne corrigé** : 5xx/429/jeton expiré ne sont plus rangés à tort dans le journal des conflits (écriture conservée, ordre gardé) ; clés d'idempotence de bout en bout (table `idempotency_keys`, intercepteur global, files web et mobile) ; règles de synchronisation partagées et testées (priorité aux notes des enseignants, fusion des absences) ; données hors ligne isolées par utilisateur (poste partagé).
- Tâches planifiées (`SchedulerService`) : purge GPS, purge du casier, rappels de paiement, transmissions ministères dues, relance des webhooks ; verrou consultatif PostgreSQL (un seul réplica par cycle) ; test e2e.
- Exploitation : `/metrics` Prometheus protégé par jeton, alertes (p95 > 200 ms, 5xx, API arrêtée), tableau Grafana, Sentry sans corps ni en-têtes, Dockerfiles API/web, compose complet (API, web, seed, Keycloak avec import du realm), manifestes Kubernetes durcis (non-root, NetworkPolicy, HPA, PDB, limite au bord). Corrigés : tests SQL montés dans l'init Postgres, port du service IA.
- Préparation des stores : icône et splash, signature release depuis `key.properties`, entitlements iOS, Fastlane (piste interne Play, TestFlight), workflows `release-android` / `release-ios`, dossier `store/`, `docs/PUBLICATION_STORES.md`.
- Tests IA (qualité, biais/équité) déjà présents dans `apps/ai/tests`.
**Reste à faire en Phase 7**
- Certificate pinning mobile ; base locale chiffrée (Drift/SQLCipher) : aujourd'hui files et caches dans le stockage sécurisé de l'appareil.
- Jeton FCM réel côté mobile (envoi simulé tant que Firebase n'est pas configuré) ; tests e2e web (Playwright) ; test de charge (script p95).
- Mobile : écrans EDT, notes et absences en saisie ; remplacement de professeur ; contrats/charge horaire.
**Limites connues**
- Limiteur de débit en mémoire (par réplica) : la limite partagée est portée par l'ingress (`limit-rps`) ; quotas API idem.
- Un jeton d'accès reste valide jusqu'à son expiration (5 min avec Keycloak) après suppression de compte ; la désactivation côté Keycloak se fait avec l'API d'administration (voir INTEGRATIONS).
- Les builds signés (AAB/IPA) ne sont pas exécutables sans vos secrets.

## Prochaine étape
Fusion de `phase-8-docs-finish` dans `main` (CI verte), puis traitement de la liste « Reste à faire » ci-dessus ; question ouverte : licence du dépôt (placeholder propriétaire en place).

## Livré en phase-9f-search
- Adaptateur de recherche Elasticsearch 8 (`SEARCH_MODE`, `ELASTICSEARCH_URL`) pour les ressources pédagogiques : index par établissement, analyseur français sans accents, indexation à la création et au report d'année, `POST /resources/reindex`, repli PostgreSQL. Tests unitaires (faux `fetch`) et test contre un vrai Elasticsearch en CI (`ES_URL_TEST`).
- Reste hors Elasticsearch : recherche du cahier de textes et des autres modules (PostgreSQL). RabbitMQ et TimescaleDB toujours non branchés (D-064).

## Livré en phase-9g-queue
- File d'attente RabbitMQ (`QUEUE_MODE`, `RABBITMQ_URL`) pour l'envoi des SMS et e-mails : file durable, reprises avec délai, file `.dead`, reconnexion du consommateur, repli en envoi direct, mode `inline` par défaut. Tests unitaires et tests contre un vrai RabbitMQ en CI (`RABBITMQ_URL_TEST`).
- Non couvert par la file : push, notifications internes, webhooks sortants (restent synchrones, avec leurs propres reprises). Pas d'outil de rejeu de la file `.dead` (à faire depuis la console RabbitMQ). TimescaleDB toujours non branché.

## Livré en phase-9h-timescale
- `gps_positions` en hypertable TimescaleDB (chunks d'un jour) si l'extension est installée, repli table ordinaire sinon ; tests de la CI dans les deux cas (job api-web avec Timescale, job web-e2e sans).
- Non fait : compression et rétention natives Timescale (voir D-068) ; migration des écoles existantes à lancer via `provision_tenant_schema` (documentée). Plus aucun service de l'infrastructure du cahier 4.2 n'est inutilisé, mais aucun n'a été éprouvé sous forte charge.
