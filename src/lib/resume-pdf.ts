import 'server-only';
import { PDFDocument, rgb, StandardFonts, type PDFFont, type PDFPage } from 'pdf-lib';
import { EDUCATION_STATUS, periodLabel, type Education, type Experience, type Reference } from '@/lib/resume';
import { formatPhone } from '@/lib/validation';

export interface ResumePdfInput {
  full_name: string; headline?: string | null; summary?: string | null; email?: string | null; phone?: string | null; neighborhood?: string | null;
  experiences: Experience[]; education: Education[]; skills: string[]; references: Reference[]; photo?: Uint8Array | null;
}

// As fontes padrão do PDF usam WinAnsi (português completo); o resto vira "?".
const safe = (s: string) => s.normalize('NFC').replace(/[^\x20-\x7E\xA0-\xFF•–—“”‘’€]/g, '?');

const INK = rgb(0x1f / 255, 0x17 / 255, 0x12 / 255);
const MUTED = rgb(0x6b / 255, 0x5a / 255, 0x4c / 255);
const AMBER = rgb(0xef / 255, 0x96 / 255, 0x14 / 255);

/** Gera o currículo em PDF (A4), com o mesmo conteúdo que aparece no app. */
export async function resumePdf(r: ResumePdfInput, footer: string): Promise<Uint8Array> {
  const doc = await PDFDocument.create();
  doc.setTitle(safe(`Currículo - ${r.full_name}`));
  doc.setProducer('Próximo');
  const font = await doc.embedFont(StandardFonts.Helvetica);
  const bold = await doc.embedFont(StandardFonts.HelveticaBold);
  const W = 595.28, H = 841.89, M = 50;
  let page: PDFPage = doc.addPage([W, H]);
  let y = H - M;

  const newPage = () => { page = doc.addPage([W, H]); y = H - M; };
  const lines = (text: string, f: PDFFont, size: number, width: number) => {
    const out: string[] = [];
    for (const para of safe(text).split('\n')) {
      let cur = '';
      for (const word of para.split(/\s+/)) {
        const next = cur ? `${cur} ${word}` : word;
        if (f.widthOfTextAtSize(next, size) > width && cur) { out.push(cur); cur = word; } else cur = next;
      }
      out.push(cur);
    }
    return out;
  };
  const write = (text: string, { f = font, size = 10.5, color = INK, indent = 0, gap = 4 } = {}) => {
    for (const l of lines(text, f, size, W - 2 * M - indent)) {
      if (y < M + size) newPage();
      page.drawText(l, { x: M + indent, y: y - size, size, font: f, color });
      y -= size + gap;
    }
  };
  const heading = (t: string) => {
    if (y < M + 60) newPage();
    y -= 10;
    page.drawRectangle({ x: M, y: y - 14, width: 4, height: 14, color: AMBER });
    page.drawText(safe(t), { x: M + 10, y: y - 12, size: 13, font: bold, color: INK });
    y -= 24;
  };

  let textX = M;
  if (r.photo) {
    try {
      const img = await doc.embedJpg(r.photo);
      page.drawImage(img, { x: M, y: y - 72, width: 72, height: 72 });
      textX = M + 88;
    } catch { /* sem foto */ }
  }
  page.drawText(safe(r.full_name), { x: textX, y: y - 22, size: 22, font: bold, color: INK });
  if (r.headline) page.drawText(safe(r.headline), { x: textX, y: y - 42, size: 13, font, color: MUTED });
  const contact = [r.neighborhood, r.email, r.phone ? formatPhone(r.phone) : null].filter(Boolean).join('  •  ');
  if (contact) page.drawText(safe(contact), { x: textX, y: y - 60, size: 10, font, color: MUTED });
  y -= r.photo ? 86 : 72;

  if (r.summary) { heading('Sobre mim'); write(r.summary); }
  if (r.experiences.length) {
    heading('Experiências');
    for (const e of r.experiences) {
      write(`${e.role} — ${e.company}`, { f: bold, size: 11 });
      const p = periodLabel(e);
      if (p) write(p, { color: MUTED, size: 9.5 });
      if (e.description) write(e.description, { gap: 3 });
      y -= 6;
    }
  }
  if (r.education.length) {
    heading('Formação');
    for (const e of r.education) {
      write(e.course, { f: bold, size: 11 });
      write([e.school, EDUCATION_STATUS[e.status], e.end].filter(Boolean).join(' • '), { color: MUTED, size: 9.5 });
      y -= 6;
    }
  }
  if (r.skills.length) { heading('Habilidades'); write(r.skills.join('  •  ')); }
  if (r.references.length) {
    heading('Referências');
    for (const ref of r.references) write(`${ref.name}${ref.relation ? ` (${ref.relation})` : ''}${ref.phone ? ` — ${formatPhone(ref.phone)}` : ''}`);
  }
  for (const p of doc.getPages()) p.drawText(safe(footer), { x: M, y: 28, size: 8, font, color: MUTED });
  return doc.save();
}
