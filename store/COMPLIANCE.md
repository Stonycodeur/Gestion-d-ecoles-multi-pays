# Checklist de conformité aux règles des stores

## Mineurs
- [ ] Comptes élèves créés uniquement par l'établissement ; pas d'inscription libre d'enfants
- [ ] Pas de publicité, pas de pistage publicitaire, pas de SDK publicitaire
- [ ] Localisation : consentement parental explicite, révocable, plage horaire, purge, journal d'accès (module GPS)
- [ ] Contenus IA filtrés selon l'âge ; pseudonymisation avant envoi à un modèle
- [ ] Google Play : déclaration « Public cible » (inclure enfants si les élèves < 13 ans utilisent l'app) et politique Familles
- [ ] Apple : catégorie Éducation ; si Kids Category visée, respecter 1.3 (pas de liens externes sans contrôle parental)

## Suppression de compte (Google Play + Apple 5.1.1(v))
- [x] Fonction dans l'app : Réglages > Supprimer mon compte (confirmation en tapant DELETE)
- [x] Demande d'effacement d'un enfant par le parent (traitée par l'établissement, `/account/erasure-request`)
- [ ] URL web de suppression à renseigner dans la Play Console (page « politique de confidentialité » publique)

## Paiements
- [x] La scolarité est un service réel fourni hors de l'app → hors achat intégré (Apple 3.1.3(e) / Google Play Payments policy : services physiques/réels)
- [ ] Aucun contenu numérique, bonus ou déverrouillage de fonctions vendu dans l'app
- [ ] Les écrans de paiement n'affichent que les moyens de paiement de l'école (Mobile Money, carte, virement…)

## Permissions (justification affichée avant la demande système)
| Permission | Raison | Moment de la demande |
|---|---|---|
| Notifications | Absences, notes, messages, paiements, alertes | Onboarding |
| Localisation (au premier plan) | Suivi du trajet de l'élève, avec consentement parental | Après consentement |
| Localisation en arrière-plan | Idem, téléphone en poche | Après consentement, écran explicatif dédié |
| Caméra | Scan de QR (paiement espèces, pointage) | Au premier scan |
| Biométrie | Déverrouillage optionnel | Réglages |

## Divers
- [ ] Politique de confidentialité et conditions publiées : /legal/privacy et /legal/terms (compléter les [crochets])
- [ ] Compte de démonstration pour les réviseurs (voir seed Gabon) fourni dans les notes de revue
- [ ] Contact support et site web renseignés
- [ ] Classification de contenu (questionnaire IARC / âge Apple) remplie
- [ ] Respect de la loi gabonaise n°001/2011 modifiée par la loi n°025/2023 (APDPVP) : déclaration/autorisation de traitement à faire par l'établissement responsable
