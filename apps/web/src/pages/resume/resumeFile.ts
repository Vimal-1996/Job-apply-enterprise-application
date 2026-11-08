/** Same rules as the API; the API re-checks everything, including the file's real bytes. */
export const MAX_BYTES = 5 * 1024 * 1024;

const TYPES: Record<string, string> = {
  '.pdf': 'application/pdf',
  '.docx': 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
};

export const ACCEPT = Object.keys(TYPES).concat(Object.values(TYPES)).join(',');

/** From the extension: browsers often report an empty type for .docx. */
export function contentTypeFor(fileName: string): string | null {
  const ext = fileName.slice(fileName.lastIndexOf('.')).toLowerCase();
  return TYPES[ext] ?? null;
}

/** A message for the user, or null if the file can be uploaded. */
export function checkFile(file: { name: string; size: number }): string | null {
  if (!contentTypeFor(file.name)) return 'Choose a PDF or Word (.docx) file.';
  if (file.size === 0) return 'That file is empty.';
  if (file.size > MAX_BYTES) return `That file is ${formatBytes(file.size)}; the limit is 5 MB.`;
  return null;
}

export function formatBytes(n: number): string {
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${Math.round(n / 1024)} KB`;
  return `${(n / (1024 * 1024)).toFixed(1)} MB`;
}

export function kindOf(contentType: string): string {
  return contentType === 'application/pdf' ? 'PDF' : 'Word';
}
