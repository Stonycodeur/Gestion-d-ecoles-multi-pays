import type { Locale } from './i18n';

type L3 = { fr: string; en: string };
export interface NavItem { href: string; icon: string; label: L3; desc: L3 }
export interface NavGroup { title: L3; items: NavItem[] }

/** Single source of truth for the navigation (sidebar + home cards). Arabic falls back to English labels. */
export const NAV: NavGroup[] = [
  { title: { fr: 'Pédagogie', en: 'Teaching' }, items: [
    { href: '/timetable', icon: 'calendar', label: { fr: 'Emploi du temps', en: 'Timetable' }, desc: { fr: 'Cours, salles, remplacements, export', en: 'Classes, rooms, substitutions, export' } },
    { href: '/grades', icon: 'grades', label: { fr: 'Notes', en: 'Grades' }, desc: { fr: 'Évaluations, moyennes, bulletins', en: 'Assessments, averages, report cards' } },
    { href: '/absences', icon: 'absence', label: { fr: 'Absences', en: 'Absences' }, desc: { fr: 'Pointage, justifications, alertes', en: 'Roll call, justifications, alerts' } },
    { href: '/lessons', icon: 'book', label: { fr: 'Cahier de textes', en: 'Class log' }, desc: { fr: 'Contenus, devoirs, visas', en: 'Lessons, homework, approvals' } },
    { href: '/academic', icon: 'cap', label: { fr: 'Compétences / UE', en: 'Competencies / Units' }, desc: { fr: 'Compétences, crédits ECTS, relevés', en: 'Competencies, ECTS credits, transcripts' } },
    { href: '/resources', icon: 'folder', label: { fr: 'Ressources', en: 'Resources' }, desc: { fr: 'Documents et forums pédagogiques', en: 'Learning documents and forums' } },
  ] },
  { title: { fr: 'Communication', en: 'Communication' }, items: [
    { href: '/messages', icon: 'chat', label: { fr: 'Messages', en: 'Messages' }, desc: { fr: 'Messagerie sécurisée 1:1 et groupes', en: 'Secure 1:1 and group messaging' } },
    { href: '/news', icon: 'news', label: { fr: 'Actualités', en: 'News' }, desc: { fr: 'Annonces, sondages, événements', en: 'Announcements, polls, events' } },
    { href: '/notifications', icon: 'bell', label: { fr: 'Notifications', en: 'Notifications' }, desc: { fr: 'Alertes et rappels', en: 'Alerts and reminders' } },
  ] },
  { title: { fr: 'Suivi et réussite', en: 'Progress' }, items: [
    { href: '/oaa', icon: 'target', label: { fr: 'OAA', en: 'OAA' }, desc: { fr: 'Score global de l’élève sur 4 axes', en: 'Overall student score on 4 axes' } },
    { href: '/play', icon: 'game', label: { fr: 'Jeux', en: 'Games' }, desc: { fr: 'XP, badges, défis, examens gamifiés', en: 'XP, badges, challenges, gamified exams' } },
    { href: '/risk', icon: 'alert', label: { fr: 'Risque', en: 'Risk' }, desc: { fr: 'IA prédictive : décrochage et échec', en: 'Predictive AI: dropout and failure' } },
    { href: '/orientation', icon: 'compass', label: { fr: 'Orientation', en: 'Guidance' }, desc: { fr: 'Parcours, stages, fiche d’orientation', en: 'Pathways, internships, guidance form' } },
    { href: '/gps', icon: 'pin', label: { fr: 'Suivi GPS', en: 'GPS tracking' }, desc: { fr: 'Position, zones, consentement parent', en: 'Location, zones, parental consent' } },
  ] },
  { title: { fr: 'Finances', en: 'Finance' }, items: [
    { href: '/payments', icon: 'card', label: { fr: 'Paiements', en: 'Payments' }, desc: { fr: 'Factures, Mobile Money, reçus', en: 'Invoices, Mobile Money, receipts' } },
  ] },
  { title: { fr: 'Écosystème', en: 'Ecosystem' }, items: [
    { href: '/ministry', icon: 'bank', label: { fr: 'Ministères', en: 'Ministries' }, desc: { fr: 'Transmissions officielles', en: 'Official data exchanges' } },
    { href: '/integrations', icon: 'code', label: { fr: 'API', en: 'API' }, desc: { fr: 'Clients OAuth2, webhooks, quotas', en: 'OAuth2 clients, webhooks, quotas' } },
    { href: '/marketplace', icon: 'store', label: { fr: 'Marketplace', en: 'Marketplace' }, desc: { fr: 'Modules tiers à installer', en: 'Third-party modules to install' } },
    { href: '/assistant', icon: 'spark', label: { fr: 'Assistant IA', en: 'AI assistant' }, desc: { fr: 'Résumés, QCM, traduction, tutorat', en: 'Summaries, quizzes, translation, tutoring' } },
    { href: '/xr', icon: 'cube', label: { fr: 'VR / AR', en: 'VR / AR' }, desc: { fr: 'Contenus 3D et visite à 360°', en: '3D content and 360° tour' } },
  ] },
  { title: { fr: 'Gestion', en: 'Management' }, items: [
    { href: '/administration', icon: 'settings', label: { fr: 'Administration', en: 'Administration' }, desc: { fr: 'Paramètres, échelles, audit, rapports', en: 'Settings, scales, audit, reports' } },
    { href: '/visitor', icon: 'globe', label: { fr: 'Site public', en: 'Public site' }, desc: { fr: 'Inscriptions en ligne et vitrine', en: 'Online enrolment and showcase' } },
  ] },
];

export const HOME = { href: '/', icon: 'home', label: { fr: 'Accueil', en: 'Home' } };
export const pick = (v: L3, l: Locale): string => (l === 'fr' ? v.fr : v.en);
export const findItem = (path: string): NavItem | undefined => NAV.flatMap((g) => g.items).find((i) => path === i.href || path.startsWith(`${i.href}/`));

/** Platform group, shown to the root super-admin only (screens that need no school). */
export const PLATFORM: NavGroup = { title: { fr: 'Plateforme', en: 'Platform' }, items: [
  { href: '/root', icon: 'shield', label: { fr: 'Console racine', en: 'Root console' }, desc: { fr: 'Établissements, pays, audit', en: 'Schools, countries, audit' } },
  { href: '/root/accounts', icon: 'users', label: { fr: 'Comptes', en: 'Accounts' }, desc: { fr: 'Créer et gérer les accès', en: 'Create and manage access' } },
  { href: '/root/geography', icon: 'globe', label: { fr: 'Pays et villes', en: 'Countries and cities' }, desc: { fr: 'Continents, pays, provinces, villes', en: 'Continents, countries, provinces, cities' } },
  { href: '/root/roles', icon: 'key', label: { fr: 'Rôles et permissions', en: 'Roles and permissions' }, desc: { fr: 'Ce que chaque rôle peut faire', en: 'What each role may do' } },
  { href: '/root/ads', icon: 'news', label: { fr: 'Publicités de l’accueil', en: 'Home highlights' }, desc: { fr: 'Bandeaux de la page d’accueil', en: 'Home page banners' } },
  { href: '/root/trash', icon: 'trash', label: { fr: 'Corbeille', en: 'Trash' }, desc: { fr: 'Restaurer ou supprimer définitivement', en: 'Restore or delete for good' } },
] };
export const findAny = (path: string): NavItem | undefined => [...PLATFORM.items, ...NAV.flatMap((g) => g.items)].filter((i) => path === i.href || path.startsWith(`${i.href}/`)).sort((a, b) => b.href.length - a.href.length)[0];
