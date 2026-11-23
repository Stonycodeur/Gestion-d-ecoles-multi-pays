import PDFDocument from 'pdfkit';

const render = (build: (d: InstanceType<typeof PDFDocument>) => void): Promise<Buffer> =>
  new Promise((resolve, reject) => {
    const doc = new PDFDocument({ margin: 40 });
    const chunks: Buffer[] = [];
    doc.on('data', (c: Buffer) => chunks.push(c)); doc.on('end', () => resolve(Buffer.concat(chunks))); doc.on('error', reject);
    build(doc); doc.end();
  });

export interface TranscriptPdf {
  school: string; student: string; year: string; locale: string; general: string | null; mention?: string;
  creditsAcquired: number; creditsTotal: number;
  lines: { code: string; title: string; semester: string; credits: number; grade: string; validated: boolean }[];
}
const T = {
  fr: { title: 'Relevé de notes', student: 'Étudiant', year: 'Année', ue: 'UE', credits: 'ECTS', grade: 'Note', ok: 'Validée', ko: 'Non validée', avg: 'Moyenne pondérée', total: 'Crédits acquis' },
  en: { title: 'Transcript of records', student: 'Student', year: 'Year', ue: 'Unit', credits: 'ECTS', grade: 'Grade', ok: 'Passed', ko: 'Not passed', avg: 'Weighted average', total: 'Credits earned' },
};
export const transcriptPdf = (d: TranscriptPdf) => render((doc) => {
  const t = d.locale.startsWith('en') ? T.en : T.fr;
  doc.fontSize(18).text(d.school, { align: 'center' }).fontSize(14).text(t.title, { align: 'center' }).moveDown();
  doc.fontSize(11).text(`${t.student}: ${d.student}`).text(`${t.year}: ${d.year}`).moveDown();
  for (const l of d.lines) {
    doc.text(`${l.semester} · ${l.code} · ${l.title}  |  ${l.credits} ${t.credits}  |  ${l.grade}  |  ${l.validated ? t.ok : t.ko}`);
  }
  doc.moveDown().font('Helvetica-Bold');
  if (d.general) doc.text(`${t.avg}: ${d.general}${d.mention ? ` (${d.mention})` : ''}`);
  doc.text(`${t.total}: ${d.creditsAcquired} / ${d.creditsTotal}`);
});

export interface TimetablePdf { school: string; title: string; locale: string; slots: { weekday: number; period_index: number; subject_name: string; class_name: string; teacher_name: string; room?: string | null }[] }
const DAYS = { fr: ['', 'Lundi', 'Mardi', 'Mercredi', 'Jeudi', 'Vendredi', 'Samedi', 'Dimanche'], en: ['', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday'] };
export const timetablePdf = (d: TimetablePdf) => render((doc) => {
  const days = d.locale.startsWith('en') ? DAYS.en : DAYS.fr;
  doc.fontSize(18).text(d.school, { align: 'center' }).fontSize(13).text(d.title, { align: 'center' }).moveDown();
  const byDay = new Map<number, TimetablePdf['slots']>();
  for (const s of d.slots) byDay.set(s.weekday, [...(byDay.get(s.weekday) ?? []), s]);
  for (const wd of [...byDay.keys()].sort((a, b) => a - b)) {
    doc.font('Helvetica-Bold').fontSize(12).text(days[wd]).font('Helvetica').fontSize(10);
    for (const s of byDay.get(wd)!.sort((a, b) => a.period_index - b.period_index)) {
      doc.text(`P${s.period_index + 1}  ${s.subject_name} · ${s.class_name} · ${s.teacher_name}${s.room ? ` · ${s.room}` : ''}`);
    }
    doc.moveDown(0.5);
  }
});
