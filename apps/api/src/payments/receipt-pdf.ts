import PDFDocument from 'pdfkit';

export interface ReceiptData {
  school: string; number: string; date: string; student: string; invoice: string; method: string; amount: string; balance: string; locale: string;
}
const L = {
  fr: { title: 'Reçu de paiement', no: 'Reçu n°', date: 'Date', student: 'Élève', invoice: 'Facture', method: 'Mode de paiement', amount: 'Montant reçu', balance: 'Reste à payer' },
  en: { title: 'Payment receipt', no: 'Receipt no.', date: 'Date', student: 'Student', invoice: 'Invoice', method: 'Payment method', amount: 'Amount received', balance: 'Balance due' },
};
export function receiptPdf(d: ReceiptData): Promise<Buffer> {
  const t = d.locale.startsWith('en') ? L.en : L.fr;
  return new Promise((resolve, reject) => {
    const doc = new PDFDocument({ margin: 48 }); const chunks: Buffer[] = [];
    doc.on('data', (c: Buffer) => chunks.push(c)); doc.on('end', () => resolve(Buffer.concat(chunks))); doc.on('error', reject);
    doc.fontSize(18).text(d.school, { align: 'center' }).moveDown(0.3).fontSize(14).text(t.title, { align: 'center' }).moveDown();
    doc.fontSize(11).text(`${t.no}: ${d.number}`).text(`${t.date}: ${d.date}`).text(`${t.student}: ${d.student}`).text(`${t.invoice}: ${d.invoice}`).text(`${t.method}: ${d.method}`).moveDown();
    doc.font('Helvetica-Bold').text(`${t.amount}: ${d.amount}`).font('Helvetica').text(`${t.balance}: ${d.balance}`);
    doc.end();
  });
}
