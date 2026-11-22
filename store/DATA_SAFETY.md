# Déclarations des stores / Store declarations (à relire et adapter / review and adapt)

## Google Play — Data safety
| Donnée | Collectée | Partagée | Finalité | Obligatoire | Chiffrée en transit | Suppression |
|---|---|---|---|---|---|---|
| Nom, e-mail, téléphone | Oui | Non (prestataires de traitement uniquement : SMS/e-mail/push) | Gestion du compte, communication | Oui | Oui (TLS) | Suppression du compte dans l'app |
| Identifiants utilisateur | Oui | Non | Authentification | Oui | Oui | Idem |
| Localisation précise (élève) | Oui, uniquement avec consentement parental | Non (visible du parent désigné) | Fonction de suivi du trajet | Non (optionnelle) | Oui | Purge auto 30 j (configurable), retrait du consentement à tout moment |
| Localisation en arrière-plan | Oui (même condition) | Non | Suivi du trajet domicile-école | Non | Oui | Idem |
| Données scolaires (notes, absences, devoirs) | Oui | Non | Fonction principale | Oui | Oui | Demande d'effacement via l'établissement |
| Messages | Oui | Non | Messagerie | Non | Oui | Idem |
| Infos de paiement (statut, montant, référence ; pas de numéro de carte stocké) | Oui | Avec le prestataire de paiement | Paiement de scolarité | Non | Oui | Obligations comptables |
| Identifiant d'appareil / jeton push | Oui | Avec Firebase/APNs | Notifications | Non | Oui | Supprimé avec le compte |
| Journaux de diagnostic | Oui (Sentry, si activé) | Prestataire | Stabilité | Non | Oui | Rétention limitée |

Cases à cocher : pas de vente de données ; pas de publicité ; données de mineurs : l'application s'adresse aussi à des élèves, comptes créés par l'établissement ; section « Familles » : déclarer la conformité à la politique Familles si l'élève < 13 ans est concerné ; URL de suppression de compte : page de la politique de confidentialité + fonction dans l'app (Réglages > Supprimer mon compte).

## Apple — App Privacy (nutrition labels)
- Contact Info (nom, e-mail, téléphone) : liées à l'identité, fonction de l'app, pas de suivi.
- User Content (messages, fichiers) : liés à l'identité, fonction de l'app.
- Identifiers (User ID, Device ID/push token) : liés à l'identité, fonction de l'app.
- Precise Location : liée à l'identité, fonction de l'app (suivi de trajet avec consentement), pas de suivi publicitaire.
- Financial Info (statut de paiement) : fonction de l'app, via le prestataire.
- Other User Data (notes, absences, assiduité) : liées à l'identité, fonction de l'app.
- Diagnostics : non liés à l'identité.
- « Data used to track you » : Aucune. Pas d'App Tracking Transparency nécessaire.

## Justification de la localisation en arrière-plan (Google Play + App Review)
FR : La fonction « suivi de trajet » permet à un parent de savoir que son enfant est bien arrivé à l'école ou rentré à la maison. Elle est désactivée par défaut, activée uniquement après le consentement explicite du parent, limitée à une plage horaire choisie, révocable à tout moment, et la position n'est transmise qu'au parent désigné. L'arrière-plan est indispensable : le téléphone de l'élève est dans le sac pendant le trajet, application fermée à l'écran. Les positions sont chiffrées et purgées après 30 jours.
EN: The commute tracking feature lets a parent know their child arrived at school or home safely. It is off by default, enabled only after the parent's explicit consent, restricted to a chosen time window, revocable at any time, and the position is only shared with the designated parent. Background access is essential because the student's phone is in a bag during the commute. Positions are encrypted and purged after 30 days.
Vidéo de démonstration à fournir pour Google Play : enregistrement du parcours consentement → activation → carte parent.
