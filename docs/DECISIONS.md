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
| D-017 | Axes supplémentaires des profils OAA par niveau (7.5 : créativité, recherche, professionnel, orientation) pondérés 1,0 ; l'axe « contribution sociale » garde 0,5 | Le CDC ne fixe que les pondérations des 4 axes du secondaire ; configurable par établissement (`oaa_config`) |
| D-018 | XP, niveaux (0/100/500/1500), badges et poids d'alimentation de l'OAA : valeurs par défaut, tous configurables par module | Le CDC donne les noms des niveaux, pas les seuils |
| D-019 | Alimentation de l'OAA (tableau 8.4) : quiz de matière → Académique, jeux individuels → Adaptabilité, défis de groupe → Contribution sociale, assiduité → Contribution sociale | Application littérale du tableau 8.4 et de la section 7 |
| D-020 | IA prédictive : résultats visibles du personnel autorisé par défaut ; visibilité famille activable par établissement (`family_visible`) | Le CDC dit « mêmes règles d'accès que l'OAA » ET « parents informés » ; on choisit la prudence pour des mineurs, la lecture littérale reste un réglage. **Écart à valider par le propriétaire** |
| D-021 | Pénalités OAA seulement PROPOSÉES (seuil 40 %) ; la direction décide | Aide à la décision, jamais d'effet automatique sur un mineur |
| D-022 | Quiz : jamais mis en file hors ligne (chrono et anti-triche côté serveur) | Intégrité des examens gamifiés |
| D-023 | Création de quiz, défis, équipes et configuration OAA : web uniquement (administration lourde) ; le mobile les joue et les consulte | CDC 2 : l'administration lourde peut rester web si documentée |
| D-024 | Permission `games:challenge` (école entière) pour les défis, distincte de `games:create` limitée aux classes de l'enseignant | Les défis n'ont pas de classe ; évite l'élargissement des droits des enseignants |
| D-025 | Montants en unités mineures entières ; décimales de la devise tirées d'ICU (XAF 0, EUR 2), devise et moyens de paiement lus dans `countries` | Aucune règle nationale en dur ; pas d'erreur d'arrondi |
| D-026 | Paiements en ligne (Mobile Money, carte) créés « en attente » ; seule la confirmation signée du prestataire (webhook) encaisse. Webhook idempotent par `(provider, event_id)` et par état du paiement ; montant du webhook comparé au montant demandé | Aucune double écriture si le prestataire rejoue un événement |
| D-027 | Espèces, chèque, virement : enregistrés par la comptabilité uniquement (référence unique) ; espèces avec QR signé (24 h) généré pour la famille | Un parent ne peut pas s'auto-déclarer payé |
| D-028 | Numéros de facture et de reçu séquentiels par établissement (verrou consultatif) | Exigence comptable ; unicité garantie en base |
| D-029 | Surpaiement : le reste non affecté est tracé dans le journal d'audit (pas de crédit automatique) | Le CDC ne définit pas d'avoir ; décision comptable laissée à l'établissement |
| D-030 | GPS : le consentement est donné par un tuteur ; l'élève peut seulement le révoquer ; chaque compte tuteur consent pour lui-même (un co-tuteur sans consentement ne voit rien) ; position en direct visible uniquement dans la plage consentie ; durée de conservation choisie ≤ limite de l'établissement | Mineurs : on ne laisse pas un mineur consentir à sa propre surveillance ; minimisation |
| D-031 | Révocation du consentement : purge immédiate des positions de l'élève s'il ne reste aucun consentement actif | Droit à l'effacement |
| D-032 | Positions chiffrées au repos (AES-256-GCM, `GPS_KEY`) ; alertes d'arrivée/sortie/hors zone envoyées seulement aux tuteurs consentants ; positions imprécises (> 100 m) ou périmées (> 10 min) refusées | Évite les fausses alertes ; confidentialité |
| D-033 | Zones d'établissement (école) créées par la direction/admin ; zones personnelles (domicile) par le tuteur | Séparation des responsabilités |
| D-034 | Fiche BEPC/CEP : projection indicative calculée depuis la configuration du pays (`education_systems.national_exam.fiche`) ; le résultat officiel est saisi par un humain dans `exam_outcomes` | Aucune décision automatique ; aucune règle nationale en dur |
| D-035 | Statistiques publiques : les cohortes inférieures au seuil (`min_cohort_public_stats`, défaut 10) ne sont pas publiées ; champ piège du formulaire d'inscription accepté silencieusement | Minimisation, anti-spam |
| D-036 | Modules tiers : gestionnaires = fonctions pures exécutées en bac à sable (worker_threads + contexte `vm` sans globaux, limites mémoire/temps) sur des charges minimisées ; défense en profondeur, pas une garantie contre du code hostile (prévoir conteneur/microVM) | Sécurité du marketplace |
| D-037 | Marketplace : revue automatique (manifeste, compatibilité, noms réservés, permissions dangereuses, constructions interdites) puis décision du Super-Admin racine seul ; l'installation exige l'acceptation explicite des permissions ; une mise à jour ne redemande que les permissions ajoutées | Cahier 6.19 |
| D-038 | Activation des modules persistée dans `public.feature_flags` (écriture immédiate, chargement au démarrage) | Perdue au redémarrage auparavant |
| D-039 | Transmissions ministérielles : préparation (admin) → aperçu → validation par la direction avec confirmation de l'empreinte SHA-256 → envoi ; l'export fichier n'est possible qu'après validation ; reprises avec attente croissante, 5 tentatives max ; jeux de données minimisés par liste blanche de champs | Cahier 6.18 |
| D-040 | Inspecteurs : compte à durée limitée (90 jours max), vérifié à chaque requête dans l'annuaire (révocation immédiate), lecture seule limitée au cahier de textes | Cahier 6.18 |
| D-041 | API publique : jetons d'accès HMAC sans état (10 min) ; client, portées et quota relus à chaque appel (la révocation est immédiate) ; quota en mémoire (Redis nécessaire en multi-instance) ; GraphQL via `graphql` sans Apollo ; webhooks : secret chiffré, garde SSRF (statique + résolution DNS), `WEBHOOK_ALLOW_PRIVATE=true` réservé aux tests | Cahier 6.19 |
| D-042 | Ministères, API publique et marketplace sont des modules du registre (`module-ministry`, `module-public-api`, `module-marketplace`) : routes refusées et webhooks suspendus tant que le module n'est pas activé pour l'établissement ; l'écran mobile n'apparaît que s'il est actif | Architecture modulaire 4.4 |
