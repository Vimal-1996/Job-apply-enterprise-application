import { CandidateProfile } from '../profile/profile.schema';
import { parseFormat, resumeBlocks, resumeFileName, ResumeLayout } from './resume-docx';
import { buildResumePdf, pdfSafe } from './resume-pdf';

const PROFILE: CandidateProfile = {
  fullName: 'Jane Doe',
  headline: 'Backend Engineer',
  email: 'jane@example.com',
  phone: '+1 416 555 0100',
  location: 'Toronto, ON',
  links: ['https://github.com/jane'],
  summary: 'Engineer who builds “APIs”.',
  yearsExperience: 6,
  skills: ['TypeScript', 'PostgreSQL'],
  workHistory: [
    {
      title: 'Backend Engineer',
      company: 'Globex',
      location: 'Toronto, ON',
      startDate: '2021-03',
      endDate: null,
      current: true,
      highlights: ['Built the billing API', 'Ran AWS SQS queues'],
    },
  ],
  education: [{ institution: 'University of Toronto', degree: 'BSc', field: 'Computer Science', endYear: 2018 }],
  certifications: [],
  languages: [],
  workAuthorization: null,
};

// The built-in fonts use WinAnsi, which puts these characters in 0x80–0x9F.
const WIN_ANSI: Record<string, string> = { '\x80': '€', '\x85': '…', '\x95': '•', '\x96': '–', '\x97': '—' };

/** The PDF's text lines, in drawing order (pdfkit writes each line as one TJ of hex strings). */
async function pdfLines(p: CandidateProfile, layout: ResumeLayout): Promise<string[]> {
  const raw = (await buildResumePdf(p, layout, { compress: false })).toString('latin1');
  return [...raw.matchAll(/\[(.*?)\] TJ/g)].map((m) =>
    [...m[1].matchAll(/<([0-9a-f]*)>/g)].map((h) => Buffer.from(h[1], 'hex').toString('latin1')).join('').replace(/[\x80-\x9f]/g, (c) => WIN_ANSI[c] ?? c),
  );
}

describe('resume PDF', () => {
  it('is a PDF with the same text, in the same order, as the Word layout', async () => {
    for (const layout of ['standard', 'workday'] as const) {
      const lines = await pdfLines(PROFILE, layout);
      const expected = resumeBlocks(PROFILE, layout)
        .filter((b) => b.kind !== 'gap')
        .map((b) => pdfSafe(b.kind === 'heading' ? b.text.toUpperCase() : (b as { text: string }).text));
      // Long lines wrap into several TJs; joined with spaces they read the same.
      const text = lines.filter((l) => l !== '•').join(' ');
      let at = 0;
      for (const e of expected) {
        const i = text.indexOf(e, at);
        expect({ e, found: i >= 0 }).toEqual({ e, found: true });
        at = i + e.length;
      }
    }
  });

  it('puts the Workday dates and headings in the PDF too', async () => {
    const lines = await pdfLines(PROFILE, 'workday');
    expect(lines).toContain('WORK EXPERIENCE');
    expect(lines).toContain('03/2021 - Present');
    expect(lines.filter((l) => l === '•')).toHaveLength(2);
  });

  it('starts with a PDF header and keeps the name in the document info', async () => {
    const pdf = await buildResumePdf(PROFILE, 'standard');
    expect(pdf.subarray(0, 5).toString()).toBe('%PDF-');
    expect(pdf.toString('latin1')).toContain('(Jane Doe - Resume)');
  });

  it("swaps typographic characters the built-in font can't draw and drops the rest", () => {
    expect(pdfSafe('“APIs” – it’s ‑ fine… €5 • Zoë')).toBe('"APIs" – it\'s - fine… €5 • Zoë');
    expect(pdfSafe('Lead 🚀 工程师')).toBe('Lead  ');
  });

  it('reads the format query and names the file to match', () => {
    expect(parseFormat(undefined)).toBe('docx');
    expect(parseFormat('pdf')).toBe('pdf');
    expect(parseFormat('rtf')).toBeNull();
    expect(resumeFileName('Jane Doe', 'Acme', 'pdf')).toBe('Jane Doe - Acme resume.pdf');
  });
});
