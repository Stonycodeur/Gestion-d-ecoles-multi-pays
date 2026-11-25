# Rapport final — ÉcoleManager Pro™ (Version 1)

Légende : ✔ fait et vérifié par la CI · ◐ partiel (limite expliquée) · ✘ non fait (justifié).
« Vérifié » = test automatisé exécuté en CI (GitHub Actions : shared+SQL, API+web, service IA, Flutter analyze/test/APK debug). Rien n'a été exécuté sur un appareil réel, ni sur iOS, ni avec de vrais comptes externes.

## 1. Couverture du cahier des charges

| Domaine (section) | État | Détail et limites |
|---|---|---|
| Authentification, rôles, MFA, journal (3, 11) | ✔ | OIDC code + PKCE (Keycloak, realm importable), jetons courts, RBAC + ABAC (`docs/PERMISSIONS.md`), journal de connexions et d'audit. MFA = configuration Keycloak (non testée en réel). |
| Multi-tenant (4.3) | ✔ | Schéma par établissement + RLS forcée, rôle d'exécution restreint, tests d'isolation. |
| Modules à plugins (4.4) | ✔ | Registre, manifestes, activation par établissement, découverte par le mobile. |
| Super-Admin racine immuable (11.2) | ✔ | Déclencheur `protect_root_admin`, journal d'audit non modifiable, tests de suppression/modification impossibles. |
| Établissements (6.2) | ✔ | CRUD par le Super-Admin racine, provisionnement transactionnel du schéma, assistant d'échelles par pays (API + page web). |
| Élèves, personnel (6.3, 6.4) | ✔ | Inscription (dont en ligne), dossier, OAA et facture initiale ; contrats et charge horaire avec alerte de surcharge. |
| Emploi du temps (6.5) | ◐ | Génération par contraintes, conflits, glisser-déposer, remplacements notifiés, vues jour/semaine/mois, PDF, iCal, validation. Glisser-déposer : web seulement (prévu). Génération et validation : web seulement (administration lourde, documenté). |
| Cahier de textes (6.6) | ◐ | Contenu, devoirs, visa, inspecteurs à durée limitée, recherche (PostgreSQL tsvector), pièces jointes ≤ 5 Mo, lien QCM. Mobile : consultation, pièces jointes (téléchargement) et lien QCM. |
| Notes, bulletins, relevés (6.7, 7.3) | ✔ | Échelles configurables (numérique, lettres, mixte, compétences), instantané d'échelle par évaluation, moyennes pondérées multi-échelles, bulletins PDF, compétences (primaire), UE/ECTS et relevé PDF (supérieur). |
| Absences (6.8) | ◐ | Pointage, justification, validation, statistiques, alertes, impact OAA, push/e-mail/SMS via adaptateurs. SMS et e-mail automatiques selon les préférences individuelles (testés avec les adaptateurs sandbox ; Twilio/SMTP jamais essayés en réel). |
| Messagerie (6.9) | ◐ | 1:1 et groupes, règles « qui écrit à qui », pièces jointes, temps réel, chiffrement au repos (pas de chiffrement de bout en bout : D-011). |
| Ressources, forums, orientation, stages, actualités, sondages, casier (6.10–6.16) | ✔ | API, web et mobile (écrans prioritaires) ; rétention configurable et purge planifiée. |
| Multi-pays, Gabon + 2 pays d'exemple (6.17) | ✔ | Référentiel pilote tout (cycles, échelles, calendrier, devise, paiement, cadre légal) ; ajout d'un pays par configuration, prouvé par test. |
| Ministères (6.18) | ◐ | Connecteurs configurables, validation par la direction avec empreinte, journal, relance, sandbox. Les API réelles des ministères gabonais ne sont pas branchées (aucun accès). |
| API publique et marketplace (6.19) | ◐ | REST + GraphQL, clients OAuth2, portées, quotas, webhooks signés, revue, installation, avis. Quotas en mémoire (par réplica) ; les modules tiers sont des fonctions pures en bac à sable `vm`/worker, pas des conteneurs isolés. GraphQL n'existe que sur l'API publique. |
| IA générative (6.20) | ◐ | Résumés, QCM, traduction, aide à la correction, tuteur filtré par âge, pseudonymisation, journal. Modèle simulé par défaut ; mode réel (`LLM_MODE=live`) non testé faute de clé. |
| VR/AR (6.21) | ◐ | Visionneuse three.js/WebXR avec repli 3D, visite 360°, `xr_assets`, visionneuse mobile. Fichiers 3D référencés par URL (pas de téléversement) ; ARCore/ARKit non testés sur appareil. |
| OAA (7) | ✔ | Formule, normalisation 0–100, affichage selon l'échelle active, seuils en % du maximum, hooks, confidentialité ; test 80/70/75/60 → 73 (14,6/20, 7,3/10, 73/100, B). |
| IA prédictive (7.7) | ✔ | FastAPI, XGBoost/scikit-learn + SHAP, données de démonstration, entraînement reproductible, mesure des biais, aide à la décision uniquement, paiement exclu, désactivable. |
| Gamification (8) | ✔ | XP, niveaux, badges, défis, équipes, examens gamifiés avec anti-triche, alimentation de l'OAA. |
| Paiement (9) | ◐ | Facturation, échéanciers, rappels, reçus PDF, remises, devises, conciliation, webhooks idempotents (testés). Stripe, Airtel Money, Moov Money : adaptateur réel écrit mais jamais exécuté sans vos clés ; sandbox testé. |
| Suivi GPS (10) | ◐ | Consentement révocable avec plage horaire, géofencing, historique, purge, journal d'accès, chiffrement. Suivi natif en arrière-plan écrit, jamais essayé sur appareil ; interrogation toutes les 15 s côté parent. |
| Hors ligne (12.4) | ◐ | File d'écritures idempotente, journal des conflits, priorité des notes enseignants, PWA. Magasin local chiffré par fichier (pas Drift/SQLCipher : D-064). Aucun test sur appareil en mode avion. |
| RTL (arabe) | ◐ | Textes et mise en page RTL web/mobile (ARB/i18n). Pas de vérification visuelle sur appareil. |
| Sécurité (11.1) | ◐ | TLS (ingress), JWT courts, CORS strict, en-têtes, validation, limiteur de débit, pinning mobile, audit. Limiteur partagé via Redis si `REDIS_URL` est défini, sinon en mémoire par réplica. Pas d'audit de sécurité externe ni de test d'intrusion. |
| Performance (12.1) | ◐ | Index, pagination ; script `infra/loadtest/p95.mjs` exécuté en CI (job `web-e2e`) : 6 routes de lecture, 10 clients simultanés, 20 s, base de démonstration Gabon, runner partagé → p95 entre 4 et 22 ms, toutes réponses 2xx (budget de 300 ms en CI, cible produit 200 ms). Ce n'est **pas** une preuve de la cible de 10 000 utilisateurs simultanés ni des routes d'écriture, des PDF et de l'IA ; pas de test sur une base volumineuse. Pas de cache applicatif. |
| Accessibilité, i18n (12.2–12.3) | ◐ | Libellés ARIA, FR/EN/AR complets. **Audit WCAG 2.1 A/AA automatisé (axe-core) en CI sur 20 pages web : aucune violation grave ou critique.** Non couvert : violations « modérées », contrôle manuel, lecteur d'écran, accessibilité du mobile. |
| Mobile et stores (4.6) | ◐ | Application Flutter unique ; en CI : analyse, tests, APK debug, **AAB de release construit** (JDK 21), **projet iOS compilé en release sans signature sur runner macOS**, 3 tests d'intégration sur **émulateur Android** contre la vraie API. Signature release/Fastlane/workflows/`store/`/`PUBLICATION_STORES.md` prêts. **AAB et IPA signés non produits** (vos secrets) ; non essayé sur appareil physique (GPS en arrière-plan, push, AR). |
| Infrastructure (4.2) | ◐ | Docker, Kubernetes, Prometheus, Grafana, Sentry. TimescaleDB porte la série GPS quand l'extension est présente (D-068) ; RabbitMQ ne sert qu'à l'envoi des SMS et e-mails (D-067, mode `inline` par défaut) ; Elasticsearch ne sert qu'au classement de la recherche des ressources (D-066, repli PostgreSQL ; cahier de textes et autres modules restent sur PostgreSQL) ; Redis ne sert qu'aux limites de débit et quotas (D-065), pas au cache ni aux sessions. |
| Documentation (13) | ✔ | README, architecture, permissions, intégrations, publication, déploiement, manuel d'administration, guides FR/EN par rôle. |

Rien n'est « reporté à une version ultérieure » : les ◐ ci-dessus sont des limites actuelles, listées pour être corrigées.

## 2. Tests non écrits (écart assumé)
- Tests e2e web avec navigateur : 5 scénarios Playwright seulement (connexion, échelle de notation, emploi du temps) ; les autres pages ne sont pas pilotées par navigateur.
- Tests d'intégration Flutter : 3 scénarios sur émulateur Android (connexion refusée, direction, élève) ; aucun sur simulateur iOS ni sur appareil physique.
- Tests de charge : exécutés en CI (`docs/PERFORMANCE.md`), pas de forte concurrence.

## 3. Ce qui reste à brancher avec vos identifiants
Stripe, Airtel Money, Moov Money, Firebase (FCM) et APNs, SMS/e-mail, Google Maps (si carte hébergée), Keycloak hébergé, modèle de langage, API des ministères. Variables et étapes : `docs/INTEGRATIONS.md`. Chaque service a un adaptateur sandbox activé par variable d'environnement.

## 4. Mise en production
1. Déployer selon `docs/DEPLOIEMENT.md` ; **ne jamais appliquer `infra/k8s/40-jobs.yaml`** (seed de démonstration).
2. Renseigner secrets et modes `*_MODE=live` ; désactiver le mode d'authentification sandbox.
3. Si plusieurs réplicas : définir `REDIS_URL` (limites de débit et quotas partagés).

## 5. Publication sur les stores
Voir `docs/PUBLICATION_STORES.md`. Vous devez : ouvrir les comptes Google Play et Apple Developer, fournir keystore et certificats (jamais commités), identifiants d'application définitifs, captures d'écran, et soumettre les builds (workflows `release-android` / `release-ios`, Fastlane). L'iOS doit être compilé une première fois sur un Mac ou via le runner macOS : des erreurs de première compilation sont possibles.

## 6. Décisions ouvertes
- **Licence du dépôt** : placeholder propriétaire ; à vous de choisir.

## Sécurité (mise à jour phase 10)
Voir `docs/SECURITY.md`. Écarts : Next.js 16 au lieu de 14 (D-069) ; NestJS 12 requiert Node ≥ 22.12 (D-071) ; aucun test d'intrusion externe.

## Performance (mise à jour phase 10c)
Mesures en CI des lectures, PDF, écritures, assistant IA (modèle simulé) et calcul prédictif : p95 de 4 à 910 ms selon la route, tous sous leur budget (`docs/PERFORMANCE.md`). Non démontré : 10 000 utilisateurs simultanés, base volumineuse, latence d'un vrai fournisseur de modèle.
