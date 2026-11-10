import { CandidateProfile } from '../profile/profile.schema';
import { BadRequestException } from '@nestjs/common';
import { buildResumeDocx, parseFormat, parseLayout, ResumeFormat, ResumeLayout } from './resume-docx';
import { buildResumePdf } from './resume-pdf';

export const CONTENT_TYPES: Record<ResumeFormat, string> = {
  docx: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  pdf: 'application/pdf',
};

/** The resume as a file in the chosen format and layout. */
export function buildResumeFile(p: CandidateProfile, layout: ResumeLayout, format: ResumeFormat): Promise<Buffer> {
  return format === 'pdf' ? buildResumePdf(p, layout) : buildResumeDocx(p, layout);
}

/** Reads ?layout= and ?format=, or rejects the request. */
export function parseResumeQuery(layoutParam?: string, formatParam?: string): { layout: ResumeLayout; format: ResumeFormat } {
  const layout = parseLayout(layoutParam);
  if (!layout) throw new BadRequestException('layout must be standard or workday');
  const format = parseFormat(formatParam);
  if (!format) throw new BadRequestException('format must be docx or pdf');
  return { layout, format };
}
