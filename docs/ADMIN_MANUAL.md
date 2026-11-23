# Manuel d'administration / Administration manual

## Français

### 1. Rôles d'administration
- **Super-Admin racine** : unique, immuable (déclencheur `protect_root_admin`), ne peut être ni supprimé, ni modifié, ni rétrogradé ; ses contournements sont audités. Il crée les pays, les établissements, les Super-Admins et publie ou retire les modules du marketplace.
- **Super-Admin d'établissement / Admin** : gèrent leur seul établissement (élèves, personnel, emploi du temps, échelles, modules, paiement, API). La matrice complète figure dans `docs/PERMISSIONS.md`.

### 2. Ajouter un pays (par configuration seule)
Aucune règle nationale n'est codée. Un pays se déclare en données dans le référentiel : `countries` (langues, devise, fuseau, moyens de paiement, cadre légal, gabarits, connecteurs ministères), `education_systems` (cycles, niveaux, examen national, échelle par défaut, type de période), `grading_scales` (échelles du pays) et `academic_calendars`. Le Gabon, la Côte d'Ivoire, un pays à lettres (`XL`) et un pays sur le modèle français sont fournis dans `infra/sql/030_seed_countries.sql` ; dupliquez un bloc, adaptez les valeurs, rechargez le seed.

### 3. Créer un établissement
Une ligne dans `tenants` (slug, nom, type primaire / collège / lycée / université, `country_code`) puis `SELECT provision_tenant_schema('<slug>')` crée le schéma PostgreSQL de l'établissement avec ses tables, ses index et sa sécurité par ligne (RLS). Pour la démonstration : `npm --prefix apps/api run seed:demo` (refusé en production sauf `ALLOW_DEMO_SEED=1`).

### 4. Échelle de notation de l'établissement
- Lecture : `GET /settings/grading` (échelle active, échelles autorisées par le pays, surcharges, couleurs). Écriture (droit `grading:configure`) : `PUT /settings/grading` avec `grading_scale_code`, `color_bands` facultatif et `effective_from` (aujourd'hui ou futur).
- L'établissement ne peut choisir **que parmi les échelles de son pays**. Une modification ne touche que les nouvelles évaluations : les notes déjà saisies gardent leur échelle d'origine (copie figée dans l'évaluation) et restent comparables grâce à la base normalisée 0 à 100.
- Seuils d'alerte (50 %) et de pénalité (40 %) sont des pourcentages du maximum, affichés dans l'échelle locale. Couleurs par défaut : vert à partir de 81 %, bleu 61-80, jaune 41-60, orange 21-40, rouge jusqu'à 20 ; une bande doit commencer à 0.

### 5. Personnel, contrats, charge horaire, remplacements
- `POST /staff/contracts`, `GET /staff/contracts`, `GET /staff/workload` : la charge affectée est comparée au plafond (`max_weekly_hours`) et aux heures du contrat en cours ; un enseignant au-dessus est signalé `overloaded`.
- `POST /substitutions` (créneau, date, remplaçant) : la date doit tomber le bon jour de la semaine, le remplaçant doit être libre à cette période ; élèves, familles et enseignants concernés sont notifiés. `GET /substitutions?from&to` alimente la vue de l'emploi du temps, `DELETE /substitutions/:id` annule.

### 6. Modules
`GET /modules` (catalogue), `POST /modules/<nom>/enable` et `/disable` par établissement. Le mobile et le web interrogent `GET /modules/active` et masquent les écrans des modules inactifs. Ajouter un module = déployer son package dans `packages/modules/` avec son manifeste puis l'activer, sans modifier le noyau. Les modules tiers passent par le marketplace (revue de sécurité, permissions affichées avant installation).

### 7. Paiement, GPS, IA
- Paiement : `PAYMENT_MODE=sandbox|live`, secrets de webhook, plans de frais, rappels automatiques (planificateur).
- GPS : consentement parent et élève obligatoire et révocable ; durée de conservation configurable (30 jours par défaut) ; journal d'accès.
- IA prédictive et IA générative : activables ou désactivables par établissement ; aide à la décision uniquement.

### 8. Ministères
Connecteurs déclarés par pays ; transmission planifiée ou à la demande, validée par la direction, journal des échanges et relance ; mode sandbox par défaut. Comptes d'inspecteurs à durée limitée.

### 9. Exploitation
Journal d'audit (non modifiable), métriques Prometheus (`METRICS_TOKEN`), Sentry (`SENTRY_DSN`), planificateur (purges, rappels, relances) ; voir `docs/DEPLOIEMENT.md` et `docs/INTEGRATIONS.md`.

## English

### 1. Administration roles
- **Root super-admin**: single and immutable (`protect_root_admin` trigger); it cannot be deleted, edited or downgraded, and its bypasses are audited. It creates countries, schools and super-admins and publishes or withdraws marketplace modules.
- **School super-admin / Admin** manage their own school only. The full matrix is in `docs/PERMISSIONS.md`.

### 2. Add a country (configuration only)
No national rule is hard-coded. A country is data in the reference tables: `countries`, `education_systems`, `grading_scales`, `academic_calendars`. Gabon, Côte d'Ivoire, a letter-grade country (`XL`) and a French-model country ship in `infra/sql/030_seed_countries.sql`: copy a block, adapt it, reload the seed.

### 3. Create a school
Insert a row in `tenants`, then `SELECT provision_tenant_schema('<slug>')` creates the school's PostgreSQL schema with tables, indexes and row-level security. Demo data: `npm --prefix apps/api run seed:demo` (refused in production unless `ALLOW_DEMO_SEED=1`).

### 4. School grading scale
`GET /settings/grading` reads the active scale, the scales the country allows, overrides and colours; `PUT /settings/grading` (permission `grading:configure`) sets `grading_scale_code`, optional `color_bands` and `effective_from` (today or later). A school can only pick among its country's scales. A change only affects new evaluations: earlier grades keep the scale frozen in their evaluation and stay comparable on the normalised 0-100 base. Warning (50%) and penalty (40%) thresholds are stored as a percentage of the maximum and shown in the local scale.

### 5. Staff, contracts, workload, substitutions
`POST /staff/contracts`, `GET /staff/contracts`, `GET /staff/workload` (assigned hours versus the cap and the current contract; `overloaded` flag). `POST /substitutions` requires the right weekday and a free substitute, and notifies students, families and teachers; `GET /substitutions?from&to` feeds the timetable view; `DELETE /substitutions/:id` cancels.

### 6. Modules
`GET /modules`, `POST /modules/<name>/enable` and `/disable` per school. Web and mobile read `GET /modules/active` and hide inactive modules. Adding a module means deploying its package with its manifest and enabling it, with no change to the core.

### 7. Payments, GPS, AI
`PAYMENT_MODE=sandbox|live`; GPS needs revocable consent, 30-day default retention and an access log; predictive and generative AI can be switched off per school and only support decisions.

### 8. Ministries
Per-country connectors, scheduled or on-demand transmissions validated by the head, exchange log and resend, sandbox by default; time-limited inspector accounts.

### 9. Operations
Immutable audit log, Prometheus metrics (`METRICS_TOKEN`), Sentry (`SENTRY_DSN`), scheduler (purges, reminders, resends). See `docs/DEPLOIEMENT.md` and `docs/INTEGRATIONS.md`.
