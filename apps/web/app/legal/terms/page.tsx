import LegalPage, { type LegalSection } from '../../../components/LegalPage';

const S: LegalSection[] = [
  { h: { fr: 'Objet', en: 'Purpose' }, p: {
    fr: ['Ces conditions encadrent l’utilisation d’ÉcoleManager Pro (web et applications mobiles) éditée par STONY-TECHNOLOGIE et mise à disposition par l’établissement [nom] à ses élèves, parents, enseignants et personnels.'],
    en: ['These terms govern the use of ÉcoleManager Pro (web and mobile apps) published by STONY-TECHNOLOGIE and provided by the school [name] to its students, parents, teachers and staff.'] } },
  { h: { fr: 'Comptes', en: 'Accounts' }, p: {
    fr: ['Les comptes sont créés ou validés par l’établissement. Vous êtes responsable de la confidentialité de vos identifiants. Le compte d’un élève mineur est placé sous la responsabilité de ses parents ou tuteurs.'],
    en: ['Accounts are created or validated by the school. You are responsible for keeping your credentials confidential. A minor student’s account is under the responsibility of their parents or guardians.'] } },
  { h: { fr: 'Usage acceptable', en: 'Acceptable use' }, p: {
    fr: ['Il est interdit de porter atteinte à autrui (harcèlement, contenus illicites), d’accéder à des données qui ne vous concernent pas, de perturber le service ou de contourner ses protections. Les messages sont soumis aux règles de communication de l’établissement.'],
    en: ['You must not harm others (harassment, unlawful content), access data that does not concern you, disrupt the service or bypass its protections. Messages follow the school’s communication rules.'] } },
  { h: { fr: 'Paiements', en: 'Payments' }, p: {
    fr: ['Les paiements de scolarité règlent un service réel de l’établissement et s’effectuent par les moyens proposés (Mobile Money, carte, virement, espèces, chèque). Ils ne passent pas par les achats intégrés des boutiques d’applications. Les reçus sont émis automatiquement.'],
    en: ['Tuition payments settle a real service of the school and are made by the available methods (Mobile Money, card, transfer, cash, cheque). They do not use app-store in-app purchases. Receipts are issued automatically.'] } },
  { h: { fr: 'Intelligence artificielle', en: 'Artificial intelligence' }, p: {
    fr: ['Les fonctions d’IA sont une aide : elles peuvent se tromper, et aucune note ni décision n’est enregistrée sans validation d’un enseignant ou de la direction.'],
    en: ['AI features are an aid: they can be wrong, and no grade or decision is recorded without validation by a teacher or the administration.'] } },
  { h: { fr: 'Disponibilité et responsabilité', en: 'Availability and liability' }, p: {
    fr: ['Le service est fourni avec le meilleur effort ; des interruptions de maintenance sont possibles. [Limites de responsabilité à définir avec le conseil juridique.]'],
    en: ['The service is provided on a best-effort basis; maintenance interruptions are possible. [Liability limits to be defined with legal counsel.]'] } },
  { h: { fr: 'Droit applicable', en: 'Governing law' }, p: {
    fr: ['Droit du pays de l’établissement [pays], et juridictions compétentes [à compléter].'],
    en: ['Law of the school’s country [country] and competent courts [to be completed].'] } },
  { h: { fr: 'Contact', en: 'Contact' }, p: { fr: ['[Adresse e-mail et postale de l’établissement]'], en: ['[School e-mail and postal address]'] } },
];
export default function Page({ searchParams }: { searchParams: { lang?: string } }) {
  return <LegalPage title={{ fr: 'Conditions d’utilisation', en: 'Terms of use' }} sections={S} lang={searchParams.lang === 'en' ? 'en' : 'fr'} />;
}
