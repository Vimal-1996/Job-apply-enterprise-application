import { CandidateProfile } from '../profile/profile.schema';
import { keywordCoverage, mentions, resumeText, skillVariants } from './keyword-coverage';

const base: CandidateProfile = {
  fullName: 'Jane Doe',
  headline: 'Backend Engineer',
  email: null,
  phone: null,
  location: null,
  links: [],
  summary: 'Builds Node.js services.',
  yearsExperience: 6,
  skills: ['TypeScript', 'C++'],
  workHistory: [{ title: 'Engineer', company: 'Globex', location: null, startDate: null, endDate: null, current: true, highlights: ['Ran CI/CD pipelines on AWS.', 'Built REST APIs'] }],
  education: [],
  certifications: [],
  languages: [],
  workAuthorization: null,
};

describe('keyword coverage', () => {
  const text = resumeText(base);

  it('matches whole words, tech symbols and plurals', () => {
    expect(mentions(text, 'TypeScript')).toBe(true);
    expect(mentions(text, 'typescript')).toBe(true);
    expect(mentions(text, 'C++')).toBe(true);
    expect(mentions(text, 'C')).toBe(false);
    expect(mentions(text, 'Node.js')).toBe(true);
    expect(mentions(text, 'CI/CD')).toBe(true);
    expect(mentions(text, 'REST API')).toBe(true); // "REST APIs"
    expect(mentions(text, 'Java')).toBe(false); // not inside "JavaScript"-like words
    expect(mentions(text, 'Amazon Web Services (AWS)')).toBe(true);
    expect(mentions(text, 'Go')).toBe(false);
  });

  it('lists the ways a skill can be written', () => {
    expect(skillVariants('Amazon Web Services (AWS)')).toEqual(expect.arrayContaining(['amazon web services', 'aws']));
    expect(skillVariants('APIs')).toEqual(['apis', 'api']);
  });

  it('compares the original and tailored resumes', () => {
    const tailored = { ...base, skills: [...base.skills, 'PostgreSQL'], summary: 'Builds Node.js services on Kubernetes.' };
    const c = keywordCoverage(['TypeScript', 'PostgreSQL', 'Kubernetes', 'Go', 'typescript '], base, tailored);
    expect(c).toEqual({ total: 4, original: 1, tailored: 3, added: ['PostgreSQL', 'Kubernetes'], missing: ['Go'] });
  });
});
