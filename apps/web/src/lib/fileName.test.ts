import { describe, expect, it } from 'vitest';
import { dispositionFileName } from './fileName';

describe('dispositionFileName', () => {
  it('prefers the UTF-8 name and falls back to the plain one', () => {
    expect(dispositionFileName(`attachment; filename="Jos_ - Acme resume.docx"; filename*=UTF-8''Jos%C3%A9%20-%20Acme%20resume.docx`)).toBe(
      'José - Acme resume.docx',
    );
    expect(dispositionFileName('attachment; filename="cv.docx"')).toBe('cv.docx');
    expect(dispositionFileName(`attachment; filename="cv.docx"; filename*=UTF-8''%E0%A4%A`)).toBe('cv.docx');
    expect(dispositionFileName(null)).toBeNull();
  });
});
