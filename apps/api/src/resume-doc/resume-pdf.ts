import PDFDocument from 'pdfkit';
import { CandidateProfile } from '../profile/profile.schema';
import { ResumeBlock, resumeBlocks, ResumeLayout } from './resume-docx';

/*
 * The resume as a PDF, drawn from the same blocks as the Word file, so both
 * read the same to an applicant tracking system: one column, real selectable
 * text in a standard font (no images or text-as-graphics), section headings in
 * capitals, and each role's title, company, location and dates on their own lines.
 */

// Word sizes are in half-points and spacing in twentieths of a point; PDF uses points.
const pt = (halfPoints: number) => halfPoints / 2;
const twips = (t: number) => t / 20;

const FONTS = { regular: 'Helvetica', bold: 'Helvetica-Bold', italic: 'Helvetica-Oblique' };

/**
 * The built-in PDF fonts only cover Western European characters. Swap the
 * common typographic ones for plain equivalents, and drop anything else the
 * font can't draw, so nothing turns into garbage glyphs.
 */
export function pdfSafe(text: string): string {
  return text
    .replace(/[‘’‛]/g, "'")
    .replace(/[“”‟]/g, '"')
    .replace(/[‐‑‒−]/g, '-')
    .replace(/ /g, ' ')
    .replace(/[^\x09\x0A\x0D\x20-\x7E -ÿ–—•…€]/g, '');
}

export async function buildResumePdf(p: CandidateProfile, layout: ResumeLayout = 'standard', opts: { compress?: boolean } = {}): Promise<Buffer> {
  const doc = new PDFDocument({
    size: 'LETTER',
    margins: { top: twips(720), bottom: twips(720), left: twips(900), right: twips(900) },
    compress: opts.compress ?? true,
    info: { Title: p.fullName ? `${p.fullName} - Resume` : 'Resume', Author: p.fullName ?? 'Job Apply', Creator: 'Job Apply' },
  });
  const chunks: Buffer[] = [];
  doc.on('data', (c: Buffer) => chunks.push(c));
  const done = new Promise<Buffer>((resolve, reject) => {
    doc.on('end', () => resolve(Buffer.concat(chunks)));
    doc.on('error', reject);
  });

  const left = doc.page.margins.left;
  const width = doc.page.width - left - doc.page.margins.right;
  doc.fillColor('black');

  for (const b of resumeBlocks(p, layout)) draw(doc, b, left, width);
  doc.end();
  return done;
}

function draw(doc: PDFKit.PDFDocument, b: ResumeBlock, left: number, width: number) {
  switch (b.kind) {
    case 'name':
      doc.font(FONTS.bold).fontSize(pt(36)).text(pdfSafe(b.text), left, doc.y, { width, align: b.center ? 'center' : 'left' });
      doc.y += 2;
      return;
    case 'line': {
      const font = b.bold ? FONTS.bold : b.italics ? FONTS.italic : FONTS.regular;
      doc.font(font).fontSize(pt(b.size ?? 21)).text(pdfSafe(b.text), left, doc.y, { width, align: b.center ? 'center' : 'left' });
      doc.y += twips(b.after ?? 40);
      return;
    }
    case 'heading': {
      doc.y += twips(240);
      // Keep a heading with at least a couple of lines of what follows it.
      if (doc.y + 48 > doc.page.height - doc.page.margins.bottom) doc.addPage();
      doc.font(FONTS.bold).fontSize(pt(24)).text(pdfSafe(b.text.toUpperCase()), left, doc.y, { width });
      const y = doc.y + 1;
      doc.save().moveTo(left, y).lineTo(left + width, y).lineWidth(0.6).strokeColor('#999999').stroke().restore();
      doc.y = y + twips(80);
      return;
    }
    case 'bullet': {
      doc.font(FONTS.regular).fontSize(pt(21));
      const indent = twips(360);
      const text = pdfSafe(b.text);
      // Start a bullet on the next page rather than split it, so the dot stays with its text.
      const height = doc.heightOfString(text, { width: width - indent });
      if (doc.y + height > doc.page.height - doc.page.margins.bottom) doc.addPage();
      const top = doc.y;
      doc.text('•', left + indent - twips(260), top, { lineBreak: false });
      doc.text(text, left + indent, top, { width: width - indent });
      doc.y += twips(40);
      return;
    }
    case 'gap':
      doc.y += twips(80);
      return;
  }
}
