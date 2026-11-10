import { AlignmentType, BorderStyle, Document, HeadingLevel, LevelFormat, Packer, Paragraph, TextRun } from 'docx';
import { CandidateProfile } from '../profile/profile.schema';

/*
 * Builds an ATS-friendly Word resume from a profile: one column, standard
 * section headings, real bullet lists, plain text everywhere (no tables,
 * text boxes, images, headers or footers, which ATS parsers often skip).
 */

const FONT = 'Calibri';

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

/** "2021-03" → "Mar 2021"; "2021" stays. */
export function formatMonth(d: string | null): string | null {
  if (!d) return null;
  const m = /^(\d{4})-(\d{2})$/.exec(d);
  if (!m) return d;
  const month = MONTHS[Number(m[2]) - 1];
  return month ? `${month} ${m[1]}` : d;
}

function heading(text: string): Paragraph {
  return new Paragraph({
    heading: HeadingLevel.HEADING_2,
    spacing: { before: 240, after: 80 },
    border: { bottom: { style: BorderStyle.SINGLE, size: 6, color: '999999', space: 2 } },
    children: [new TextRun({ text: text.toUpperCase(), bold: true, size: 24, font: FONT, color: '000000' })],
  });
}

const line = (text: string, opts: { bold?: boolean; italics?: boolean; after?: number } = {}) =>
  new Paragraph({ spacing: { after: opts.after ?? 40 }, children: [new TextRun({ text, bold: opts.bold, italics: opts.italics, font: FONT, size: 21 })] });

const bullet = (text: string) =>
  new Paragraph({ numbering: { reference: 'bullets', level: 0 }, spacing: { after: 40 }, children: [new TextRun({ text, font: FONT, size: 21 })] });

export function resumeParagraphs(p: CandidateProfile): Paragraph[] {
  const out: Paragraph[] = [];
  if (p.fullName) {
    out.push(
      new Paragraph({
        heading: HeadingLevel.TITLE,
        alignment: AlignmentType.CENTER,
        spacing: { after: 40 },
        children: [new TextRun({ text: p.fullName, bold: true, size: 36, font: FONT, color: '000000' })],
      }),
    );
  }
  if (p.headline) out.push(new Paragraph({ alignment: AlignmentType.CENTER, spacing: { after: 40 }, children: [new TextRun({ text: p.headline, font: FONT, size: 24 })] }));
  const contact = [p.email, p.phone, p.location, ...p.links].filter(Boolean).join(' | ');
  if (contact) out.push(new Paragraph({ alignment: AlignmentType.CENTER, spacing: { after: 120 }, children: [new TextRun({ text: contact, font: FONT, size: 20 })] }));

  if (p.summary) {
    out.push(heading('Summary'), line(p.summary));
  }
  if (p.skills.length) {
    out.push(heading('Skills'), line(p.skills.join(', ')));
  }
  if (p.workHistory.length) {
    out.push(heading('Experience'));
    for (const w of p.workHistory) {
      out.push(line(`${w.title}, ${w.company}`, { bold: true, after: 0 }));
      const dates = [formatMonth(w.startDate), w.current ? 'Present' : formatMonth(w.endDate)].filter(Boolean).join(' – ');
      const meta = [dates, w.location].filter(Boolean).join(' | ');
      if (meta) out.push(line(meta, { italics: true }));
      for (const h of w.highlights) out.push(bullet(h));
      out.push(new Paragraph({ spacing: { after: 80 }, children: [] }));
    }
  }
  if (p.education.length) {
    out.push(heading('Education'));
    for (const e of p.education) {
      const what = [e.degree, e.field].filter(Boolean).join(', ');
      out.push(line([what || null, e.institution, e.endYear ? String(e.endYear) : null].filter(Boolean).join(' | ')));
    }
  }
  if (p.certifications.length) {
    out.push(heading('Certifications'));
    for (const c of p.certifications) out.push(bullet(c));
  }
  if (p.languages.length) {
    out.push(heading('Languages'), line(p.languages.join(', ')));
  }
  return out;
}

export async function buildResumeDocx(p: CandidateProfile): Promise<Buffer> {
  const doc = new Document({
    creator: p.fullName ?? 'Job Apply',
    title: p.fullName ? `${p.fullName} – Resume` : 'Resume',
    styles: { default: { document: { run: { font: FONT, size: 21 } } } },
    numbering: {
      config: [
        {
          reference: 'bullets',
          levels: [{ level: 0, format: LevelFormat.BULLET, text: '•', alignment: AlignmentType.LEFT, style: { paragraph: { indent: { left: 360, hanging: 260 } } } }],
        },
      ],
    },
    sections: [{ properties: { page: { margin: { top: 720, bottom: 720, left: 900, right: 900 } } }, children: resumeParagraphs(p) }],
  });
  return Packer.toBuffer(doc);
}

/** A safe download name, e.g. "Jane Doe - Acme resume.docx". */
export function resumeFileName(name: string | null, company: string | null): string {
  const part = (s: string | null) => (s ?? '').replace(/[^\p{L}\p{N} ._-]/gu, '').replace(/\s+/g, ' ').trim().slice(0, 60);
  const base = [part(name), part(company)].filter(Boolean).join(' - ') || 'Tailored';
  return `${base} resume.docx`;
}
