export type Locale = 'fr' | 'en' | 'ar';
const D: Record<Locale, Record<string, string>> = {
  fr: { app: 'ÉcoleManager Pro', login: 'Se connecter', school: 'Code établissement', role: 'Rôle (mode sandbox)', timetable: 'Emploi du temps', grades: 'Notes', absences: 'Absences', lessons: 'Cahier de textes', signout: 'Déconnexion', offline: 'Hors ligne : les saisies sont mises en file', synced: 'Synchronisé', modules: 'Modules actifs' },
  en: { app: 'ÉcoleManager Pro', login: 'Sign in', school: 'School code', role: 'Role (sandbox mode)', timetable: 'Timetable', grades: 'Grades', absences: 'Absences', lessons: 'Class log', signout: 'Sign out', offline: 'Offline: entries are queued', synced: 'Synced', modules: 'Active modules' },
  ar: { app: 'ÉcoleManager Pro', login: 'تسجيل الدخول', school: 'رمز المدرسة', role: 'الدور (وضع تجريبي)', timetable: 'جدول الحصص', grades: 'النقاط', absences: 'الغيابات', lessons: 'دفتر النصوص', signout: 'خروج', offline: 'غير متصل: الإدخالات في الانتظار', synced: 'تمت المزامنة', modules: 'الوحدات النشطة' },
};
export const getLocale = (): Locale => { try { const l = localStorage.getItem('em_locale'); return l === 'en' || l === 'ar' ? l : 'fr'; } catch { return 'fr'; } };
export const setLocale = (l: Locale) => { localStorage.setItem('em_locale', l); document.documentElement.lang = l; document.documentElement.dir = l === 'ar' ? 'rtl' : 'ltr'; };
export const t = (k: string, l: Locale = getLocale()) => D[l][k] ?? k;
