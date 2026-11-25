# Sécurité — mesures et risques résiduels

## Mesures en place (cahier 11.1)
- TLS et HSTS (production), JWT courts, OIDC avec algorithmes asymétriques uniquement, RBAC + ABAC, RLS forcé par établissement, journal d'audit non modifiable, Super-Admin racine immuable.
- En-têtes de sécurité, CORS strict (jamais `*`), limites de débit (Redis partagé), taille de corps limitée, **corps compressés refusés (415)**, validation des entrées.
- **Appels sortants (webhooks, connecteurs ministères)** : HTTPS obligatoire, adresses résolues vérifiées (aucune adresse privée, loopback ou métadonnées cloud), redirections désactivées (`core/ssrf.ts`). Limite connue : la résolution DNS est faite juste avant l'appel (fenêtre de « DNS rebinding » très courte, non éliminée).
- **Démarrage en production refusé** si la configuration est dangereuse (`core/production-config.ts`) : authentification sandbox, clés absentes ou de mauvaise taille, CORS ouvert ou non HTTPS, webhooks vers réseau privé, adaptateurs simulés (sauf `ALLOW_SANDBOX_ADAPTERS=1` pour une démo ou un pré-production).
- Images Docker non root, pods Kubernetes restreints, politiques réseau.
- CI : recherche de secrets et de fichiers de signature suivis par git, audit des dépendances de production (`infra/security/audit-gate.mjs`).

## Dépendances : exceptions acceptées (à lever)
Les correctifs de `@nestjs/platform-express`, `@nestjs/swagger` (donc `body-parser`, `multer`, `js-yaml`, `lodash`) n'existent que dans NestJS 12 (changement majeur). Analyse d'accessibilité :
- `multer` : aucun point d'entrée multipart (les pièces jointes sont du JSON base64) → code non atteignable.
- `body-parser` : limite explicite de 1 Mo (8 Mo pour les pièces jointes) et refus de tout corps compressé.
- `js-yaml`, `lodash` : utilisés à la génération de la documentation Swagger, jamais sur des données de requête.
**À faire** : migrer vers NestJS 12 quand l'écosystème (swagger, socket.io, testing) est stabilisé, puis vider la liste `ACCEPTED` du script. Tant que ce n'est pas fait, le risque est résiduel et assumé.

## Signaler une faille
Écrire au responsable de la sécurité de l'établissement exploitant ; ne pas publier la faille avant correction.
