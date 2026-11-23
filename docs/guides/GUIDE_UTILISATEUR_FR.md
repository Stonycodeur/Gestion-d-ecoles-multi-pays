# Guide utilisateur par rôle (français)

ÉcoleManager Pro est disponible sur le web (navigateur, installable comme application) et sur mobile (Android et iOS). Les écrans visibles dépendent de votre rôle et des modules activés par votre établissement : si un module est désactivé, son écran n'apparaît pas.

## Premiers pas (tous les rôles)
1. **Connexion** : ouvrez l'application, saisissez le code de votre établissement si on vous le demande, puis connectez-vous via la page d'authentification de l'école (la double authentification peut être exigée).
2. **Langue et thème** : français, anglais ou arabe (écriture de droite à gauche prise en charge) ; thème clair ou sombre.
3. **Notifications** : acceptez-les pour recevoir absences, notes, changements d'emploi du temps, messages et paiements. Vous pouvez les refuser et consulter la liste dans l'écran Notifications.
4. **Hors connexion** : l'emploi du temps, les notes, le cahier de textes, les absences, la messagerie et les ressources restent consultables sans réseau. Ce que vous saisissez est mis en file d'attente et envoyé au retour de la connexion. Seul le paiement en ligne exige du réseau.
5. **Supprimer mon compte** : écran Compte, bouton « Supprimer mon compte » (exigé par les stores). Le compte du Super-Admin racine ne peut pas être supprimé.

## Élève / Étudiant
- **Emploi du temps** : vues jour, semaine, mois. Les remplacements de professeur apparaissent avec une notification.
- **Notes et bulletins** : affichées dans l'échelle de votre établissement (sur 10, sur 20, sur 100 ou lettres), avec couleur et mention. Les notes anciennes gardent l'échelle d'origine.
- **Cahier de textes** : devoirs, leçons, documents ; devoirs interactifs (QCM) à rendre en ligne.
- **Absences** : consultez vos absences et retards ; justifiez-les en ligne (la direction ou l'assistant d'éducation valide).
- **OAA** : votre score global sur quatre axes (académique, physique, adaptabilité, contribution sociale) et son historique. Les alertes apparaissent en dessous de 50 % du maximum de l'échelle.
- **Jeux et défis** : XP, niveaux (Novice, Apprenant, Expert, Maître), badges, défis, équipes, examens gamifiés.
- **Assistant pédagogique** : tutorat adapté à votre âge ; vos données sont pseudonymisées avant envoi au modèle.
- **Localisation (GPS)** : activée uniquement si vous et votre parent y consentez ; vous pouvez révoquer le consentement et définir une plage horaire.
- **Orientation, stages, ressources, forums, actualités, casier numérique, visite 3D/AR.**

## Parent / Tuteur
- Vous voyez uniquement **vos enfants** : emploi du temps, cahier de textes, notes, absences, OAA, casier.
- **Justifier une absence** en ligne, avec pièce jointe.
- **Payer la scolarité** : Mobile Money (Airtel Money, Moov Money), carte, virement ; échéanciers, reçu PDF. Sur mobile, c'est un paiement de service réel (hors achat intégré).
- **Suivi GPS** : donnez ou retirez votre consentement ; carte en temps réel, zones (géofencing), historique, alertes d'arrivée, de sortie et de sortie de zone. Les positions sont purgées après 30 jours (durée configurable par l'établissement) ; chaque consultation est journalisée.
- **Messagerie** : vous pouvez écrire aux enseignants de vos enfants et à la direction (règles « qui peut écrire à qui »).

## Enseignant
- **Emploi du temps** : vos cours et vos remplacements.
- **Cahier de textes** : contenu riche, devoirs, progression, DS, pièces jointes, QCM ; la direction appose son visa.
- **Notes** : créez une évaluation (l'échelle active est figée à la création), saisissez les notes selon min, max, pas et format de l'échelle (ex. 0 à 20 par 0,25 ou une lettre) ; coefficients configurables. En hors ligne, vos saisies de notes sont prioritaires à la synchronisation.
- **Absences** : pointage par séance.
- **OAA et IA prédictive** : uniquement pour vos classes ; l'IA est une aide à la décision, jamais une décision automatique, et n'utilise aucune donnée de paiement.
- **IA générative** : résumés de cours, QCM, exercices, traduction FR/EN, aide à la correction. Rien n'est enregistré sans votre validation.
- **Jeux éducatifs et examens gamifiés** : créez des quiz, défis et épreuves.
- **Ressources, forums, contenus 3D/AR** rattachés à vos leçons.

## Direction (Directeur, Proviseur, Doyen)
- **Emploi du temps** : valider puis publier la version proposée ; les conflits de salle, d'enseignant et de classe sont détectés.
- **Cahier de textes** : apposer le visa ; créer des **accès inspecteur à durée limitée**.
- **Bulletins** : génération PDF avec logo et en-tête de l'établissement, archivage.
- **Absences** : valider les justifications ; statistiques et alertes de seuil.
- **OAA, IA prédictive** : tableaux de bord, facteurs explicatifs, pistes d'accompagnement ; classement désactivable.
- **Ministères** : valider les transmissions préparées par l'administration (effectifs, résultats), suivre le journal des échanges et relancer.
- **Messagerie** : accès à tous les fils selon les règles.

## Administrateur d'établissement (Super-Admin d'établissement, Admin)
Voir aussi le manuel d'administration (`docs/ADMIN_MANUAL.md`).
- **Élèves et personnel** : inscription, affectation aux classes, statuts ; contrats, charge horaire et alertes de surcharge.
- **Emploi du temps** : génération automatique par contraintes, glisser-déposer (web), **remplacement de professeur** (le remplaçant doit être libre, familles et enseignants notifiés).
- **Échelles de notation** : choix parmi les échelles du pays, couleurs, date d'effet ; une modification ne touche que les nouvelles évaluations.
- **Modules** : activer ou désactiver par établissement ; installer des modules du marketplace après lecture des permissions demandées.
- **Paiement** : plans de frais, factures, remises, rappels, conciliation, statistiques de recouvrement.
- **Espace visiteur** : site vitrine, demandes d'inscription en ligne, actualités publiques, visite virtuelle 360°.
- **API publique** : clients OAuth2, quotas, webhooks signés.
- **Journal d'audit** : consultation des actions de l'établissement.

## Comptable / Intendance
- Facturation, échéanciers, encaissements (espèces avec QR, chèque, virement, Mobile Money, carte), reçus, relances, conciliation, statistiques de recouvrement. Aucun accès aux notes ni aux données pédagogiques.

## Assistant d'éducation
- Pointage des absences, validation des justifications, consultation de l'emploi du temps et du cahier de textes, messagerie selon les règles.

## Visiteur (sans connexion)
- Site de l'école, actualités publiques, contact, statistiques publiques, visite virtuelle 360°, inscription en ligne.

## Aide
En cas de problème de connexion ou d'accès, contactez l'administration de votre établissement. Pour la confidentialité et les droits sur vos données (loi gabonaise n°001/2011 modifiée par la loi n°025/2023), voir la page « Politique de confidentialité » de l'espace public.
