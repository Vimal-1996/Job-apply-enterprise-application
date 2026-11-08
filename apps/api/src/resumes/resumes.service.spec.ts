import { S3Client } from '@aws-sdk/client-s3';
import { migrate } from '../db/migrate';
import { closeTestPools, testPool } from '../db/test-pool';
import { PgUserStore } from '../db/user-store';
import { attachmentDisposition, ResumeFiles, S3ResumeFiles } from './resume-files';
import { ResumeStore } from './resume-store';
import { KEEP_VERSIONS, looksLike, MAX_BYTES, parseUploadRequest, ResumesService } from './resumes.service';

const PDF = 'application/pdf';
const DOCX = 'application/vnd.openxmlformats-officedocument.wordprocessingml.document';
const pdfBytes = Buffer.from('%PDF-1.7\n...');
const docxBytes = Buffer.from([0x50, 0x4b, 0x03, 0x04, 0x14, 0x00]);

afterAll(closeTestPools);

describe('parseUploadRequest', () => {
  const ok = { fileName: 'Jane Doe CV.pdf', contentType: PDF, sizeBytes: 1000 };

  it('accepts a PDF or Word file and keeps only the base name', () => {
    expect(parseUploadRequest(ok)).toEqual(ok);
    expect(parseUploadRequest({ ...ok, fileName: 'C:\\Users\\jane\\cv.docx', contentType: DOCX }).fileName).toBe('cv.docx');
    expect(parseUploadRequest({ ...ok, fileName: '../../etc/cv.pdf' }).fileName).toBe('cv.pdf');
  });

  it.each([
    [{ ...ok, contentType: 'image/png' }, 'PDF or Word'],
    [{ ...ok, contentType: 'application/msword', fileName: 'cv.doc' }, 'PDF or Word'],
    [{ ...ok, fileName: 'cv.docx' }, 'must end in .pdf'],
    [{ ...ok, fileName: '' }, '1–200'],
    [{ ...ok, fileName: `${'a'.repeat(200)}.pdf` }, '1–200'],
    [{ ...ok, sizeBytes: 0 }, 'empty'],
    [{ ...ok, sizeBytes: 1.5 }, 'empty'],
    [{ ...ok, sizeBytes: MAX_BYTES + 1 }, 'larger than 5 MB'],
    [null, 'PDF or Word'],
  ])('rejects %j', (body, message) => {
    expect(() => parseUploadRequest(body)).toThrow(message);
  });
});

describe('looksLike', () => {
  it('checks the real bytes', () => {
    expect(looksLike(PDF, pdfBytes)).toBe(true);
    expect(looksLike(DOCX, docxBytes)).toBe(true);
    expect(looksLike(PDF, docxBytes)).toBe(false);
    expect(looksLike(DOCX, pdfBytes)).toBe(false);
    expect(looksLike(PDF, Buffer.from('<html>'))).toBe(false);
    expect(looksLike(DOCX, Buffer.alloc(0))).toBe(false);
  });
});

describe('attachmentDisposition', () => {
  it('forces a download and keeps non-ASCII names', () => {
    expect(attachmentDisposition('Résumé "final".pdf')).toBe(
      `attachment; filename="R_sum_ _final_.pdf"; filename*=UTF-8''R%C3%A9sum%C3%A9%20%22final%22.pdf`,
    );
  });
});

describe('S3ResumeFiles.presignUpload (offline signing)', () => {
  it('locks the upload to one key, a size range, the type and the pending tag', async () => {
    const client = new S3Client({ region: 'us-east-1', credentials: { accessKeyId: 'AKIDEXAMPLE', secretAccessKey: 'secret' } });
    const files = new S3ResumeFiles(client, 'bucket');
    const { url, fields, expiresInSeconds } = await files.presignUpload('users/u1/r1', PDF, MAX_BYTES);
    expect(url).toContain('bucket');
    expect(expiresInSeconds).toBe(300);
    expect(fields).toMatchObject({ key: 'users/u1/r1', 'Content-Type': PDF });
    expect(fields.tagging).toContain('<Value>pending</Value>');
    const policy = JSON.parse(Buffer.from(fields.Policy, 'base64').toString());
    expect(policy.conditions).toEqual(
      expect.arrayContaining([
        { key: 'users/u1/r1' },
        ['content-length-range', 1, MAX_BYTES],
        ['eq', '$Content-Type', PDF],
        ['eq', '$tagging', fields.tagging],
      ]),
    );
    expect(new Date(policy.expiration).getTime() - Date.now()).toBeLessThanOrEqual(300_000);
  });
});

/** In-memory stand-in for S3. */
function fakeFiles() {
  const objects = new Map<string, { body: Buffer; tag: string }>();
  const files: ResumeFiles & { objects: typeof objects } = {
    objects,
    presignUpload: jest.fn(async (key: string) => ({ url: 'https://s3.example/bucket', fields: { key }, expiresInSeconds: 300 })),
    head: jest.fn(async (key: string) => (objects.has(key) ? { size: objects.get(key)!.body.length } : null)),
    readStart: jest.fn(async (key: string, n: number) => objects.get(key)!.body.subarray(0, n)),
    markReady: jest.fn(async (key: string) => void (objects.get(key)!.tag = 'ready')),
    presignDownload: jest.fn(async (key: string, name: string) => `https://s3.example/${key}?name=${name}`),
    delete: jest.fn(async (key: string) => void objects.delete(key)),
    deleteAllForUser: jest.fn(async (userId: string) => {
      for (const k of [...objects.keys()]) if (k.startsWith(`users/${userId}/`)) objects.delete(k);
    }),
  };
  return files;
}

async function setup() {
  const pool = await testPool();
  await migrate(pool);
  const users = new PgUserStore(pool);
  for (const id of ['u1', 'u2']) await users.upsert({ id, email: `${id}@example.com`, role: 'user', accountStatus: 'active' });
  const files = fakeFiles();
  const service = new ResumesService(new ResumeStore(pool), files);
  /** Requests an upload, "uploads" the bytes like the browser would, and completes it. */
  const upload = async (userId: string, name = 'cv.pdf', body = pdfBytes, type = PDF) => {
    const { resume, upload: link } = await service.requestUpload(userId, { fileName: name, contentType: type as typeof PDF, sizeBytes: body.length });
    files.objects.set(link.fields.key, { body, tag: 'pending' });
    return service.complete(userId, resume.id);
  };
  return { pool, users, files, service, upload };
}

describe('ResumesService', () => {
  it('stores an upload under the user, verifies it, and makes it current', async () => {
    const { service, files, upload } = await setup();
    const r = await upload('u1', 'Jane CV.pdf');
    expect(r).toMatchObject({ fileName: 'Jane CV.pdf', contentType: PDF, sizeBytes: pdfBytes.length, isCurrent: true });
    expect(r.uploadedAt).not.toBeNull();
    expect([...files.objects.keys()]).toEqual([`users/u1/${r.id}`]);
    expect(files.objects.get(`users/u1/${r.id}`)!.tag).toBe('ready');
    expect(await service.list('u1')).toEqual([r]);
  });

  it('does not list or download an upload that was never completed', async () => {
    const { service } = await setup();
    const { resume } = await service.requestUpload('u1', { fileName: 'cv.pdf', contentType: PDF, sizeBytes: 10 });
    expect(await service.list('u1')).toEqual([]);
    await expect(service.downloadLink('u1', resume.id)).rejects.toThrow('not found');
    await expect(service.complete('u1', resume.id)).rejects.toThrow("hasn't finished uploading");
  });

  it('rejects and removes a file that is not what it claims to be', async () => {
    const { service, files, upload } = await setup();
    await expect(upload('u1', 'cv.pdf', Buffer.from('<html>not a pdf</html>'))).rejects.toThrow("doesn't look like a valid PDF");
    expect(files.objects.size).toBe(0);
    expect(await service.list('u1')).toEqual([]);
  });

  it('accepts a Word file', async () => {
    const { upload } = await setup();
    await expect(upload('u1', 'cv.docx', docxBytes, DOCX)).resolves.toMatchObject({ contentType: DOCX });
  });

  it('keeps the newest versions, one current, deleting the oldest files', async () => {
    const { service, files, upload } = await setup();
    const ids: string[] = [];
    for (let i = 1; i <= KEEP_VERSIONS + 2; i++) ids.push((await upload('u1', `cv-${i}.pdf`)).id);
    const list = await service.list('u1');
    expect(list).toHaveLength(KEEP_VERSIONS);
    expect(list.filter((r) => r.isCurrent).map((r) => r.fileName)).toEqual([`cv-${KEEP_VERSIONS + 2}.pdf`]);
    expect(list.map((r) => r.id)).not.toContain(ids[0]);
    expect(files.objects.size).toBe(KEEP_VERSIONS);
  });

  it('switches the current version, and promotes the newest when the current one is deleted', async () => {
    const { service, upload } = await setup();
    const a = await upload('u1', 'a.pdf');
    const b = await upload('u1', 'b.pdf');
    await service.makeCurrent('u1', a.id);
    expect((await service.list('u1')).find((r) => r.isCurrent)!.id).toBe(a.id);
    await service.delete('u1', a.id);
    expect(await service.list('u1')).toEqual([expect.objectContaining({ id: b.id, isCurrent: true })]);
  });

  it("never lets one user see or touch another's resume", async () => {
    const { service, upload } = await setup();
    const mine = await upload('u1');
    expect(await service.list('u2')).toEqual([]);
    await expect(service.downloadLink('u2', mine.id)).rejects.toThrow('not found');
    await expect(service.makeCurrent('u2', mine.id)).rejects.toThrow('not found');
    await expect(service.delete('u2', mine.id)).rejects.toThrow('not found');
    await expect(service.complete('u2', mine.id)).rejects.toThrow('not found');
    expect(await service.list('u1')).toHaveLength(1);
  });

  it('gives a download link for the original file name', async () => {
    const { service, upload } = await setup();
    const r = await upload('u1', 'Jane CV.pdf');
    expect(await service.downloadLink('u1', r.id)).toEqual({
      url: `https://s3.example/users/u1/${r.id}?name=Jane CV.pdf`,
      expiresInSeconds: 60,
    });
  });

  it('limits unfinished upload requests per hour', async () => {
    const { service } = await setup();
    for (let i = 0; i < 5; i++) await service.requestUpload('u1', { fileName: 'cv.pdf', contentType: PDF, sizeBytes: 10 });
    await expect(service.requestUpload('u1', { fileName: 'cv.pdf', contentType: PDF, sizeBytes: 10 })).rejects.toThrow(
      'Too many unfinished uploads',
    );
  });

  it("deleting the user's account row deletes their resume rows", async () => {
    const { users, service, upload } = await setup();
    await upload('u1');
    await users.delete('u1');
    expect(await service.list('u1')).toEqual([]);
  });
});
