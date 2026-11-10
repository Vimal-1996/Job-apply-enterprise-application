import { useCallback, useEffect, useRef, useState, type DragEvent } from 'react';
import { ApiError, apiDelete, apiGet, apiPost } from '../../api/client';
import type { Resume } from '../../api/types';
import { Badge, Spinner } from '../../components/ui';
import { formatDateTime } from '../admin/format';
import { ACCEPT, checkFile, formatBytes, kindOf } from './resumeFile';
import { uploadResume } from './uploadResume';

type Notice = { ok: boolean; text: string } | null;

const message = (e: unknown, fallback: string) => (e instanceof ApiError || e instanceof Error ? e.message : fallback);

/**
 * The user's resume file, at the top of the Profile page: upload (or drop) a
 * new version, download, switch to or delete earlier versions. A new upload is
 * read into the profile automatically; `onUploaded` lets the page show that.
 */
export function ResumeCard({ token, onUploaded }: { token: string | undefined; onUploaded: () => void }) {
  const [resumes, setResumes] = useState<Resume[] | null>(null);
  const [loadError, setLoadError] = useState(false);
  const [progress, setProgress] = useState<number | null>(null);
  const [notice, setNotice] = useState<Notice>(null);
  const [dragging, setDragging] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState<string | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  const load = useCallback(async () => {
    try {
      setResumes(await apiGet<Resume[]>('/resumes', token));
      setLoadError(false);
    } catch {
      setLoadError(true);
    }
  }, [token]);

  useEffect(() => {
    void load();
  }, [load]);

  const upload = async (file: File | undefined) => {
    if (!file) return;
    setNotice(null);
    const problem = checkFile(file);
    if (problem) {
      setNotice({ ok: false, text: problem });
      return;
    }
    setProgress(0);
    try {
      const r = await uploadResume(file, token, setProgress);
      setNotice({ ok: true, text: `${r.fileName} is now your current resume.` });
      await load();
      onUploaded();
    } catch (e) {
      setNotice({ ok: false, text: message(e, 'Upload failed. Please try again.') });
    } finally {
      setProgress(null);
      if (inputRef.current) inputRef.current.value = '';
    }
  };

  const act = async (id: string, fn: () => Promise<unknown>, done: string) => {
    setBusyId(id);
    setNotice(null);
    try {
      await fn();
      setNotice({ ok: true, text: done });
      await load();
      onUploaded();
    } catch (e) {
      setNotice({ ok: false, text: message(e, 'Something went wrong. Please try again.') });
    } finally {
      setBusyId(null);
      setConfirmDelete(null);
    }
  };

  const download = async (r: Resume) => {
    setBusyId(r.id);
    try {
      const { url } = await apiGet<{ url: string }>(`/resumes/${r.id}/download`, token);
      window.location.assign(url); // the link is short-lived and saves as an attachment
    } catch (e) {
      setNotice({ ok: false, text: message(e, 'Could not start the download.') });
    } finally {
      setBusyId(null);
    }
  };

  const onDrop = (e: DragEvent) => {
    e.preventDefault();
    setDragging(false);
    if (progress === null) void upload(e.dataTransfer.files[0]);
  };

  const current = resumes?.find((r) => r.isCurrent) ?? null;
  const earlier = resumes?.filter((r) => !r.isCurrent) ?? [];
  const uploading = progress !== null;

  const rowActions = (r: Resume) =>
    confirmDelete === r.id ? (
      <div className="row resume-actions" role="group" aria-label={`Delete ${r.fileName}?`}>
        <span>Delete this file for good?</span>
        <button className="btn btn-danger" onClick={() => void act(r.id, () => apiDelete(`/resumes/${r.id}`, token), `${r.fileName} deleted.`)} disabled={busyId === r.id} autoFocus>
          {busyId === r.id && <Spinner small />} Delete
        </button>
        <button className="btn btn-ghost" onClick={() => setConfirmDelete(null)}>
          Cancel
        </button>
      </div>
    ) : (
      <div className="row resume-actions">
        <button className="btn btn-ghost" onClick={() => void download(r)} disabled={busyId === r.id}>
          Download
        </button>
        {!r.isCurrent && (
          <button className="btn btn-ghost" onClick={() => void act(r.id, () => apiPost(`/resumes/${r.id}/current`, token), `${r.fileName} is now your current resume.`)} disabled={busyId === r.id}>
            Make current
          </button>
        )}
        <button className="btn btn-danger-ghost" onClick={() => setConfirmDelete(r.id)} disabled={busyId === r.id}>
          Delete
        </button>
      </div>
    );

  const dropHandlers = {
    onDragOver: (e: DragEvent) => {
      e.preventDefault();
      setDragging(true);
    },
    onDragLeave: () => setDragging(false),
    onDrop,
  };

  const chooseFile = (label: string, primary: boolean) => (
    <label className={`btn ${primary ? 'btn-primary' : 'btn-ghost'}`}>
      {label}
      <input id="resume-file" ref={inputRef} type="file" accept={ACCEPT} className="visually-hidden" onChange={(e) => void upload(e.target.files?.[0])} />
    </label>
  );

  const progressBar = (
    <div className="upload-progress" role="status" aria-live="polite">
      <span>Uploading… {Math.round((progress ?? 0) * 100)}%</span>
      <progress max={1} value={progress ?? 0} />
    </div>
  );

  const noticeLine = notice && (
    <p role={notice.ok ? 'status' : 'alert'} className={notice.ok ? 'notice ok' : 'notice error'}>
      {notice.text}
    </p>
  );

  if (loadError) return <div className="banner">⚠️ Could not load your resume. Check that the API is running, then refresh.</div>;
  if (resumes === null)
    return (
      <div className="card center" style={{ minHeight: 100 }}>
        <Spinner />
      </div>
    );

  // No resume yet: a big drop area.
  if (!current)
    return (
      <>
        <div className={`card dropzone ${dragging ? 'dragging' : ''}`} {...dropHandlers}>
          {uploading ? (
            progressBar
          ) : (
            <>
              <span className="dropzone-icon" aria-hidden>
                📄
              </span>
              <strong>Upload your resume</strong>
              <span className="muted">We'll read it into your profile below. PDF or Word (.docx), up to 5 MB. Drag a file here, or</span>
              {chooseFile('Choose a file', true)}
            </>
          )}
        </div>
        {noticeLine}
      </>
    );

  // A resume: the file, its actions, and the whole card takes a dropped new version.
  return (
    <div className={`card resume-card ${dragging ? 'dragging' : ''}`} {...dropHandlers}>
      <div className="row">
        <h3>Your resume</h3>
        <Badge tone="success" dot>
          Current
        </Badge>
        <span className="spacer" />
        {!uploading && chooseFile('Upload a new version', false)}
      </div>
      {uploading ? progressBar : <ResumeLine r={current} />}
      {rowActions(current)}
      {noticeLine}

      {earlier.length > 0 && (
        <details className="resume-earlier">
          <summary>
            Earlier versions ({earlier.length})
          </summary>
          <ul>
            {earlier.map((r) => (
              <li key={r.id}>
                <ResumeLine r={r} />
                {rowActions(r)}
              </li>
            ))}
          </ul>
        </details>
      )}
      <p className="muted" style={{ margin: 0, fontSize: 13 }}>
        Only you can see it. Drop a file on this card to replace it; your last 5 versions are kept.
      </p>
    </div>
  );
}

function ResumeLine({ r }: { r: Resume }) {
  return (
    <div className="resume-line">
      <span className="resume-name">{r.fileName}</span>
      <span className="muted">
        {kindOf(r.contentType)} · {formatBytes(r.sizeBytes)} · uploaded {formatDateTime(r.uploadedAt)}
      </span>
    </div>
  );
}
