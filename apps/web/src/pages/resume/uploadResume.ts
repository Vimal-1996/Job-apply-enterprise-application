import { apiPost } from '../../api/client';
import type { PresignedUpload, Resume } from '../../api/types';
import { contentTypeFor } from './resumeFile';

/** Sends the file straight to storage with the presigned form; reports progress (0–1). */
function postToStorage(upload: PresignedUpload, file: File, contentType: string, onProgress: (f: number) => void): Promise<void> {
  return new Promise((resolve, reject) => {
    const form = new FormData();
    for (const [k, v] of Object.entries(upload.fields)) form.append(k, v);
    form.set('Content-Type', contentType);
    form.append('file', file); // must be the last field
    const xhr = new XMLHttpRequest(); // fetch can't report upload progress
    xhr.open('POST', upload.url);
    xhr.upload.onprogress = (e) => e.lengthComputable && onProgress(e.loaded / e.total);
    xhr.onload = () => (xhr.status >= 200 && xhr.status < 300 ? resolve() : reject(new Error(`Upload failed (${xhr.status})`)));
    xhr.onerror = () => reject(new Error('Upload failed: check your connection and try again.'));
    xhr.send(form);
  });
}

/** Request a link, upload the file, then ask the API to verify it and make it current. */
export async function uploadResume(file: File, token: string | undefined, onProgress: (f: number) => void): Promise<Resume> {
  const contentType = contentTypeFor(file.name)!;
  const { resume, upload } = await apiPost<{ resume: Resume; upload: PresignedUpload }>('/resumes/uploads', token, {
    fileName: file.name,
    contentType,
    sizeBytes: file.size,
  });
  await postToStorage(upload, file, contentType, onProgress);
  return apiPost<Resume>(`/resumes/${resume.id}/complete`, token);
}
