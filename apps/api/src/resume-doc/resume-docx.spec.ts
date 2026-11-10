import JSZip from 'jszip';
import { CandidateProfile } from '../profile/profile.schema';
import { buildResumeDocx, dateRange, formatMonth, parseLayout, parseMonth, refreshFacts, resumeChecks, resumeFileName, ResumeLayout } from './resume-docx';

const PROFILE: CandidateProfile = {
  fullName: 'Jane Doe',
  headline: 'Backend Engineer',
  email: 'jane@example.com',
  phone: '+1 416 555 0100',
  location: 'Toronto, ON',
  links: ['https://www.linkedin.com/in/jane', 'https://github.com/jane'],
  summary: 'Engineer who builds APIs.',
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
    { title: 'Developer', company: 'Initech', location: null, startDate: '2018', endDate: '2021-02', current: false, highlights: [] },
  ],
  education: [{ institution: 'University of Toronto', degree: 'BSc', field: 'Computer Science', endYear: 2018 }],
  certifications: ['AWS Certified Developer'],
  languages: ['English'],
  workAuthorization: null,
};

/** The document's paragraphs as plain text, in order, with their Word style. */
async function paragraphs(p: CandidateProfile, layout: ResumeLayout) {
  const xml = await (await JSZip.loadAsync(await buildResumeDocx(p, layout))).file('word/document.xml')!.async('string');
  return [...xml.matchAll(/<w:p[ >][\s\S]*?<\/w:p>/g)].map((m) => ({
    text: [...m[0].matchAll(/<w:t[^>]*>([^<]*)<\/w:t>/g)].map((t) => t[1]).join(''),
    style: /<w:pStyle w:val="([^"]+)"/.exec(m[0])?.[1] ?? null,
    bullet: m[0].includes('<w:numPr>'),
    xml: m[0],
  }));
}
const texts = async (p: CandidateProfile, layout: ResumeLayout) => (await paragraphs(p, layout)).map((x) => x.text).filter(Boolean);

describe('Word resume layouts', () => {
  it('standard: real headings, title / company / location / dates on separate lines, links under Websites', async () => {
    const t = await texts(PROFILE, 'standard');
    const at = (s: string) => t.indexOf(s);
    expect(t.slice(0, 3)).toEqual(['Jane Doe', 'Backend Engineer', 'jane@example.com | +1 416 555 0100 | Toronto, ON']);
    expect(t.slice(at('EXPERIENCE'), at('EXPERIENCE') + 5)).toEqual(['EXPERIENCE', 'Backend Engineer', 'Globex', 'Toronto, ON', 'Mar 2021 – Present']);
    expect(t).toContain('2018 – Feb 2021');
    expect(t.slice(at('EDUCATION'), at('EDUCATION') + 3)).toEqual(['EDUCATION', 'BSc, Computer Science', 'University of Toronto | 2018']);
    expect(t.slice(at('WEBSITES'))).toEqual(['WEBSITES', 'https://www.linkedin.com/in/jane', 'https://github.com/jane']);
    const ps = await paragraphs(PROFILE, 'standard');
    expect(ps.filter((p) => p.style === 'Heading1').map((p) => p.text)).toEqual([
      'SUMMARY',
      'EXPERIENCE',
      'EDUCATION',
      'SKILLS',
      'CERTIFICATIONS',
      'LANGUAGES',
      'WEBSITES',
    ]);
    expect(ps.filter((p) => p.bullet).map((p) => p.text)).toEqual(['Built the billing API', 'Ran AWS SQS queues', 'AWS Certified Developer']);
  });

  it('workday: "Work Experience", MM/YYYY dates with a plain hyphen, one fact per line', async () => {
    const t = await texts(PROFILE, 'workday');
    const at = (s: string) => t.indexOf(s);
    expect(t.slice(0, 5)).toEqual(['Jane Doe', 'Backend Engineer', 'jane@example.com', '+1 416 555 0100', 'Toronto, ON']);
    expect(t.slice(at('WORK EXPERIENCE'), at('WORK EXPERIENCE') + 5)).toEqual(['WORK EXPERIENCE', 'Backend Engineer', 'Globex', 'Toronto, ON', '03/2021 - Present']);
    expect(t).toContain('2018 - 02/2021');
    expect(t.slice(at('EDUCATION'), at('EDUCATION') + 5)).toEqual(['EDUCATION', 'University of Toronto', 'BSc', 'Computer Science', '2018']);
    expect(t).not.toContain('EXPERIENCE');
    expect(t.join('\n')).not.toContain('|');
  });

  it('has no tables, text boxes, images, headers or footers in either layout', async () => {
    for (const layout of ['standard', 'workday'] as const) {
      const zip = await JSZip.loadAsync(await buildResumeDocx(PROFILE, layout));
      const xml = await zip.file('word/document.xml')!.async('string');
      for (const tag of ['<w:tbl>', '<w:txbxContent>', '<w:drawing>', '<w:headerReference', '<w:footerReference']) expect(xml).not.toContain(tag);
      expect(Object.keys(zip.files).some((f) => /header|footer|media\//.test(f))).toBe(false);
    }
  });

  it('formats dates, ranges, layouts and file names', () => {
    expect(formatMonth('2021-03')).toBe('Mar 2021');
    expect(formatMonth('2021-03', 'workday')).toBe('03/2021');
    expect(formatMonth('2018', 'workday')).toBe('2018');
    for (const typed of ['2021-03', '2021-3', '03/2021', '3/2021', 'Mar 2021', 'March 2021', 'mar. 2021']) {
      expect(formatMonth(typed, 'workday')).toBe('03/2021');
    }
    expect(parseMonth('13/2021')).toBeNull();
    expect(parseMonth('Marchish 2021')).toBeNull();
    expect(formatMonth('Spring 2021', 'workday')).toBe('Spring 2021');
    expect(dateRange(null, null, false, 'workday')).toBeNull();
    expect(dateRange(null, null, true, 'workday')).toBe('Present');
    expect(parseLayout(undefined)).toBe('standard');
    expect(parseLayout('workday')).toBe('workday');
    expect(parseLayout('fancy')).toBeNull();
    expect(resumeFileName('Jane Doe', 'Acme / Corp')).toBe('Jane Doe - Acme Corp resume.docx');
    expect(resumeFileName('Jane Doe', null)).toBe('Jane Doe resume.docx');
  });
});

describe('resumeChecks', () => {
  it('lists what Workday will ask for that the profile lacks', () => {
    expect(resumeChecks(PROFILE)).toEqual([
      { where: 'Work history · Developer, Initech', message: 'Add the start month: Workday asks for month and year.' },
      { where: 'Work history · Developer, Initech', message: 'Add the location (city and region).' },
      { where: 'Work history · Developer, Initech', message: 'Add at least one bullet: it becomes the role description.' },
    ]);
  });

  it('accepts typed month forms, and asks for a readable date when it can\'t read one', () => {
    const p: CandidateProfile = { ...PROFILE, workHistory: [{ ...PROFILE.workHistory[0], startDate: 'Mar 2021' }, { ...PROFILE.workHistory[1], startDate: 'Spring 2018', location: 'Waterloo', highlights: ['x'] }] };
    expect(resumeChecks(p)).toEqual([{ where: 'Work history · Developer, Initech', message: 'Write the start date as month and year, e.g. 2021-03 (it says “Spring 2018”).' }]);
  });

  it('flags missing contact details, end dates and education parts', () => {
    const p: CandidateProfile = {
      ...PROFILE,
      phone: null,
      workHistory: [{ ...PROFILE.workHistory[0], current: false, endDate: null }],
      education: [{ institution: 'Waterloo', degree: null, field: null, endYear: null }],
    };
    expect(resumeChecks(p).map((c) => c.message)).toEqual([
      'Add a phone number: Workday asks for one.',
      'Add the end date (month and year), or mark it as your current role.',
      'Add the degree (e.g. BSc).',
      'Add the field of study.',
      'Add the year you finished (or expect to).',
    ]);
  });
});

describe('refreshFacts', () => {
  it('takes fixed dates, locations and contact details from the current profile, keeping the tailored wording', () => {
    const tailored: CandidateProfile = {
      ...structuredClone(PROFILE),
      summary: 'Tailored summary',
      workHistory: [{ ...PROFILE.workHistory[0], highlights: ['Tailored bullet'] }, PROFILE.workHistory[1]],
    };
    const current: CandidateProfile = {
      ...structuredClone(PROFILE),
      phone: '+1 647 555 0199',
      summary: 'Original summary',
      workHistory: [
        { ...PROFILE.workHistory[0], highlights: ['Original bullet'] },
        { ...PROFILE.workHistory[1], startDate: '2018-06', location: 'Waterloo, ON', company: 'initech ' },
      ],
    };
    const out = refreshFacts(tailored, current);
    expect(out.phone).toBe('+1 647 555 0199');
    expect(out.summary).toBe('Tailored summary');
    expect(out.workHistory[0].highlights).toEqual(['Tailored bullet']);
    expect(out.workHistory[1]).toMatchObject({ company: 'Initech', startDate: '2018-06', location: 'Waterloo, ON' });
    expect(refreshFacts(tailored, null)).toBe(tailored);
  });

  it('leaves a role alone when it no longer exists in the profile', () => {
    const current = { ...structuredClone(PROFILE), workHistory: [] };
    expect(refreshFacts(PROFILE, current).workHistory).toEqual(PROFILE.workHistory);
  });
});
