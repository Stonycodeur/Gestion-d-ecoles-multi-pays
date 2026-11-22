export type NotificationType = 'grade.published' | 'absence.recorded' | 'schedule.published' | 'message.new' | 'news.published' | 'payment.confirmed' | 'payment.reminder' | 'invoice.issued' | 'gps.alert' | 'oaa.warning' | 'ai.risk' | 'internship.update' | 'application.received' | 'ministry.update' | 'account.erasure';
export type Lang = 'fr' | 'en' | 'ar';

const T: Record<NotificationType, Record<Lang, (p: Record<string, string>) => { title: string; body: string }>> = {
  'grade.published': {
    fr: (p) => ({ title: 'Nouvelle note', body: `${p.subject ?? 'Matière'} : ${p.value ?? ''}` }),
    en: (p) => ({ title: 'New grade', body: `${p.subject ?? 'Subject'}: ${p.value ?? ''}` }),
    ar: (p) => ({ title: 'نقطة جديدة', body: `${p.subject ?? ''}: ${p.value ?? ''}` }),
  },
  'absence.recorded': {
    fr: (p) => ({ title: p.kind === 'late' ? 'Retard signalé' : 'Absence signalée', body: `${p.student ?? 'Élève'} — ${p.date ?? ''}` }),
    en: (p) => ({ title: p.kind === 'late' ? 'Late arrival' : 'Absence recorded', body: `${p.student ?? 'Student'} — ${p.date ?? ''}` }),
    ar: (p) => ({ title: p.kind === 'late' ? 'تأخر' : 'غياب', body: `${p.student ?? ''} — ${p.date ?? ''}` }),
  },
  'schedule.published': {
    fr: () => ({ title: 'Emploi du temps modifié', body: 'Un nouvel emploi du temps est publié.' }),
    en: () => ({ title: 'Timetable updated', body: 'A new timetable has been published.' }),
    ar: () => ({ title: 'تغيير جدول الحصص', body: 'تم نشر جدول جديد.' }),
  },
  'message.new': {
    fr: (p) => ({ title: 'Nouveau message', body: p.from ?? '' }), en: (p) => ({ title: 'New message', body: p.from ?? '' }), ar: (p) => ({ title: 'رسالة جديدة', body: p.from ?? '' }),
  },
  'news.published': {
    fr: (p) => ({ title: 'Actualité', body: p.title ?? '' }), en: (p) => ({ title: 'News', body: p.title ?? '' }), ar: (p) => ({ title: 'خبر', body: p.title ?? '' }),
  },
  'payment.confirmed': {
    fr: (p) => ({ title: 'Paiement confirmé', body: p.amount ?? '' }), en: (p) => ({ title: 'Payment confirmed', body: p.amount ?? '' }), ar: (p) => ({ title: 'تم تأكيد الدفع', body: p.amount ?? '' }),
  },
  'payment.reminder': {
    fr: (p) => ({ title: 'Rappel de paiement', body: p.text ?? '' }), en: (p) => ({ title: 'Payment reminder', body: p.text ?? '' }), ar: (p) => ({ title: 'تذكير بالدفع', body: p.text ?? '' }),
  },
  'internship.update': {
    fr: (p) => ({ title: 'Stage', body: p.text ?? '' }), en: (p) => ({ title: 'Internship', body: p.text ?? '' }), ar: (p) => ({ title: 'التدريب', body: p.text ?? '' }),
  },
  'application.received': {
    fr: (p) => ({ title: 'Nouvelle demande d\'inscription', body: p.text ?? '' }), en: (p) => ({ title: 'New enrolment request', body: p.text ?? '' }), ar: (p) => ({ title: 'طلب تسجيل جديد', body: p.text ?? '' }),
  },
  'ministry.update': {
    fr: (p) => ({ title: 'Transmission ministère', body: p.text ?? '' }), en: (p) => ({ title: 'Ministry transmission', body: p.text ?? '' }), ar: (p) => ({ title: 'إرسال إلى الوزارة', body: p.text ?? '' }),
  },
  'account.erasure': {
    fr: (p) => ({ title: 'Demande de suppression de compte', body: p.text ?? '' }), en: (p) => ({ title: 'Account erasure request', body: p.text ?? '' }), ar: (p) => ({ title: 'طلب حذف حساب', body: p.text ?? '' }),
  },
  'invoice.issued': {
    fr: (p) => ({ title: 'Nouvelle facture', body: p.text ?? '' }), en: (p) => ({ title: 'New invoice', body: p.text ?? '' }), ar: (p) => ({ title: 'فاتورة جديدة', body: p.text ?? '' }),
  },
  'gps.alert': {
    fr: (p) => ({ title: 'Alerte localisation', body: p.text ?? '' }), en: (p) => ({ title: 'Location alert', body: p.text ?? '' }), ar: (p) => ({ title: 'تنبيه الموقع', body: p.text ?? '' }),
  },
  'oaa.warning': {
    fr: (p) => ({ title: 'Score OAA sous le seuil', body: p.value ?? '' }), en: (p) => ({ title: 'OAA score below threshold', body: p.value ?? '' }), ar: (p) => ({ title: 'درجة OAA تحت الحد', body: p.value ?? '' }),
  },
  'ai.risk': {
    fr: (p) => ({ title: 'Alerte accompagnement', body: p.student ?? '' }), en: (p) => ({ title: 'Support alert', body: p.student ?? '' }), ar: (p) => ({ title: 'تنبيه دعم', body: p.student ?? '' }),
  },
};

export function buildNotification(type: NotificationType, lang: Lang, params: Record<string, string> = {}): { title: string; body: string } {
  return (T[type]?.[lang] ?? T[type].fr)(params);
}
