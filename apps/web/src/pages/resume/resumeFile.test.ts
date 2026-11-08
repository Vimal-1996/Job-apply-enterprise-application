import { describe, expect, it } from 'vitest';
import { checkFile, contentTypeFor, formatBytes, MAX_BYTES } from './resumeFile';

describe('contentTypeFor', () => {
  it('maps PDF and Word by extension, case-insensitively', () => {
    expect(contentTypeFor('cv.PDF')).toBe('application/pdf');
    expect(contentTypeFor('Jane.Doe.CV.docx')).toBe('application/vnd.openxmlformats-officedocument.wordprocessingml.document');
  });
  it('rejects other types', () => {
    for (const n of ['cv.doc', 'cv.png', 'cv', 'pdf']) expect(contentTypeFor(n)).toBeNull();
  });
});

describe('checkFile', () => {
  it('accepts a resume within the limit', () => {
    expect(checkFile({ name: 'cv.pdf', size: MAX_BYTES })).toBeNull();
  });
  it('explains what is wrong', () => {
    expect(checkFile({ name: 'cv.png', size: 10 })).toMatch(/PDF or Word/);
    expect(checkFile({ name: 'cv.pdf', size: 0 })).toMatch(/empty/);
    expect(checkFile({ name: 'cv.pdf', size: MAX_BYTES + 1 })).toMatch(/limit is 5 MB/);
  });
});

describe('formatBytes', () => {
  it('reads naturally', () => {
    expect(formatBytes(900)).toBe('900 B');
    expect(formatBytes(48_000)).toBe('47 KB');
    expect(formatBytes(2_621_440)).toBe('2.5 MB');
  });
});
