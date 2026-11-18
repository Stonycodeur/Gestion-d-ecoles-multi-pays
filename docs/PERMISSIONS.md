# Matrice des permissions (annexe D, complétée)
✔ autorisé · ✘ interdit · ◐ restreint (périmètre : ses classes, ses enfants, son propre dossier, ou consentement). SA-R = Super-Admin racine, SA-E = Super-Admin d'établissement, AE = Assistant d'éducation, Cpt = Comptable.

| Fonctionnalité | SA-R | SA-E | Admin | Directeur | Prof | AE | Cpt | Élève | Parent | Visiteur |
|---|---|---|---|---|---|---|---|---|---|---|
| Créer établissement / pays | ✔ | ✘ | ✘ | ✘ | ✘ | ✘ | ✘ | ✘ | ✘ | ✘ |
| Créer Super-Admins | ✔ | ✘ | ✘ | ✘ | ✘ | ✘ | ✘ | ✘ | ✘ | ✘ |
| Créer Admins | ✔ | ✔ | ✘ | ✘ | ✘ | ✘ | ✘ | ✘ | ✘ | ✘ |
| Gérer modules / feature flags | ✔ | ✔ | ✔ | ✘ | ✘ | ✘ | ✘ | ✘ | ✘ | ✘ |
| Configurer échelles de notation (dans les limites du pays) | ✔ | ✔ | ✔ | ✘ | ✘ | ✘ | ✘ | ✘ | ✘ | ✘ |
| Gérer élèves | ✔ | ✔ | ✔ | ✔ | ✘ | ◐ | ✘ | ✘ | ✘ | ✘ |
| Gérer personnel | ✔ | ✔ | ✔ | ✔ | ✘ | ✘ | ✘ | ✘ | ✘ | ✘ |
| Générer / valider EDT | ✘ | ✔ | ✔ | ✔ (valide) | ✘ | ✘ | ✘ | ✘ | ✘ | ✘ |
| Consulter EDT | ✘ | ✔ | ✔ | ✔ | ✔ | ✔ | ✘ | ◐ | ◐ | ✘ |
| Cahier de textes : saisir | ✘ | ✘ | ✘ | ✘ | ✔ | ✘ | ✘ | ✘ | ✘ | ✘ |
| Cahier de textes : viser | ✘ | ✘ | ✘ | ✔ | ✘ | ✘ | ✘ | ✘ | ✘ | ✘ |
| Cahier de textes : consulter | ✘ | ✔ | ✔ | ✔ | ✔ | ✔ | ✘ | ◐ | ◐ | ✘ |
| Saisir notes | ✘ | ✘ | ✘ | ✔ | ◐ | ✘ | ✘ | ✘ | ✘ | ✘ |
| Consulter notes | ✘ | ✔ | ✔ | ✔ | ◐ | ✘ | ✘ | ◐ | ◐ | ✘ |
| Pointer absences | ✘ | ✘ | ✘ | ✔ | ◐ | ✔ | ✘ | ✘ | ✘ | ✘ |
| Justifier / valider absences | ✘ | ✘ | ✘ | ✔ (valide) | ✘ | ✔ (valide) | ✘ | ◐ (justifie) | ◐ (justifie) | ✘ |
| Messagerie (règles 6.9) | ✘ | ◐ | ◐ | ✔ tous | ◐ | ◐ | ◐ | ◐ | ◐ | ✘ |
| Voir OAA | ✘ | ✔ | ✔ | ✔ | ◐ classe | ✘ | ✘ | ◐ propre | ◐ enfant | ✘ |
| Configurer OAA | ✘ | ✔ | ✔ | ✘ | ✘ | ✘ | ✘ | ✘ | ✘ | ✘ |
| IA prédictive (mêmes règles que l'OAA) | ✘ | ✔ | ✔ | ✔ | ◐ classe | ✘ | ✘ | ✘ | ✘ | ✘ |
| Gamification : jouer | ✘ | ✘ | ✘ | ✘ | ◐ crée | ✘ | ✘ | ✔ | ✘ | ✘ |
| Facturer / encaisser | ✘ | ✔ | ✔ | ◐ lecture | ✘ | ✘ | ✔ | ✘ | ✘ | ✘ |
| Payer scolarité | ✘ | ✘ | ✘ | ✘ | ✘ | ✘ | ✘ | ✔ | ✔ | ✘ |
| Suivi GPS enfant | ✘ | ✘ | ✘ | ✘ | ✘ | ✘ | ✘ | ◐ (consent.) | ◐ consent. | ✘ |
| Ministères : préparer / transmettre | ✔ | ✔ | ✔ préparer | ✔ valide | ✘ | ✘ | ✘ | ✘ | ✘ | ✘ |
| Marketplace : publier / retirer | ✔ | ✘ | ✘ | ✘ | ✘ | ✘ | ✘ | ✘ | ✘ | ✘ |
| Marketplace : installer | ✔ | ✔ | ✔ | ✘ | ✘ | ✘ | ✘ | ✘ | ✘ | ✘ |
| IA générative | ✘ | ✔ cfg | ✔ cfg | ✔ | ✔ | ✘ | ✘ | ◐ tutorat | ✘ | ✘ |
| Journal d'audit | ✔ | ◐ tenant | ◐ tenant | ◐ lecture | ✘ | ✘ | ✘ | ✘ | ✘ | ✘ |
| Casier numérique | ✘ | ✔ | ✔ | ✔ | ✘ | ✘ | ✘ | ◐ propre | ◐ enfant | ✘ |
| Espace visiteur | ✔ | ✔ | ✔ | ✔ | ✔ | ✔ | ✔ | ✔ | ✔ | ✔ |
| Inspecteur (compte à durée limitée) | cahier de textes en lecture seule, jusqu'à date d'expiration |||||||||

Les lignes sont des permissions `module:action` (ex. `grades:write`) portées par `role_permissions` ; les cellules ◐ sont des règles ABAC évaluées par l'API (classe, lien parent-enfant, consentement). Le rôle racine est protégé par trigger.
