import PDFDocument from 'pdfkit';

export interface ReportPdfData {
  school: string; student: string; className: string; period: string; year: string; locale: string;
  lines: { subject: string; coefficient: number; average: string; mention?: string }[];
  general: string | null; rank: number | null; classSize: number;
}

const L = {
  fr: { title: 'Bulletin de notes', student: 'Élève', cls: 'Classe', period: 'Période', subject: 'Matière', coef: 'Coef.', avg: 'Moyenne', general: 'Moyenne générale', rank: 'Rang' },
  en: { title: 'Report card', student: 'Student', cls: 'Class', period: 'Period', subject: 'Subject', coef: 'Coef.', avg: 'Average', general: 'Overall average', rank: 'Rank' },
};

/** Bulletin PDF (letterhead = school name; logo hook comes from tenant config). Bilingual labels. */
export function reportPdf(d: ReportPdfData): Promise<Buffer> {
  const t = d.locale.startsWith('en') ? L.en : L.fr;
  return new Promise((resolve, reject) => {
    const doc = new PDFDocument({ margin: 48 });
    const chunks: Buffer[] = [];
    doc.on('data', (c: Buffer) => chunks.push(c)); doc.on('end', () => resolve(Buffer.concat(chunks))); doc.on('error', reject);
    doc.fontSize(18).text(d.school, { align: 'center' }).moveDown(0.3);
    doc.fontSize(14).text(t.title, { align: 'center' }).moveDown();
    doc.fontSize(11).text(`${t.student}: ${d.student}`).text(`${t.cls}: ${d.className}`).text(`${t.period}: ${d.period} (${d.year})`).moveDown();
    doc.font('Helvetica-Bold').text(`${t.subject}`, 48, doc.y, { continued: true, width: 260 }).text(`${t.coef}`, { continued: true, width: 60 }).text(`${t.avg}`).font('Helvetica');
    for (const l of d.lines) {
      const y = doc.y;
      doc.text(l.subject, 48, y, { width: 260 }).text(String(l.coefficient), 308, y, { width: 60 }).text(l.mention ? `${l.average} (${l.mention})` : l.average, 368, y);
    }
    doc.moveDown();
    if (d.general) doc.font('Helvetica-Bold').text(`${t.general}: ${d.general}`);
    if (d.rank) doc.text(`${t.rank}: ${d.rank}/${d.classSize}`);
    doc.end();
  });
}
