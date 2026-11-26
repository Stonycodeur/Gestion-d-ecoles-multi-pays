# Mise en ligne (premier usage) — STONY-TECHNOLOGIE

Architecture : base **Supabase** (PostgreSQL + connexion Supabase Auth) · API **Render** (Docker, Francfort) · web **Render** (ou Vercel) · mobile : APK/AAB pointant vers l'API.
Hostinger Business (hébergement mutualisé) n'est pas utilisé : il n'exécute pas de conteneur Docker ni de serveur Node durable.

## 1. Base de données (fait)
Schémas `010`→`080`, puis `090_supabase_auth.sql` et `091_supabase_hardening.sql`, appliqués sur le projet `suobawsxrorkzppmdycr`. Le rôle `app_runtime` (ni superutilisateur, ni contournement RLS) est celui de l'API. Son mot de passe n'est jamais dans le dépôt.
Aucune donnée de démonstration : la base ne contient que le référentiel (rôles, Gabon, Côte d'Ivoire, pays à lettres).

## 2. À faire une seule fois dans Supabase (tableau de bord)
1. **Authentication → Hooks → Custom Access Token** : choisir la fonction `public.custom_access_token_hook` (met rôles, école, enfants/classes dans le jeton). Sans cela, personne ne peut se connecter.
2. **Authentication → Providers → Email** : laisser l'email actif ; désactiver « Allow new users to sign up » (comptes créés uniquement par vous).
3. **Settings → JWT Signing Keys** : vérifier qu'une clé asymétrique (ECC P-256) est active (l'API valide les jetons avec `…/auth/v1/.well-known/jwks.json`).
4. **Authentication → Users → Add user** (cocher « Auto confirm ») pour votre compte, puis dans le **SQL Editor** :
   `SELECT public.link_account('votre@email', 'root_super_admin');`
5. Créer la première école (connecté en root dans l'application : Administration), puis pour chaque compte d'école :
   `SELECT public.link_account('directeur@ecole.ga', 'head', 'slug_ecole');`

## 3. API (Render)
Service `ecolemanager-api`, branche `main`, Dockerfile `apps/api/Dockerfile`, contexte racine. Variables : voir `render.yaml`.
- `DATABASE_URL` : chaîne « Session pooler » de Supabase (Connect → Session pooler) avec l'utilisateur `app_runtime.suobawsxrorkzppmdycr` et le mot de passe `app_runtime`, suffixée de `?sslmode=require`.
- Certificat TLS : le pooler Supabase utilise sa propre autorité de certification. Téléchargez-la (Supabase → Database → Settings → SSL Configuration → Download certificate) et collez son contenu dans la variable `DATABASE_SSL_CA` de Render, puis remplacez `?sslmode=require` par rien (la vérification complète est alors active). Tant que ce n'est pas fait, la chaîne utilise `sslmode=no-verify` : connexion chiffrée mais serveur non vérifié.
- Adaptateurs simulés pour ce premier usage (`ALLOW_SANDBOX_ADAPTERS=1`) : paiements, SMS, email, push, stockage de fichiers, ministères, IA générative **ne sont pas réels**. Voir `docs/INTEGRATIONS.md` pour passer chacun en réel.
- Offre gratuite Render : le service s'endort après ~15 min sans trafic (premier appel : 30 à 60 s). Les tâches planifiées internes ne tournent que réveillé. Pour un usage scolaire réel : offre Starter.

## 4. Web
Service `ecolemanager-web` (Render) avec `NEXT_PUBLIC_API_BASE` = URL de l'API ; puis ajouter l'URL du web dans `CORS_ORIGINS` de l'API. Alternative Vercel : projet importé du dépôt, répertoire racine `apps/web`, option « inclure les fichiers hors du répertoire racine », même variable.

## 5. Mobile
`flutter build apk --release --dart-define=API_BASE=https://<url-api>` (APK de test) ou `appbundle` (Play). Publication sur les stores : `docs/PUBLICATION_STORES.md` (comptes, signature et captures à votre charge).

## 6. Limites connues de ce déploiement
- Création de comptes : via Supabase Authentication + `link_account` (pas encore d'écran d'invitation dans l'application).
- Fichiers (pièces jointes, casier) : stockage simulé tant que `STORAGE_MODE=live` n'est pas configuré (S3/Supabase Storage).
- Pas de Redis/RabbitMQ/Elasticsearch/service IA sur l'offre gratuite : limitation de débit en mémoire, files en ligne, recherche SQL, module IA prédictive à désactiver.
