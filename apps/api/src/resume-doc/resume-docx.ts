import { AlignmentType, BorderStyle, Document, HeadingLevel, LevelFormat, Packer, Paragraph, TextRun } from 'docx';
import { CandidateProfile } from '../profile/profile.schema';

/*
 * Builds a Word resume from a profile, laid out for applicant tracking
 * systems (ATS): one column, real Word headings and bullet lists, plain text
 * only (no tables, text boxes, images, headers or footers, which parsers
 * often skip). Each role's title, company, location and dates are separate
 * lines, the way resume parsers expect them.
 *
 * Two layouts:
 * - standard: compact, for any ATS.
 * - workday:  tuned for Workday's "Autofill with Resume", which fills its
 *             My Experience page: "Work Experience" heading, numeric MM/YYYY
 *             dates (Workday's From/To fields are month and year), one fact
 *             per line (contact details and education too), ASCII separators.
 */

export const RESUME_LAYOUTS = ['standard', 'workday'] as const;
export type ResumeLayout = (typeof RESUME_LAYOUTS)[number];

/** The ?layout= query value: standard unless it says workday; null if it's something else. */
export function parseLayout(v: unknown): ResumeLayout | null {
  if (v === undefined || v === null || v === '') return 'standard';
  return RESUME_LAYOUTS.includes(v as ResumeLayout) ? (v as ResumeLayout) : null;
}

const FONT = 'Calibri';
const FULL_MONTHS = ['january', 'february', 'march', 'april', 'may', 'june', 'july', 'august', 'september', 'october', 'november', 'december'];
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

/**
 * Reads the date forms people type: "2021-03", "03/2021", "3/2021", "Mar 2021",
 * "March 2021", or a bare "2021". Returns { year, month? }, or null if unreadable.
 */
export function parseMonth(d: string | null): { year: string; month: number | null } | null {
  const s = (d ?? '').trim();
  if (!s) return null;
  let m = /^(\d{4})-(\d{1,2})$/.exec(s);
  if (m) return Number(m[2]) >= 1 && Number(m[2]) <= 12 ? { year: m[1], month: Number(m[2]) } : null;
  m = /^(\d{1,2})\/(\d{4})$/.exec(s);
  if (m) return Number(m[1]) >= 1 && Number(m[1]) <= 12 ? { year: m[2], month: Number(m[1]) } : null;
  m = /^([a-z]{3,9})\.?\s+(\d{4})$/i.exec(s);
  if (m) {
    const name = m[1].toLowerCase();
    const i = FULL_MONTHS.findIndex((full, n) => name === full || name === MONTHS[n].toLowerCase() || (n === 8 && name === 'sept'));
    return i >= 0 ? { year: m[2], month: i + 1 } : null;
  }
  m = /^(\d{4})$/.exec(s);
  return m ? { year: m[1], month: null } : null;
}

/** "2021-03" → "Mar 2021" (standard) or "03/2021" (workday); a bare year stays; unreadable text is kept as typed. */
export function formatMonth(d: string | null, layout: ResumeLayout = 'standard'): string | null {
  if (!d?.trim()) return null;
  const p = parseMonth(d);
  if (!p) return d.trim();
  if (p.month === null) return p.year;
  return layout === 'workday' ? `${String(p.month).padStart(2, '0')}/${p.year}` : `${MONTHS[p.month - 1]} ${p.year}`;
}

export function dateRange(start: string | null, end: string | null, current: boolean, layout: ResumeLayout): string | null {
  const from = formatMonth(start, layout);
  const to = current ? 'Present' : formatMonth(end, layout);
  if (!from && !to) return null;
  // Workday's parser reads a plain ASCII hyphen most reliably.
  return [from, to].filter(Boolean).join(layout === 'workday' ? ' - ' : ' – ');
}

/**
 * The resume as a list of plain blocks, the same for every file format, so
 * the Word and PDF files carry identical text in identical order.
 */
export type ResumeBlock =
  | { kind: 'name'; text: string; center: boolean }
  | { kind: 'line'; text: string; bold?: boolean; italics?: boolean; center?: boolean; size?: number; after?: number }
  | { kind: 'heading'; text: string }
  | { kind: 'bullet'; text: string }
  | { kind: 'gap' };

export function resumeBlocks(p: CandidateProfile, layout: ResumeLayout = 'standard'): ResumeBlock[] {
  const wd = layout === 'workday';
  const out: ResumeBlock[] = [];
  const line = (text: string, opts: Omit<Extract<ResumeBlock, { kind: 'line' }>, 'kind' | 'text'> = {}) => out.push({ kind: 'line', text, ...opts });
  const heading = (text: string) => out.push({ kind: 'heading', text });
  const bullet = (text: string) => out.push({ kind: 'bullet', text });
  const gap = () => out.push({ kind: 'gap' });

  if (p.fullName) out.push({ kind: 'name', text: p.fullName, center: !wd });
  if (p.headline) line(p.headline, { center: !wd, size: 24 });
  const contact = [p.email, p.phone, p.location].filter((x): x is string => Boolean(x));
  if (wd) contact.forEach((c) => line(c, { after: 0 }));
  else if (contact.length) line(contact.join(' | '), { center: true, size: 20 });
  gap();

  if (p.summary) {
    heading('Summary');
    line(p.summary);
  }

  if (p.workHistory.length) {
    heading(wd ? 'Work Experience' : 'Experience');
    for (const w of p.workHistory) {
      line(w.title, { bold: true, after: 0 });
      line(w.company, { after: 0 });
      if (w.location) line(w.location, { after: 0 });
      const dates = dateRange(w.startDate, w.endDate, w.current, layout);
      if (dates) line(dates, { italics: !wd });
      w.highlights.forEach(bullet);
      gap();
    }
  }

  if (p.education.length) {
    heading('Education');
    for (const e of p.education) {
      if (wd) {
        // One field per line, in the order Workday's Education section asks for them.
        line(e.institution, { bold: true, after: 0 });
        if (e.degree) line(e.degree, { after: 0 });
        if (e.field) line(e.field, { after: 0 });
        if (e.endYear) line(String(e.endYear), { after: 0 });
      } else {
        const what = [e.degree, e.field].filter(Boolean).join(', ');
        line(what || e.institution, { bold: true, after: 0 });
        const where = [what ? e.institution : null, e.endYear ? String(e.endYear) : null].filter(Boolean).join(' | ');
        if (where) line(where, { after: 0 });
      }
      gap();
    }
  }

  if (p.skills.length) {
    heading('Skills');
    line(p.skills.join(', '));
  }
  if (p.certifications.length) {
    heading('Certifications');
    for (const c of p.certifications) (wd ? line(c, { after: 0 }) : bullet(c));
  }
  if (p.languages.length) {
    heading('Languages');
    line(p.languages.join(', '));
  }
  if (p.links.length) {
    heading('Websites');
    for (const l of p.links) line(l, { after: 0 });
  }
  return out;
}

const run = (text: string, opts: { bold?: boolean; italics?: boolean; size?: number } = {}) =>
  new TextRun({ text, bold: opts.bold, italics: opts.italics, font: FONT, size: opts.size ?? 21 });

function toParagraph(b: ResumeBlock): Paragraph {
  switch (b.kind) {
    case 'name':
      return new Paragraph({
        heading: HeadingLevel.TITLE,
        alignment: b.center ? AlignmentType.CENTER : undefined,
        spacing: { after: 40 },
        children: [new TextRun({ text: b.text, bold: true, size: 36, font: FONT, color: '000000' })],
      });
    case 'line':
      return new Paragraph({ alignment: b.center ? AlignmentType.CENTER : undefined, spacing: { after: b.after ?? 40 }, children: [run(b.text, b)] });
    case 'heading':
      // A real Word "Heading 1", so parsers that read styles find the section.
      return new Paragraph({
        heading: HeadingLevel.HEADING_1,
        spacing: { before: 240, after: 80 },
        border: { bottom: { style: BorderStyle.SINGLE, size: 6, color: '999999', space: 2 } },
        children: [new TextRun({ text: b.text.toUpperCase(), bold: true, size: 24, font: FONT, color: '000000' })],
      });
    case 'bullet':
      return new Paragraph({ numbering: { reference: 'bullets', level: 0 }, spacing: { after: 40 }, children: [run(b.text)] });
    case 'gap':
      return new Paragraph({ spacing: { after: 80 }, children: [] });
  }
}

export function resumeParagraphs(p: CandidateProfile, layout: ResumeLayout = 'standard'): Paragraph[] {
  return resumeBlocks(p, layout).map(toParagraph);
}

export async function buildResumeDocx(p: CandidateProfile, layout: ResumeLayout = 'standard'): Promise<Buffer> {
  const doc = new Document({
    creator: p.fullName ?? 'Job Apply',
    title: p.fullName ? `${p.fullName} - Resume` : 'Resume',
    styles: { default: { document: { run: { font: FONT, size: 21 } } } },
    numbering: {
      config: [
        {
          reference: 'bullets',
          levels: [{ level: 0, format: LevelFormat.BULLET, text: '•', alignment: AlignmentType.LEFT, style: { paragraph: { indent: { left: 360, hanging: 260 } } } }],
        },
      ],
    },
    sections: [{ properties: { page: { margin: { top: 720, bottom: 720, left: 900, right: 900 } } }, children: resumeParagraphs(p, layout) }],
  });
  return Packer.toBuffer(doc);
}

export const RESUME_FORMATS = ['docx', 'pdf'] as const;
export type ResumeFormat = (typeof RESUME_FORMATS)[number];

/** The ?format= query value: docx unless it says pdf; null if it's something else. */
export function parseFormat(v: unknown): ResumeFormat | null {
  if (v === undefined || v === null || v === '') return 'docx';
  return RESUME_FORMATS.includes(v as ResumeFormat) ? (v as ResumeFormat) : null;
}

/** A safe download name, e.g. "Jane Doe - Acme resume.docx". */
export function resumeFileName(name: string | null, company: string | null, format: ResumeFormat = 'docx'): string {
  const part = (s: string | null) => (s ?? '').replace(/[^\p{L}\p{N} ._-]/gu, '').replace(/\s+/g, ' ').trim().slice(0, 60);
  const base = [part(name), part(company)].filter(Boolean).join(' - ') || 'Tailored';
  return `${base} resume.${format}`;
}

export interface ResumeCheck {
  /** Where to fix it on the Profile page, e.g. "Work history · Engineer, Globex". */
  where: string;
  message: string;
}

/**
 * What the profile is missing that Workday (and most ATS) ask for. These are
 * never guessed: a made-up date or location would end up on the application.
 */
export function resumeChecks(p: CandidateProfile): ResumeCheck[] {
  const out: ResumeCheck[] = [];
  const add = (where: string, message: string) => out.push({ where, message });
  if (!p.fullName) add('Personal details', 'Add your full name.');
  if (!p.email) add('Personal details', 'Add your email address.');
  if (!p.phone) add('Personal details', 'Add a phone number: Workday asks for one.');
  if (!p.location) add('Personal details', 'Add where you are based (city and region).');
  p.workHistory.forEach((w) => {
    const where = `Work history · ${w.title}, ${w.company}`;
    const dateCheck = (d: string | null, which: 'start' | 'end') => {
      const p = parseMonth(d);
      if (!p) add(where, `Write the ${which} date as month and year, e.g. 2021-03 (it says “${d}”).`);
      else if (p.month === null) add(where, `Add the ${which} month: Workday asks for month and year.`);
    };
    if (!w.startDate?.trim()) add(where, 'Add the start date (month and year).');
    else dateCheck(w.startDate, 'start');
    if (!w.current) {
      if (!w.endDate?.trim()) add(where, 'Add the end date (month and year), or mark it as your current role.');
      else dateCheck(w.endDate, 'end');
    }
    if (!w.location) add(where, 'Add the location (city and region).');
    if (!w.highlights.length) add(where, 'Add at least one bullet: it becomes the role description.');
  });
  p.education.forEach((e) => {
    const where = `Education · ${e.institution}`;
    if (!e.degree) add(where, 'Add the degree (e.g. BSc).');
    if (!e.field) add(where, 'Add the field of study.');
    if (!e.endYear) add(where, 'Add the year you finished (or expect to).');
  });
  return out;
}

const same = (a: string | null | undefined, b: string | null | undefined) => (a ?? '').trim().toLowerCase() === (b ?? '').trim().toLowerCase();

/**
 * Takes factual details (contact, dates, locations, education) from the
 * current profile into a tailored one, so fixing them on the Profile page
 * reaches a tailored resume without asking for new suggestions. Roles and
 * education entries are matched by title+company / school; the reworded text
 * (summary, headline, skills, bullets) stays as tailored.
 */
export function refreshFacts(tailored: CandidateProfile, current: CandidateProfile | null): CandidateProfile {
  if (!current) return tailored;
  const out: CandidateProfile = structuredClone(tailored);
  out.fullName = current.fullName ?? out.fullName;
  out.email = current.email ?? out.email;
  out.phone = current.phone ?? out.phone;
  out.location = current.location ?? out.location;
  if (current.links.length) out.links = [...current.links];
  out.workHistory = out.workHistory.map((w) => {
    const now = current.workHistory.find((c) => same(c.title, w.title) && same(c.company, w.company));
    return now ? { ...w, startDate: now.startDate, endDate: now.endDate, current: now.current, location: now.location } : w;
  });
  out.education = out.education.map((e) => {
    const now = current.education.find((c) => same(c.institution, e.institution));
    return now ? { ...e, degree: now.degree, field: now.field, endYear: now.endYear } : e;
  });
  return out;
}
