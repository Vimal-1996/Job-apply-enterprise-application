import { JobLinkError, parseJobLink } from './job-link';

describe('parseJobLink', () => {
  it('reads LinkedIn job links in their common shapes, and a bare job ID', () => {
    const want = { source: 'linkedin', externalId: '4012345678', url: 'https://www.linkedin.com/jobs/view/4012345678/' };
    for (const input of [
      '4012345678',
      'https://www.linkedin.com/jobs/view/4012345678/',
      'https://www.linkedin.com/jobs/view/4012345678?refId=abc&trk=x',
      'linkedin.com/jobs/view/senior-backend-engineer-at-acme-4012345678',
      'https://ca.linkedin.com/jobs/view/4012345678',
      'https://www.linkedin.com/jobs/search/?currentJobId=4012345678&keywords=engineer',
      ' https://www.linkedin.com/jobs/collections/recommended/?currentJobId=4012345678 ',
    ]) {
      expect(parseJobLink(input)).toEqual(want);
    }
  });

  it('reads Indeed job links on any country site', () => {
    expect(parseJobLink('https://www.indeed.com/viewjob?jk=0123456789ABCDEF&from=serp')).toEqual({
      source: 'indeed',
      externalId: '0123456789abcdef',
      url: 'https://www.indeed.com/viewjob?jk=0123456789abcdef',
    });
    expect(parseJobLink('https://uk.indeed.com/jobs?q=dev&vjk=0123456789abcdef').url).toBe('https://uk.indeed.com/viewjob?jk=0123456789abcdef');
    expect(parseJobLink('https://in.indeed.co.in/viewjob?jk=0123456789abcdef').source).toBe('indeed');
  });

  it('keeps other sites as plain links, without the #fragment', () => {
    expect(parseJobLink('https://boards.greenhouse.io/acme/jobs/123#app')).toEqual({
      source: 'other',
      externalId: null,
      url: 'https://boards.greenhouse.io/acme/jobs/123',
    });
  });

  it('is not fooled by look-alike hosts', () => {
    expect(parseJobLink('https://linkedin.com.evil.example/jobs/view/4012345678').source).toBe('other');
    expect(parseJobLink('https://notindeed.com/viewjob?jk=0123456789abcdef').source).toBe('other');
  });

  it('explains what is wrong', () => {
    expect(() => parseJobLink('https://www.linkedin.com/feed/')).toThrow(/doesn't point to a job/);
    expect(() => parseJobLink('https://www.indeed.com/viewjob?jk=nope')).toThrow(/doesn't point to a job/);
    expect(() => parseJobLink('javascript:alert(1)')).toThrow(JobLinkError);
    expect(() => parseJobLink('ftp://example.com/job')).toThrow(/web links/);
    expect(() => parseJobLink('https://user:pw@example.com/job')).toThrow(JobLinkError);
    expect(() => parseJobLink('not a link at all')).toThrow(JobLinkError);
    expect(() => parseJobLink(`https://example.com/${'a'.repeat(2001)}`)).toThrow(/too long/);
  });
});
