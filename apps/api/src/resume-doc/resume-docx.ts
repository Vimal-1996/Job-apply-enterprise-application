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

const run = (text: string, opts: { bold?: boolean; italics?: boolean; size?: number } = {}) =>
  new TextRun({ text, bold: opts.bold, italics: opts.italics, font: FONT, size: opts.size ?? 21 });

const line = (text: string, opts: { bold?: boolean; italics?: boolean; after?: number; center?: boolean; size?: number } = {}) =>
  new Paragraph({
    alignment: opts.center ? AlignmentType.CENTER : undefined,
    spacing: { after: opts.after ?? 40 },
    children: [run(text, opts)],
  });

const bullet = (text: string) => new Paragraph({ numbering: { reference: 'bullets', level: 0 }, spacing: { after: 40 }, children: [run(text)] });

/** A real Word "Heading 1", so parsers that read styles find the section. */
const heading = (text: string) =>
  new Paragraph({
    heading: HeadingLevel.HEADING_1,
    spacing: { before: 240, after: 80 },
    border: { bottom: { style: BorderStyle.SINGLE, size: 6, color: '999999', space: 2 } },
    children: [new TextRun({ text: text.toUpperCase(), bold: true, size: 24, font: FONT, color: '000000' })],
  });

const gap = () => new Paragraph({ spacing: { after: 80 }, children: [] });

export function resumeParagraphs(p: CandidateProfile, layout: ResumeLayout = 'standard'): Paragraph[] {
  const wd = layout === 'workday';
  const out: Paragraph[] = [];

  if (p.fullName) {
    out.push(
      new Paragraph({
        heading: HeadingLevel.TITLE,
        alignment: wd ? undefined : AlignmentType.CENTER,
        spacing: { after: 40 },
        children: [new TextRun({ text: p.fullName, bold: true, size: 36, font: FONT, color: '000000' })],
      }),
    );
  }
  if (p.headline) out.push(line(p.headline, { center: !wd, size: 24 }));
  const contact = [p.email, p.phone, p.location].filter((x): x is string => Boolean(x));
  if (wd) contact.forEach((c) => out.push(line(c, { after: 0 })));
  else if (contact.length) out.push(line(contact.join(' | '), { center: true, size: 20 }));
  out.push(gap());

  if (p.summary) out.push(heading('Summary'), line(p.summary));

  if (p.workHistory.length) {
    out.push(heading(wd ? 'Work Experience' : 'Experience'));
    for (const w of p.workHistory) {
      out.push(line(w.title, { bold: true, after: 0 }));
      out.push(line(w.company, { after: 0 }));
      if (w.location) out.push(line(w.location, { after: 0 }));
      const dates = dateRange(w.startDate, w.endDate, w.current, layout);
      if (dates) out.push(line(dates, { italics: !wd }));
      for (const h of w.highlights) out.push(bullet(h));
      out.push(gap());
    }
  }

  if (p.education.length) {
    out.push(heading('Education'));
    for (const e of p.education) {
      if (wd) {
        // One field per line, in the order Workday's Education section asks for them.
        out.push(line(e.institution, { bold: true, after: 0 }));
        if (e.degree) out.push(line(e.degree, { after: 0 }));
        if (e.field) out.push(line(e.field, { after: 0 }));
        if (e.endYear) out.push(line(String(e.endYear), { after: 0 }));
      } else {
        const what = [e.degree, e.field].filter(Boolean).join(', ');
        out.push(line(what || e.institution, { bold: true, after: 0 }));
        const where = [what ? e.institution : null, e.endYear ? String(e.endYear) : null].filter(Boolean).join(' | ');
        if (where) out.push(line(where, { after: 0 }));
      }
      out.push(gap());
    }
  }

  if (p.skills.length) out.push(heading('Skills'), line(p.skills.join(', ')));
  if (p.certifications.length) {
    out.push(heading('Certifications'));
    for (const c of p.certifications) out.push(wd ? line(c, { after: 0 }) : bullet(c));
  }
  if (p.languages.length) out.push(heading('Languages'), line(p.languages.join(', ')));
  if (p.links.length) {
    out.push(heading('Websites'));
    for (const l of p.links) out.push(line(l, { after: 0 }));
  }
  return out;
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

/** A safe download name, e.g. "Jane Doe - Acme resume.docx". */
export function resumeFileName(name: string | null, company: string | null): string {
  const part = (s: string | null) => (s ?? '').replace(/[^\p{L}\p{N} ._-]/gu, '').replace(/\s+/g, ' ').trim().slice(0, 60);
  const base = [part(name), part(company)].filter(Boolean).join(' - ') || 'Tailored';
  return `${base} resume.docx`;
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
