# Décisions

| # | Décision | Raison |
|---|----------|--------|
| D-001 | Valeurs de travail : nom « ÉcoleManager Pro », identifiant `com.ecolemanager.pro` | Non fournis ; modifiables en un seul endroit (pubspec/gradle/Info.plist) |
| D-002 | Pays d'exemple : Côte d'Ivoire (modèle français, /20) et `XL` (code ISO d'usage libre, lettres A+ à E-) | Éviter d'affirmer un barème réel faux pour un pays à lettres ; les deux sont marqués `is_sample` et « à valider » |
| D-003 | Licence provisoire : propriétaire, tous droits réservés | Question restée sans réponse ; à confirmer par le propriétaire |
| D-004 | Gabon primaire : échelle sur 10 (appréciations), collège/lycée et supérieur sur 20 | Le CDC dit « sur 10 ou sur 20, à confirmer » ; changeable par configuration seule |
| D-005 | Mentions du supérieur Gabon (50/60/70/80 % du max) | Hypothèse LMD usuelle, à valider avec le ministère |
| D-006 | Moteur de notation et OAA écrits en TypeScript pur dans `packages/shared`, testés avec `node:test` (aucune dépendance) | Vérifiable sans accès npm ; réutilisé par l'API et le web ; le mobile en porte un équivalent Dart testé avec les mêmes cas (phase 2) |
| D-007 | Score OAA arrondi à l'entier avant conversion/affichage | CDC 7.2 : 72,9 → 73 |
| D-008 | Les niveaux Gabon sont CP1, CP2, CE1, CE2, CM1, CM2 | Le CDC écrit « CP → CM2 » en 6 ans ; découpage CP1/CP2 d'usage |
| D-009 | `protect_root_roles` n'interdit que UPDATE/DELETE ; l'octroi initial passe par le bootstrap | Le trigger CDC 11.2 reste exact ; extension aux tables de rôles |
| D-010 | Provisionnement du schéma tenant par fonction SQL `provision_tenant_schema` | Atomique, testable en SQL, appelée par l'API |
| D-011 | Messages chiffrés au repos (AES-256-GCM, clé `MESSAGE_KEY`) au lieu d'un vrai chiffrement de bout en bout | Le CDC exige une messagerie « sécurisée » avec règles d'accès et modération par la direction ; le E2EE empêcherait la recherche et la conformité mineurs |
| D-012 | Annuaire par établissement (`directory`) liant compte ↔ rôle, classes, enfants, langue, e-mail, téléphone | Source unique pour les règles « qui peut écrire à qui » et pour les destinataires de notifications |
| D-013 | Les règles de messagerie sont revérifiées à chaque envoi (pas seulement à la création du fil) | Un changement de classe ou de rôle doit couper l'accès immédiatement |
| D-014 | Écriture entre élèves d'une même classe : option `ALLOW_STUDENT_PEER_MESSAGING` (désactivée par défaut) | CDC 6.9 : « selon option » ; prudence pour les mineurs |
| D-015 | Notifications : en base (toujours) + temps réel Socket.IO + push via adaptateur ; un échec de push n'échoue jamais l'action métier | Fiabilité des saisies de notes et d'absences |
| D-016 | Accès inspecteur : rôle `inspector` limité à `lessons:read` et expirant via `inspectorUntil` | CDC : accès inspecteurs limité dans le temps |

