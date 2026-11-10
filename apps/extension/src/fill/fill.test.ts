// @vitest-environment jsdom
import { describe, expect, it } from 'vitest';
import type { CandidateProfile, JobSummary } from '../api';
import { buildFillData, classify, fillForm, labelOf, splitName, type ResumeFile } from './fields';
import { findSavedJob, normalizeJobUrl } from './match';
import { jobFromPage, postingUrl } from './sites';

const PROFILE: CandidateProfile = {
  fullName: 'Jane van der Berg',
  headline: 'Senior Backend Engineer',
  email: 'jane@example.com',
  phone: '+1 416 555 0100',
  location: 'Toronto, ON',
  links: ['https://www.linkedin.com/in/jane', 'https://github.com/jane', 'https://jane.dev'],
  workHistory: [
    { title: 'Senior Software Engineer', company: 'Globex', current: true },
    { title: 'Engineer', company: 'Initech', current: false },
  ],
};
const DATA = buildFillData(PROFILE, { needsSponsorship: false }, 'account@example.com');
const RESUME: ResumeFile = { name: 'Jane CV.pdf', type: 'application/pdf', base64: btoa('%PDF-1.7') };

function page(html: string): Document {
  document.body.innerHTML = html;
  return document;
}

// Shaped like Greenhouse's job board (job-boards.greenhouse.io), trimmed.
const GREENHOUSE = `
  <div class="job__title"><h1>Senior Backend Engineer</h1></div>
  <div class="job__description"><p>Acme builds payments infrastructure. You will design TypeScript services and own our PostgreSQL schema.</p></div>
  <form id="application-form">
    <div class="field"><label for="first_name">First Name<span>*</span></label><input id="first_name" type="text"></div>
    <div class="field"><label for="last_name">Last Name<span>*</span></label><input id="last_name" type="text"></div>
    <div class="field"><label for="email">Email<span>*</span></label><input id="email" type="text"></div>
    <div class="field"><label for="phone">Phone</label><input id="phone" type="tel"></div>
    <div class="field"><label for="resume">Resume/CV<span>*</span></label><input id="resume" type="file"></div>
    <div class="field"><label for="cover_letter">Cover Letter</label><input id="cover_letter" type="file"></div>
    <div class="field"><label for="question_1">LinkedIn Profile</label><input id="question_1" type="text"></div>
    <div class="field"><label for="question_2">Website</label><input id="question_2" type="text" value="https://already.typed"></div>
    <div class="field"><label for="question_3">Will you now or in the future require sponsorship for employment visa status?</label>
      <select id="question_3"><option value="">Select...</option><option value="1">Yes</option><option value="0">No</option></select></div>
    <div class="field"><label for="question_4">Why do you want to work at Acme?</label><textarea id="question_4"></textarea></div>
    <fieldset><legend>Gender</legend>
      <label><input type="radio" name="gender" value="f"> Female</label><label><input type="radio" name="gender" value="m"> Male</label></fieldset>
    <input type="hidden" name="token" value="x">
    <button type="submit">Submit application</button>
  </form>`;

// Shaped like Lever's application page (jobs.lever.co/<company>/<id>/apply), trimmed.
const LEVER = `
  <div class="posting-headline"><h2>Platform Engineer</h2></div>
  <div class="main-header-logo"><img alt="Initrode"></div>
  <form action="/initrode/abc/apply" method="POST">
    <ul>
      <li class="application-question"><div class="application-label">Resume/CV</div><input type="file" name="resume" id="resume-upload-input"></li>
      <li class="application-question"><div class="application-label">Full name</div><input type="text" name="name"></li>
      <li class="application-question"><div class="application-label">Email</div><input type="email" name="email"></li>
      <li class="application-question"><div class="application-label">Phone</div><input type="text" name="phone"></li>
      <li class="application-question"><div class="application-label">Current company</div><input type="text" name="org"></li>
      <li class="application-question"><div class="application-label">LinkedIn URL</div><input type="text" name="urls[LinkedIn]"></li>
      <li class="application-question"><div class="application-label">GitHub URL</div><input type="text" name="urls[GitHub]"></li>
      <li class="application-question"><div class="application-label">Portfolio URL</div><input type="text" name="urls[Portfolio]"></li>
      <li class="application-question"><div class="application-label">Do you require visa sponsorship?</div>
        <label><input type="radio" name="cards[q1]" value="Yes"> Yes</label><label><input type="radio" name="cards[q1]" value="No"> No</label></li>
    </ul>
  </form>`;

describe('profile → form values', () => {
  it('splits names and picks links and the current job', () => {
    expect(splitName('Jane van der Berg')).toEqual({ first: 'Jane', last: 'van der Berg' });
    expect(splitName('Cher')).toEqual({ first: 'Cher', last: null });
    expect(DATA).toMatchObject({
      firstName: 'Jane',
      lastName: 'van der Berg',
      linkedin: 'https://www.linkedin.com/in/jane',
      github: 'https://github.com/jane',
      website: 'https://jane.dev',
      currentCompany: 'Globex',
      needsSponsorship: false,
    });
  });

  it("falls back to the account email when the profile hasn't one", () => {
    expect(buildFillData({ ...PROFILE, email: null }, null, 'account@example.com').email).toBe('account@example.com');
  });
});

describe('classify', () => {
  const input = (attrs = '') => page(`<input ${attrs}>`).querySelector('input')!;
  it('never treats demographic questions as fillable', () => {
    for (const l of ['Gender', 'Race / Ethnicity', 'Veteran status', 'Disability status', 'Pronouns']) {
      expect(classify(l, input())).toEqual({ sensitive: true });
    }
  });
  it('tells a resume upload from a cover letter', () => {
    expect(classify('Resume/CV', input('type="file"'))).toEqual({ resume: true });
    expect(classify('Cover Letter', input('type="file"'))).toBeNull();
  });
});

describe('Greenhouse form', () => {
  it('fills what the profile supports, keeps typed values, and leaves the rest highlighted', () => {
    const doc = page(GREENHOUSE);
    const attached: string[] = [];
    const report = fillForm(doc, DATA, RESUME, (el, f) => (attached.push(`${el.id}:${f.name}`), true));
    const v = (id: string) => (doc.getElementById(id) as HTMLInputElement).value;

    expect(v('first_name')).toBe('Jane');
    expect(v('last_name')).toBe('van der Berg');
    expect(v('email')).toBe('jane@example.com');
    expect(v('phone')).toBe('+1 416 555 0100');
    expect(v('question_1')).toBe('https://www.linkedin.com/in/jane');
    expect(v('question_2')).toBe('https://already.typed');
    expect((doc.getElementById('question_3') as HTMLSelectElement).selectedOptions[0].textContent).toBe('No');
    expect(v('question_4')).toBe('');
    expect(attached).toEqual(['resume:Jane CV.pdf']);
    expect((doc.querySelectorAll('input[name="gender"]:checked') as NodeListOf<HTMLInputElement>).length).toBe(0);

    const byLabel = Object.fromEntries(report.map((r) => [r.label, r.outcome]));
    expect(byLabel).toMatchObject({
      'First Name': 'filled',
      'Resume/CV': 'filled',
      'Cover Letter': 'left',
      Website: 'already',
      'Why do you want to work at Acme?': 'left',
      Gender: 'sensitive',
    });
    expect(report.some((r) => /submit/i.test(r.label))).toBe(false);
    expect(doc.getElementById('first_name')!.getAttribute('data-job-apply')).toBe('filled');
    expect(doc.getElementById('question_4')!.getAttribute('data-job-apply')).toBe('left');
  });

  it('fires input events so React forms see the values', () => {
    const doc = page(GREENHOUSE);
    const seen: string[] = [];
    doc.getElementById('email')!.addEventListener('input', (e) => seen.push((e.target as HTMLInputElement).value));
    fillForm(doc, DATA, null, () => false);
    expect(seen).toEqual(['jane@example.com']);
  });

  it('leaves sponsorship unanswered when the preference is unknown', () => {
    const doc = page(GREENHOUSE);
    const report = fillForm(doc, { ...DATA, needsSponsorship: null }, null, () => false);
    expect((doc.getElementById('question_3') as HTMLSelectElement).value).toBe('');
    expect(report.find((r) => /sponsorship/.test(r.label))!.outcome).toBe('left');
  });

  it('reads the job from the page', () => {
    const job = jobFromPage(page(GREENHOUSE), 'https://job-boards.greenhouse.io/acme/jobs/4012345?gh_src=abc');
    expect(job).toMatchObject({ site: 'greenhouse', url: 'https://job-boards.greenhouse.io/acme/jobs/4012345', title: 'Senior Backend Engineer', company: 'Acme' });
    expect(job!.description).toContain('payments infrastructure');
  });
});

describe('Lever form', () => {
  it('fills full name, links, current company and the sponsorship radio', () => {
    const doc = page(LEVER);
    const report = fillForm(doc, DATA, RESUME, () => true);
    const v = (name: string) => (doc.querySelector(`[name="${name}"]`) as HTMLInputElement).value;
    expect(v('name')).toBe('Jane van der Berg');
    expect(v('org')).toBe('Globex');
    expect(v('urls[LinkedIn]')).toBe('https://www.linkedin.com/in/jane');
    expect(v('urls[GitHub]')).toBe('https://github.com/jane');
    expect(v('urls[Portfolio]')).toBe('https://jane.dev');
    expect((doc.querySelector('input[name="cards[q1]"]:checked') as HTMLInputElement).value).toBe('No');
    expect(report.filter((r) => r.outcome === 'left')).toEqual([]);
    expect(labelOf(doc.querySelector('[name="org"]')!)).toBe('Current company');
  });

  it('reads the job and points an /apply page back to its posting', () => {
    const job = jobFromPage(page(LEVER), 'https://jobs.lever.co/initrode/0f7e-4b2a/apply');
    expect(job).toMatchObject({ site: 'lever', url: 'https://jobs.lever.co/initrode/0f7e-4b2a', title: 'Platform Engineer', company: 'Initrode' });
  });
});

describe('posting addresses', () => {
  it('handles Greenhouse embeds and rejects other pages', () => {
    expect(postingUrl(new URL('https://boards.greenhouse.io/embed/job_app?for=acme&token=123'))?.url).toBe('https://job-boards.greenhouse.io/acme/jobs/123');
    expect(postingUrl(new URL('https://boards.greenhouse.io/acme'))).toBeNull();
    expect(postingUrl(new URL('https://www.linkedin.com/jobs/view/1'))).toBeNull();
  });
});

describe('findSavedJob', () => {
  const job = (over: Partial<JobSummary>): JobSummary => ({
    id: 'x',
    url: null,
    applyUrl: null,
    title: null,
    company: null,
    matchStatus: 'ready',
    score: 80,
    verdict: 'good',
    applicationStatus: 'saved',
    ...over,
  });
  const here = { site: 'greenhouse' as const, url: 'https://job-boards.greenhouse.io/acme/jobs/123', title: 'Senior Backend Engineer', company: 'Acme', description: '' };

  it('matches by address first, across Greenhouse hosts and /apply', () => {
    expect(normalizeJobUrl('https://boards.greenhouse.io/acme/jobs/123/?x=1')).toBe(normalizeJobUrl('https://job-boards.greenhouse.io/acme/jobs/123'));
    expect(normalizeJobUrl('https://jobs.lever.co/a/b/apply')).toBe('jobs.lever.co/a/b');
    const jobs = [job({ id: 'title', company: 'Acme', title: 'Senior Backend Engineer' }), job({ id: 'url', applyUrl: 'https://boards.greenhouse.io/acme/jobs/123' })];
    expect(findSavedJob(here, jobs)?.id).toBe('url');
  });

  it('falls back to the same company and a very similar title, else nothing', () => {
    expect(findSavedJob(here, [job({ id: 'a', company: 'acme', title: 'Senior Backend Engineer (Remote)' })])?.id).toBe('a');
    expect(findSavedJob(here, [job({ id: 'b', company: 'Acme', title: 'Product Designer' })])).toBeNull();
    expect(findSavedJob(here, [job({ id: 'c', company: 'Globex', title: 'Senior Backend Engineer' })])).toBeNull();
  });
});
