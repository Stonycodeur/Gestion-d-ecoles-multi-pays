import LegalPage, { type LegalSection } from '../../../components/LegalPage';

const S: LegalSection[] = [
  { h: { fr: 'Qui est responsable de vos données', en: 'Who is responsible for your data' }, p: {
    fr: ['Le responsable du traitement est l’établissement scolaire qui vous a ouvert un compte : [nom, adresse, contact du délégué à la protection des données]. ÉcoleManager Pro agit pour son compte en tant que sous-traitant.'],
    en: ['The data controller is the school that opened your account: [name, address, data protection contact]. ÉcoleManager Pro acts on its behalf as processor.'] } },
  { h: { fr: 'Données traitées', en: 'Data we process' }, p: {
    fr: ['Identité et coordonnées, dossier scolaire (classe, notes, absences, cahier de textes, bulletins), messages, scores d’accompagnement (OAA, gamification), données de paiement de scolarité (références, montants ; jamais le numéro de carte, traité par le prestataire de paiement), jetons de notifications, et, avec consentement parental, la position de l’élève.'],
    en: ['Identity and contact details, school record (class, grades, absences, homework diary, report cards), messages, support scores (OAA, gamification), tuition payment data (references, amounts; never card numbers, which stay with the payment provider), notification tokens and, with parental consent, the student’s location.'] } },
  { h: { fr: 'Données des mineurs', en: 'Minors’ data' }, p: {
    fr: ['Les élèves sont souvent mineurs. Les données sont limitées au nécessaire, accessibles selon le rôle (un parent ne voit que ses enfants), jamais utilisées pour de la publicité ni vendues. Les décisions importantes ne sont jamais prises automatiquement : l’IA ne fait que des propositions validées par un adulte responsable.'],
    en: ['Students are often minors. Data is limited to what is necessary, visible according to role (a parent sees only their own children), never used for advertising or sold. Important decisions are never automated: AI only makes proposals validated by a responsible adult.'] } },
  { h: { fr: 'Localisation', en: 'Location' }, p: {
    fr: ['Le suivi de position n’existe qu’avec le consentement d’un parent ou tuteur, limité à une plage horaire choisie, révocable à tout moment. Pendant les heures d’école convenues, l’application de l’élève peut envoyer sa position même lorsqu’elle est en arrière-plan ; le parent la voit sur une carte et reçoit des alertes d’arrivée, de sortie ou de sortie de zone. Les positions sont chiffrées, conservées 30 jours par défaut (durée réglable par l’établissement) puis supprimées ; chaque consultation est journalisée.'],
    en: ['Location tracking exists only with the consent of a parent or guardian, limited to a chosen time window, revocable at any time. During the agreed school hours the student’s app may send its position even in the background; the parent sees it on a map and receives arrival, departure and out-of-zone alerts. Positions are encrypted, kept 30 days by default (adjustable by the school) then deleted; every access is logged.'] } },
  { h: { fr: 'Intelligence artificielle', en: 'Artificial intelligence' }, p: {
    fr: ['Les noms, e-mails et téléphones sont remplacés par des pseudonymes avant tout envoi à un modèle de langage. Les données de paiement ne sont jamais utilisées pour la prédiction. L’établissement peut désactiver ces fonctions.'],
    en: ['Names, e-mails and phone numbers are replaced by pseudonyms before anything is sent to a language model. Payment data is never used for prediction. The school can switch these features off.'] } },
  { h: { fr: 'Cadre légal (Gabon)', en: 'Legal framework (Gabon)' }, p: {
    fr: ['Le traitement est soumis à la loi n°001/2011 relative à la protection des données à caractère personnel, modifiée par la loi n°025/2023, sous le contrôle de l’autorité de protection (APDPVP). [Autres textes applicables au pays de l’établissement : à compléter.]'],
    en: ['Processing is subject to Law No. 001/2011 on personal data protection, as amended by Law No. 025/2023, under the supervision of the protection authority (APDPVP). [Other texts applicable in the school’s country: to be completed.]'] } },
  { h: { fr: 'Conservation', en: 'Retention' }, p: {
    fr: ['Les résultats scolaires sont conservés selon les durées légales de l’établissement ; les documents du casier numérique selon la durée choisie à leur dépôt ; les positions 30 jours par défaut ; les journaux d’audit selon la politique de sécurité [durée].'],
    en: ['School results are kept for the statutory periods that apply to the school; locker documents for the period chosen at upload; locations 30 days by default; audit logs according to the security policy [duration].'] } },
  { h: { fr: 'Vos droits et suppression du compte', en: 'Your rights and account deletion' }, p: {
    fr: ['Vous pouvez demander l’accès, la rectification, l’opposition et la suppression de vos données auprès de l’établissement [contact]. La suppression du compte se fait directement dans l’application (Paramètres → Supprimer mon compte) pour les adultes ; pour un élève, un parent la demande dans l’application et l’administration l’exécute. Les résultats pédagogiques sont alors conservés sans identité, selon les durées légales. Vous pouvez saisir l’autorité de protection des données.'],
    en: ['You may request access, rectification, objection and erasure from the school [contact]. Account deletion is done directly in the app (Settings → Delete my account) for adults; for a student, a parent requests it in the app and the administration carries it out. Educational results are then kept without identity, for the statutory periods. You may lodge a complaint with the data protection authority.'] } },
  { h: { fr: 'Sécurité', en: 'Security' }, p: {
    fr: ['Connexions chiffrées (TLS), jetons de courte durée, cloisonnement strict entre établissements, journal d’audit de toutes les actions sensibles, notifications en cas d’incident conformément à la loi.'],
    en: ['Encrypted connections (TLS), short-lived tokens, strict separation between schools, audit log of all sensitive actions, incident notification as required by law.'] } },
];
export default function Page({ searchParams }: { searchParams: { lang?: string } }) {
  return <LegalPage title={{ fr: 'Politique de confidentialité', en: 'Privacy policy' }} sections={S} lang={searchParams.lang === 'en' ? 'en' : 'fr'} />;
}
