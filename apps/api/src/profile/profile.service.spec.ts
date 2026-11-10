import JSZip from 'jszip';
import { migrate } from '../db/migrate';
import { closeTestPools, testPool } from '../db/test-pool';
import { PgUserStore } from '../db/user-store';
import { ResumeFiles } from '../resumes/resume-files';
import { ResumeStore } from '../resumes/resume-store';
import { ResumesService } from '../resumes/resumes.service';
import { ExtractionError, ProfileExtractor, resumeContent, ResumeFile } from './profile-extractor';
import { ProfileStore } from './profile-store';
import { CandidateProfile, CandidateProfileSchema, EMPTY_PREFERENCES, PROFILE_LIMITS } from './profile.schema';
import { PARSE_TIMEOUT_MS, ProfileService } from './profile.service';

afterAll(closeTestPools);

const PDF = 'application/pdf';
const DOCX = 'application/vnd.openxmlformats-officedocument.wordprocessingml.document';
const pdfBytes = Buffer.from('%PDF-1.7\n...');

export const SAMPLE_PROFILE: CandidateProfile = {
  fullName: 'Jane Doe',
  headline: 'Backend Engineer',
  email: 'jane@example.com',
  phone: null,
  location: 'Toronto, ON',
  links: ['https://github.com/jane'],
  summary: null,
  yearsExperience: 6,
  skills: ['TypeScript', 'PostgreSQL'],
  workHistory: [
    { title: 'Backend Engineer', company: 'Acme', location: null, startDate: '2021-03', endDate: null, current: true, highlights: ['Built the billing API'] },
  ],
  education: [{ institution: 'University of Toronto', degree: 'BSc', field: 'Computer Science', endYear: 2018 }],
  certifications: [],
  languages: ['English'],
  workAuthorization: null,
};

/** A minimal real .docx: the parts Word (and mammoth) need. */
async function docx(paragraphs: string[]): Promise<Buffer> {
  const zip = new JSZip();
  zip.file(
    '[Content_Types].xml',
    '<?xml version="1.0"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">' +
      '<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>' +
      '<Default Extension="xml" ContentType="application/xml"/>' +
      '<Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/></Types>',
  );
  zip.file(
    '_rels/.rels',
    '<?xml version="1.0"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">' +
      '<Relationship Id="r1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/></Relationships>',
  );
  zip.file(
    'word/document.xml',
    '<?xml version="1.0"?><w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:body>' +
      paragraphs.map((p) => `<w:p><w:r><w:t>${p}</w:t></w:r></w:p>`).join('') +
      '</w:body></w:document>',
  );
  return zip.generateAsync({ type: 'nodebuffer' });
}

describe('resumeContent', () => {
  it('sends a PDF as a document block, followed by the instruction', async () => {
    const content = await resumeContent({ fileName: 'cv.pdf', contentType: PDF, bytes: pdfBytes });
    expect(content[0]).toMatchObject({ type: 'document', title: 'cv.pdf', source: { type: 'base64', media_type: PDF, data: pdfBytes.toString('base64') } });
    expect(content[1]).toMatchObject({ type: 'text' });
  });

  it("sends a Word file's text, marked as the resume", async () => {
    const content = await resumeContent({ fileName: 'cv.docx', contentType: DOCX, bytes: await docx(['Jane Doe', 'Backend Engineer']) });
    expect(content).toHaveLength(1);
    const text = (content[0] as { text: string }).text;
    expect(text).toContain('<resume file_name="cv.docx">');
    expect(text).toContain('Jane Doe\n\nBackend Engineer');
  });

  it('rejects an empty or broken Word file and other types, with a message for the user', async () => {
    await expect(resumeContent({ fileName: 'a.docx', contentType: DOCX, bytes: await docx([]) })).rejects.toThrow('No text was found');
    await expect(resumeContent({ fileName: 'a.docx', contentType: DOCX, bytes: Buffer.from('not a zip') })).rejects.toThrow(ExtractionError);
    await expect(resumeContent({ fileName: 'a.png', contentType: 'image/png', bytes: Buffer.from('x') })).rejects.toThrow('Only PDF and Word');
  });
});

/** A stand-in for Claude: returns a profile, or fails, and can be held until released. */
function fakeExtractor() {
  const calls: ResumeFile[] = [];
  let next: () => Promise<CandidateProfile> = async () => SAMPLE_PROFILE;
  const extractor: ProfileExtractor = {
    extract: async (file) => {
      calls.push(file);
      return next();
    },
  };
  return {
    extractor,
    calls,
    willReturn: (p: CandidateProfile) => (next = async () => p),
    willFail: (e: Error) => (next = async () => Promise.reject(e)),
    /** The next reading waits until `release()` is called. */
    hold: () => {
      let release!: () => void;
      const gate = new Promise<void>((r) => (release = r));
      next = async () => {
        await gate;
        return SAMPLE_PROFILE;
      };
      return () => release();
    },
  };
}

async function setup(opts: { ai?: boolean; readNewUploads?: boolean } = {}) {
  const pool = await testPool();
  await migrate(pool);
  const users = new PgUserStore(pool);
  for (const id of ['u1', 'u2']) await users.upsert({ id, email: `${id}@example.com`, role: 'user', accountStatus: 'active' });
  const objects = new Map<string, Buffer>();
  const files: ResumeFiles = {
    presignUpload: async (key) => ({ url: 'https://s3.example/b', fields: { key }, expiresInSeconds: 300 }),
    head: async (key) => (objects.has(key) ? { size: objects.get(key)!.length } : null),
    readStart: async (key, n) => objects.get(key)!.subarray(0, n),
    read: async (key) => objects.get(key)!,
    markReady: async () => undefined,
    presignDownload: async (key) => `https://s3.example/${key}`,
    delete: async (key) => void objects.delete(key),
    deleteAllForUser: async () => undefined,
  };
  const resumes = new ResumesService(new ResumeStore(pool), files);
  const fake = fakeExtractor();
  const store = new ProfileStore(pool);
  const service = new ProfileService(store, resumes, opts.ai === false ? null : fake.extractor);
  // Off = a resume uploaded before profiles existed (nothing read it).
  if (opts.readNewUploads !== false) service.onModuleInit();
  const upload = async (userId: string, name = 'Jane CV.pdf', body = pdfBytes, type = PDF) => {
    const { resume, upload: link } = await resumes.requestUpload(userId, { fileName: name, contentType: type as typeof PDF, sizeBytes: body.length });
    objects.set(link.fields.key, body);
    return resumes.complete(userId, resume.id);
  };
  return { pool, users, resumes, service, store, fake, upload };
}

describe('ProfileService', () => {
  it('starts with no profile and empty preferences', async () => {
    const { service } = await setup();
    expect(await service.get('u1')).toMatchObject({ status: 'none', profile: null, aiEnabled: true });
    expect(await service.getPreferences('u1')).toEqual(EMPTY_PREFERENCES);
  });

  it('reads a newly uploaded resume into the profile automatically', async () => {
    const { service, fake, upload } = await setup();
    const release = fake.hold();
    await upload('u1', 'Jane CV.pdf');
    expect(await service.get('u1')).toMatchObject({ status: 'parsing', sourceFileName: 'Jane CV.pdf', profile: null });

    release();
    await service.whenIdle('u1');
    const view = await service.get('u1');
    expect(view).toMatchObject({ status: 'ready', profile: SAMPLE_PROFILE, sourceFileName: 'Jane CV.pdf', editedAt: null, error: null });
    expect(view.parsedAt).not.toBeNull();
    expect(fake.calls).toEqual([{ fileName: 'Jane CV.pdf', contentType: PDF, bytes: pdfBytes }]);
    // Only the owner sees it.
    expect((await service.get('u2')).status).toBe('none');
  });

  it('re-reads on request, and refuses while a reading is running or with no resume', async () => {
    const { service, fake, upload } = await setup();
    await expect(service.parseCurrentResume('u1')).rejects.toThrow('Upload a resume first');
    await upload('u1');
    await service.whenIdle('u1');

    const release = fake.hold();
    fake.calls.length = 0;
    expect((await service.parseCurrentResume('u1')).status).toBe('parsing');
    await expect(service.parseCurrentResume('u1')).rejects.toThrow('already being read');
    // The profile from the earlier reading stays visible meanwhile.
    expect((await service.get('u1')).profile).toEqual(SAMPLE_PROFILE);
    release();
    await service.whenIdle('u1');
    expect(fake.calls).toHaveLength(1);
  });

  it('keeps the previous profile when a reading fails, showing a safe message', async () => {
    const { service, fake, upload } = await setup();
    await upload('u1');
    await service.whenIdle('u1');

    fake.willFail(new ExtractionError('The AI service is busy. Please try again in a few minutes.'));
    await service.parseCurrentResume('u1');
    await service.whenIdle('u1');
    expect(await service.get('u1')).toMatchObject({ status: 'failed', profile: SAMPLE_PROFILE, error: 'The AI service is busy. Please try again in a few minutes.' });

    // An unexpected error is logged, never shown.
    fake.willFail(new Error('secret internal detail'));
    await service.parseCurrentResume('u1');
    await service.whenIdle('u1');
    expect((await service.get('u1')).error).toBe('Something went wrong reading your resume. Please try again.');
  });

  it('does not let a superseded reading overwrite a newer one', async () => {
    // No AI, so the upload doesn't start a reading of its own; the test drives the store directly.
    const { service, store, upload } = await setup({ ai: false });
    const r = await upload('u1');
    await store.startParse('u1', 'old-run', r.id, 'old.pdf');
    await store.startParse('u1', 'new-run', r.id, 'new.pdf');
    expect(await store.finishParse('u1', 'old-run', { ...SAMPLE_PROFILE, fullName: 'Old' })).toBe(false);
    await store.failParse('u1', 'old-run', 'old failure');
    expect(await service.get('u1')).toMatchObject({ status: 'parsing', sourceFileName: 'new.pdf', error: null });
    expect(await store.finishParse('u1', 'new-run', SAMPLE_PROFILE)).toBe(true);
    expect((await service.get('u1')).profile?.fullName).toBe('Jane Doe');
  });

  it('treats a reading stuck for too long as failed, so it can be retried', async () => {
    const { service, store, pool, upload, fake } = await setup();
    const release = fake.hold();
    await upload('u1');
    await pool.query(`UPDATE candidate_profile SET updated_at = $2 WHERE user_id = $1`, ['u1', new Date(Date.now() - PARSE_TIMEOUT_MS - 1000)]);
    expect(await service.get('u1')).toMatchObject({ status: 'failed', error: expect.stringContaining('took too long') });
    fake.willReturn(SAMPLE_PROFILE);
    await service.parseCurrentResume('u1');
    await service.whenIdle('u1');
    expect((await store.get('u1'))?.status).toBe('ready');
    release();
  });

  it('saves edits after validating them', async () => {
    const { service, upload } = await setup();
    await upload('u1');
    await service.whenIdle('u1');

    const edited = { ...SAMPLE_PROFILE, skills: ['TypeScript', 'PostgreSQL', 'AWS'] };
    const view = await service.update('u1', edited);
    expect(view.profile).toEqual(edited);
    expect(view.editedAt).not.toBeNull();

    await expect(service.update('u1', { ...SAMPLE_PROFILE, skills: 'AWS' })).rejects.toThrow('skills');
    await expect(service.update('u1', { ...SAMPLE_PROFILE, skills: Array(PROFILE_LIMITS.listItems + 1).fill('x') })).rejects.toThrow('at most');
    await expect(service.update('u1', { ...SAMPLE_PROFILE, summary: 'x'.repeat(PROFILE_LIMITS.textChars + 1) })).rejects.toThrow('at most');
    // A profile can also be written by hand, without a resume.
    expect((await service.update('u2', SAMPLE_PROFILE)).status).toBe('ready');
  });

  it('refuses edits while a reading is running (it would overwrite them)', async () => {
    const { service, fake, upload } = await setup();
    const release = fake.hold();
    await upload('u1');
    await expect(service.update('u1', SAMPLE_PROFILE)).rejects.toThrow('being read');
    release();
    await service.whenIdle('u1');
  });

  it('validates and tidies preferences', async () => {
    const { service } = await setup();
    const saved = await service.updatePreferences('u1', {
      targetTitles: ['Backend Engineer', 'backend engineer', ' Platform Engineer '],
      locations: ['Toronto'],
      workModes: ['remote', 'hybrid', 'remote'],
      minSalary: { amount: 120000, currency: 'CAD', period: 'year' },
      needsSponsorship: false,
      excludedCompanies: ['Initech'],
    });
    expect(saved).toEqual({
      targetTitles: ['backend engineer', 'Platform Engineer'],
      locations: ['Toronto'],
      workModes: ['remote', 'hybrid'],
      minSalary: { amount: 120000, currency: 'CAD', period: 'year' },
      needsSponsorship: false,
      excludedCompanies: ['Initech'],
    });
    expect(await service.getPreferences('u1')).toEqual(saved);
    expect(await service.getPreferences('u2')).toEqual(EMPTY_PREFERENCES);

    await expect(service.updatePreferences('u1', { ...EMPTY_PREFERENCES, workModes: ['moon'] })).rejects.toThrow('workModes');
    await expect(
      service.updatePreferences('u1', { ...EMPTY_PREFERENCES, minSalary: { amount: 1, currency: 'dollars', period: 'year' } }),
    ).rejects.toThrow('3-letter currency');
  });

  it('without AI configured: says so, never reads, but still allows manual edits', async () => {
    const { service, upload } = await setup({ ai: false });
    await upload('u1');
    expect(await service.get('u1')).toMatchObject({ status: 'none', aiEnabled: false });
    await expect(service.parseCurrentResume('u1')).rejects.toThrow("isn't set up");
    expect((await service.update('u1', SAMPLE_PROFILE)).status).toBe('ready');
  });

  it('reads an existing resume once when the user has no profile yet', async () => {
    const { service, fake, upload } = await setup({ readNewUploads: false });
    expect(await service.readIfMissing('u1')).toBe(false); // no resume: nothing to read
    await upload('u1', 'Old CV.pdf');
    expect((await service.get('u1')).status).toBe('none');

    const release = fake.hold();
    // Sign-in and the Profile page can ask at the same moment: only one reading starts.
    expect(await Promise.all([service.readIfMissing('u1'), service.readIfMissing('u1')])).toEqual([true, true]);
    expect(await service.get('u1')).toMatchObject({ status: 'parsing', sourceFileName: 'Old CV.pdf' });
    release();
    await service.whenIdle('u1');
    expect((await service.get('u1')).status).toBe('ready');
    expect(fake.calls).toHaveLength(1);

    // Never again, now a profile exists.
    expect(await service.readIfMissing('u1')).toBe(false);
    expect(fake.calls).toHaveLength(1);
  });

  it('does not retry an automatic reading that failed, or touch a profile typed in by hand', async () => {
    const { service, fake, upload } = await setup({ readNewUploads: false });
    await upload('u1');
    fake.willFail(new ExtractionError("This resume couldn't be read"));
    expect(await service.readIfMissing('u1')).toBe(true);
    await service.whenIdle('u1');
    expect((await service.get('u1')).status).toBe('failed');
    expect(await service.readIfMissing('u1')).toBe(false);

    await upload('u2');
    await service.update('u2', SAMPLE_PROFILE);
    expect(await service.readIfMissing('u2')).toBe(false);
    expect(fake.calls).toHaveLength(1);
  });

  it('without AI configured, never reads automatically', async () => {
    const { service, upload } = await setup({ ai: false, readNewUploads: false });
    await upload('u1');
    expect(await service.readIfMissing('u1')).toBe(false);
  });

  it("deleting the user's account removes their profile and preferences", async () => {
    const { service, users, upload } = await setup();
    await upload('u1');
    await service.whenIdle('u1');
    await service.updatePreferences('u1', { ...EMPTY_PREFERENCES, locations: ['Toronto'] });
    await users.delete('u1');
    expect((await service.get('u1')).status).toBe('none');
    expect(await service.getPreferences('u1')).toEqual(EMPTY_PREFERENCES);
  });

  it('keeps the profile when its source resume is deleted', async () => {
    const { service, resumes, upload } = await setup();
    const r = await upload('u1');
    await service.whenIdle('u1');
    await resumes.delete('u1', r.id);
    expect(await service.get('u1')).toMatchObject({ status: 'ready', profile: SAMPLE_PROFILE });
  });
});

describe('CandidateProfileSchema', () => {
  it('accepts the sample and rejects a wrong shape', () => {
    expect(CandidateProfileSchema.safeParse(SAMPLE_PROFILE).success).toBe(true);
    expect(CandidateProfileSchema.safeParse({ ...SAMPLE_PROFILE, workHistory: [{ title: 'x' }] }).success).toBe(false);
  });
});
