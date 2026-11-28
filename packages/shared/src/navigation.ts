import { roleHas, type RoleCode } from './rbac.ts';

import type { SchoolType } from './oaa-axes.ts';
export const SCHOOL_TYPES: SchoolType[] = ['primary', 'college', 'lycee', 'university'];
type L2 = { fr: string; en: string };

/** What a school calls things, by level. Data, so a school can adapt it and a new level needs no code. */
export interface Vocabulary { student: L2; students: L2; teacher: L2; teachers: L2; head: L2; class: L2; classes: L2; period: L2; subjects: L2; guardian: L2 }
export interface SchoolProfile {
  type: SchoolType; label: L2; vocabulary: Vocabulary;
  hidden: string[];                 // pages hidden by default for this level (a school may re-enable them)
  publicSections: string[];         // sections of the public school site, in order
  homeWidgets: string[];            // blocks of the personal home page
  modules: string[];                // modules recommended when the school is created
}

const V = (o: Partial<Vocabulary>, base: Vocabulary): Vocabulary => ({ ...base, ...o });
const BASE: Vocabulary = {
  student: { fr: 'Élève', en: 'Student' }, students: { fr: 'Élèves', en: 'Students' }, teacher: { fr: 'Enseignant', en: 'Teacher' }, teachers: { fr: 'Enseignants', en: 'Teachers' },
  head: { fr: 'Direction', en: 'Head' }, class: { fr: 'Classe', en: 'Class' }, classes: { fr: 'Classes', en: 'Classes' }, period: { fr: 'Trimestre', en: 'Term' },
  subjects: { fr: 'Matières', en: 'Subjects' }, guardian: { fr: 'Parent', en: 'Parent' },
};

export const SCHOOL_PROFILES: Record<SchoolType, SchoolProfile> = {
  primary: {
    type: 'primary', label: { fr: 'École primaire', en: 'Primary school' },
    vocabulary: V({ teacher: { fr: 'Instituteur', en: 'Teacher' }, teachers: { fr: 'Instituteurs', en: 'Teachers' }, head: { fr: 'Directeur', en: 'Head teacher' } }, BASE),
    hidden: ['/risk', '/orientation', '/academic'],
    publicSections: ['presentation', 'levels', 'news', 'enrol', 'tour', 'contact'],
    homeWidgets: ['today', 'homework', 'news', 'children'],
    modules: ['module-visitor', 'module-oaa', 'module-gamification', 'module-payment', 'module-resources', 'module-gps', 'module-ai-assistant'],
  },
  college: {
    type: 'college', label: { fr: 'Collège', en: 'Lower secondary school' },
    vocabulary: V({ head: { fr: 'Principal', en: 'Principal' }, teacher: { fr: 'Professeur', en: 'Teacher' }, teachers: { fr: 'Professeurs', en: 'Teachers' } }, BASE),
    hidden: ['/academic'],
    publicSections: ['presentation', 'levels', 'results', 'news', 'enrol', 'tour', 'contact'],
    homeWidgets: ['today', 'grades', 'homework', 'news', 'children'],
    modules: ['module-visitor', 'module-oaa', 'module-gamification', 'module-payment', 'module-resources', 'module-gps', 'module-orientation', 'module-ia-predictive', 'module-ai-assistant', 'module-ministry'],
  },
  lycee: {
    type: 'lycee', label: { fr: 'Lycée', en: 'Upper secondary school' },
    vocabulary: V({ head: { fr: 'Proviseur', en: 'Principal' }, teacher: { fr: 'Professeur', en: 'Teacher' }, teachers: { fr: 'Professeurs', en: 'Teachers' }, class: { fr: 'Classe', en: 'Class' } }, BASE),
    hidden: ['/academic'],
    publicSections: ['presentation', 'levels', 'programs', 'results', 'news', 'enrol', 'tour', 'contact'],
    homeWidgets: ['today', 'grades', 'homework', 'orientation', 'news', 'children'],
    modules: ['module-visitor', 'module-oaa', 'module-gamification', 'module-payment', 'module-resources', 'module-gps', 'module-orientation', 'module-ia-predictive', 'module-ai-assistant', 'module-ministry'],
  },
  university: {
    type: 'university', label: { fr: 'Université / enseignement supérieur', en: 'University / higher education' },
    vocabulary: V({ student: { fr: 'Étudiant', en: 'Student' }, students: { fr: 'Étudiants', en: 'Students' }, teacher: { fr: 'Enseignant-chercheur', en: 'Lecturer' }, teachers: { fr: 'Enseignants', en: 'Lecturers' },
      head: { fr: 'Doyen', en: 'Dean' }, class: { fr: 'Promotion', en: 'Cohort' }, classes: { fr: 'Promotions et groupes', en: 'Cohorts and groups' }, period: { fr: 'Semestre', en: 'Semester' }, subjects: { fr: 'Unités d’enseignement', en: 'Course units' }, guardian: { fr: 'Tuteur', en: 'Guardian' } }, BASE),
    hidden: ['/play', '/gps'],
    publicSections: ['presentation', 'programs', 'admissions', 'results', 'news', 'tour', 'contact'],
    homeWidgets: ['today', 'units', 'grades', 'internships', 'news'],
    modules: ['module-visitor', 'module-oaa', 'module-payment', 'module-resources', 'module-orientation', 'module-ia-predictive', 'module-ai-assistant', 'module-ministry'],
  },
};
export const profileOf = (t: string): SchoolProfile => SCHOOL_PROFILES[(SCHOOL_TYPES as string[]).includes(t) ? (t as SchoolType) : 'lycee'];

export interface NavEntry {
  href: string; icon: string; group: 'teach' | 'school' | 'comm' | 'progress' | 'finance' | 'eco' | 'admin';
  label: L2; desc: L2;
  perms: string[];                  // any of these (empty: every signed-in person)
  module?: string;                  // needs this module enabled for the school
  types?: SchoolType[];             // only for these levels (default: all)
  byType?: Partial<Record<SchoolType, { label?: L2; desc?: L2 }>>;
}
export const NAV_GROUPS: Record<NavEntry['group'], L2> = {
  teach: { fr: 'Pédagogie', en: 'Teaching' }, school: { fr: 'Gestion de l’école', en: 'School management' }, comm: { fr: 'Communication', en: 'Communication' },
  progress: { fr: 'Suivi et réussite', en: 'Progress' }, finance: { fr: 'Finances', en: 'Finance' }, eco: { fr: 'Écosystème', en: 'Ecosystem' }, admin: { fr: 'Administration', en: 'Administration' },
};
const e = (href: string, icon: string, group: NavEntry['group'], fr: string, en: string, dfr: string, den: string, perms: string[], extra: Partial<NavEntry> = {}): NavEntry =>
  ({ href, icon, group, label: { fr, en }, desc: { fr: dfr, en: den }, perms, ...extra });

export const NAV_CATALOG: NavEntry[] = [
  e('/timetable', 'calendar', 'teach', 'Emploi du temps', 'Timetable', 'Cours, salles, remplacements, export', 'Classes, rooms, substitutions, export', ['schedule:read']),
  e('/grades', 'grades', 'teach', 'Notes', 'Grades', 'Évaluations, moyennes, bulletins', 'Assessments, averages, report cards', ['grades:read'],
    { byType: { primary: { label: { fr: 'Évaluations', en: 'Assessments' } }, university: { label: { fr: 'Notes et relevés', en: 'Grades and transcripts' } } } }),
  e('/absences', 'absence', 'teach', 'Absences', 'Absences', 'Pointage, justifications, alertes', 'Roll call, justifications, alerts', ['absences:read']),
  e('/lessons', 'book', 'teach', 'Cahier de textes', 'Class log', 'Contenus, devoirs, visas', 'Lessons, homework, approvals', ['lessons:read'],
    { byType: { university: { label: { fr: 'Suivi des cours', en: 'Course log' } } } }),
  e('/academic', 'cap', 'teach', 'Compétences / UE', 'Competencies / Units', 'Compétences, crédits ECTS, relevés', 'Competencies, ECTS credits, transcripts', ['grades:read'],
    { byType: { university: { label: { fr: 'Unités d’enseignement (UE)', en: 'Course units (UE)' }, desc: { fr: 'UE, crédits ECTS, validation, relevés', en: 'Units, ECTS credits, validation, transcripts' } }, primary: { label: { fr: 'Compétences', en: 'Competencies' } } } }),
  e('/resources', 'folder', 'teach', 'Ressources', 'Resources', 'Documents et forums pédagogiques', 'Learning documents and forums', ['resources:read'], { module: 'module-resources' }),

  e('/school/students', 'users', 'school', 'Élèves', 'Students', 'Dossiers, inscriptions, affectations', 'Records, enrolment, placement', ['students:read'],
    { byType: { university: { label: { fr: 'Étudiants', en: 'Students' } } } }),
  e('/school/classes', 'school', 'school', 'Classes', 'Classes', 'Classes, niveaux, matières enseignées', 'Classes, levels, taught subjects', ['students:read'],
    { byType: { university: { label: { fr: 'Promotions et groupes', en: 'Cohorts and groups' } } } }),
  e('/school/subjects', 'book', 'school', 'Matières', 'Subjects', 'Matières, coefficients, catégories', 'Subjects, coefficients, categories', ['students:write'],
    { byType: { university: { label: { fr: 'Unités d’enseignement', en: 'Course units' } } } }),
  e('/school/staff', 'user', 'school', 'Personnel', 'Staff', 'Enseignants, charges horaires, contrats', 'Teachers, workload, contracts', ['staff:read']),
  e('/school/rooms', 'pin', 'school', 'Salles', 'Rooms', 'Salles et capacités', 'Rooms and capacity', ['staff:write'],
    { byType: { university: { label: { fr: 'Amphis et salles', en: 'Lecture halls and rooms' } } } }),
  e('/school/users', 'lock', 'school', 'Utilisateurs', 'Users', 'Comptes, rôles et accès de l’école', 'Accounts, roles and access', ['users:manage']),
  e('/school/settings', 'settings', 'school', 'Paramètres de l’école', 'School settings', 'Vocabulaire, pages visibles, modules', 'Vocabulary, visible pages, modules', ['school:configure']),

  e('/messages', 'chat', 'comm', 'Messages', 'Messages', 'Messagerie sécurisée 1:1 et groupes', 'Secure 1:1 and group messaging', ['messages:all', 'messages:scoped']),
  e('/news', 'news', 'comm', 'Actualités', 'News', 'Annonces, sondages, événements', 'Announcements, polls, events', ['news:read']),
  e('/notifications', 'bell', 'comm', 'Notifications', 'Notifications', 'Alertes et rappels', 'Alerts and reminders', []),

  e('/oaa', 'target', 'progress', 'OAA', 'OAA', 'Score global sur 4 axes', 'Overall score on 4 axes', ['oaa:read'], { module: 'module-oaa' }),
  e('/play', 'game', 'progress', 'Jeux', 'Games', 'XP, badges, défis, examens gamifiés', 'XP, badges, challenges, gamified exams', ['games:read', 'games:play', 'games:create'], { module: 'module-gamification' }),
  e('/risk', 'alert', 'progress', 'Risque', 'Risk', 'IA prédictive : décrochage et échec', 'Predictive AI: dropout and failure', ['predictive:read'], { module: 'module-ia-predictive', types: ['college', 'lycee', 'university'] }),
  e('/orientation', 'compass', 'progress', 'Orientation', 'Guidance', 'Parcours, stages, fiche d’orientation', 'Pathways, internships, guidance form', ['orientation:read'], { module: 'module-orientation', types: ['college', 'lycee', 'university'],
    byType: { university: { label: { fr: 'Stages et insertion', en: 'Internships and careers' } }, college: { label: { fr: 'Orientation et fiche BEPC', en: 'Guidance and exam form' } } } }),
  e('/gps', 'pin', 'progress', 'Suivi GPS', 'GPS tracking', 'Position, zones, consentement parent', 'Location, zones, parental consent', ['gps:read', 'gps:consent', 'gps:report', 'gps:configure'], { module: 'module-gps' }),

  e('/payments', 'card', 'finance', 'Paiements', 'Payments', 'Factures, Mobile Money, reçus', 'Invoices, Mobile Money, receipts', ['billing:read', 'billing:write', 'billing:pay'], { module: 'module-payment',
    byType: { university: { label: { fr: 'Frais de scolarité', en: 'Tuition fees' } } } }),

  e('/ministry', 'bank', 'eco', 'Ministères', 'Ministries', 'Transmissions officielles', 'Official data exchanges', ['ministry:prepare', 'ministry:send'], { module: 'module-ministry' }),
  e('/integrations', 'code', 'eco', 'API', 'API', 'Clients OAuth2, webhooks, quotas', 'OAuth2 clients, webhooks, quotas', ['api:manage'], { module: 'module-public-api' }),
  e('/marketplace', 'store', 'eco', 'Marketplace', 'Marketplace', 'Modules tiers à installer', 'Third-party modules to install', ['marketplace:install'], { module: 'module-marketplace' }),
  e('/assistant', 'spark', 'eco', 'Assistant IA', 'AI assistant', 'Résumés, QCM, traduction, tutorat', 'Summaries, quizzes, translation, tutoring', ['ai:use', 'ai:tutor'], { module: 'module-ai-assistant' }),
  e('/xr', 'cube', 'eco', 'VR / AR', 'VR / AR', 'Contenus 3D et visite à 360°', '3D content and 360° tour', ['xr:read', 'xr:write'], { module: 'module-xr' }),

  e('/administration', 'settings', 'admin', 'Administration', 'Administration', 'Échelles, audit, rapports, modules', 'Scales, audit, reports, modules', ['audit:read', 'grading:configure', 'modules:manage']),
  e('/visitor', 'globe', 'admin', 'Site public', 'Public site', 'Inscriptions en ligne et vitrine', 'Online enrolment and showcase', ['applications:manage', 'site:write'], { module: 'module-visitor' }),
];

export interface NavContext {
  roles: string[]; isRoot?: boolean; schoolType: string; modules: string[];
  has?: (perm: string) => boolean;                // overrides the role lookup (personal rights included)
  hidden?: string[]; shown?: string[];            // school choices: pages hidden / pages re-enabled against the level default
}
export interface NavItemOut { href: string; icon: string; label: L2; desc: L2 }
export interface NavGroupOut { key: NavEntry['group']; title: L2; items: NavItemOut[] }

/** Pages the person may open in this school: right held, module enabled, level concerned, not hidden by the school. Nothing else is listed. */
export function visibleNav(c: NavContext): NavGroupOut[] {
  const prof = profileOf(c.schoolType); const mods = new Set(c.modules);
  const hidden = new Set([...prof.hidden.filter((h) => !(c.shown ?? []).includes(h)), ...(c.hidden ?? [])]);
  const holds = (perm: string) => c.has ? c.has(perm) : c.isRoot || c.roles.some((r) => r === 'root_super_admin' || roleHas(r as RoleCode, perm));
  const groups = new Map<NavEntry['group'], NavItemOut[]>();
  for (const n of NAV_CATALOG) {
    if (!c.isRoot) {
      if (n.perms.length && !n.perms.some(holds)) continue;
      if (n.module && !mods.has(n.module)) continue;
      if (n.types && !n.types.includes(prof.type) && !(c.shown ?? []).includes(n.href)) continue;
      if (hidden.has(n.href)) continue;
    } else if (n.module && !mods.has(n.module)) continue;
    const t = n.byType?.[prof.type];
    groups.set(n.group, [...(groups.get(n.group) ?? []), { href: n.href, icon: n.icon, label: t?.label ?? n.label, desc: t?.desc ?? n.desc }]);
  }
  return (Object.keys(NAV_GROUPS) as NavEntry['group'][]).filter((g) => groups.has(g)).map((g) => ({ key: g, title: NAV_GROUPS[g], items: groups.get(g)! }));
}
/** Pages a school can switch off or on (the settings screen offers exactly these). */
export const TOGGLEABLE_PAGES = NAV_CATALOG.filter((n) => !['/notifications', '/school/settings'].includes(n.href)).map((n) => n.href);
