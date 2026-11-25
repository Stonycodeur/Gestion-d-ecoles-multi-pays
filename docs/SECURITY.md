# Sécurité — mesures et risques résiduels

## Mesures en place (cahier 11.1)
- TLS et HSTS (production), JWT courts, OIDC avec algorithmes asymétriques uniquement, RBAC + ABAC, RLS forcé par établissement, journal d'audit non modifiable, Super-Admin racine immuable.
- En-têtes de sécurité, CORS strict (jamais `*`), limites de débit (Redis partagé), taille de corps limitée, **corps compressés refusés (415)**, validation des entrées.
- **Appels sortants (webhooks, connecteurs ministères)** : HTTPS obligatoire, adresses résolues vérifiées (aucune adresse privée, loopback ou métadonnées cloud), redirections désactivées (`core/ssrf.ts`). Limite connue : la résolution DNS est faite juste avant l'appel (fenêtre de « DNS rebinding » très courte, non éliminée).
- **Démarrage en production refusé** si la configuration est dangereuse (`core/production-config.ts`) : authentification sandbox, clés absentes ou de mauvaise taille, CORS ouvert ou non HTTPS, webhooks vers réseau privé, adaptateurs simulés (sauf `ALLOW_SANDBOX_ADAPTERS=1` pour une démo ou un pré-production).
- Images Docker non root, pods Kubernetes restreints, politiques réseau.
- CI : recherche de secrets et de fichiers de signature suivis par git, audit des dépendances de production (`infra/security/audit-gate.mjs`).

## Dépendances
Audit des dépendances de production propre (aucun avis connu) depuis la migration vers NestJS 12 et Next.js 16. Le job CI `security` échoue sur tout avis « high » ou « critical » ; la liste d'exceptions de `infra/security/audit-gate.mjs` est vide. NestJS 12 est publié en modules ES : l'API compilée en CommonJS le charge par `require` (Node ≥ 22.12 requis, images Docker en Node 22) et Jest transforme ces modules via Babel (`apps/api/package.json`).

## Signaler une faille
Écrire au responsable de la sécurité de l'établissement exploitant ; ne pas publier la faille avant correction.
