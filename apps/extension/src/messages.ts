import type { FieldReport, FillData, ResumeFile } from './fill/fields';
import type { PageJob } from './fill/sites';

/** Messages from the side panel to the content script in the job page. */
export type ToContent = { type: 'detect' } | { type: 'fill'; data: FillData; resume: ResumeFile | null };

export interface DetectReply {
  job: PageJob;
  hasForm: boolean;
}

export interface FillReply {
  report: FieldReport[];
}
