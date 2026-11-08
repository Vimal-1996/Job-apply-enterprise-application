import { useCallback, useEffect, useRef, useState, type DragEvent } from 'react';
import { useAuth } from 'react-oidc-context';
import { ApiError, apiDelete, apiGet, apiPost } from '../../api/client';
import type { Resume } from '../../api/types';
import { Badge, Spinner } from '../../components/ui';
import { formatDateTime } from '../admin/format';
import { ACCEPT, checkFile, formatBytes, kindOf } from './resumeFile';
import { uploadResume } from './uploadResume';

type Notice = { ok: boolean; text: string } | null;

const message = (e: unknown, fallback: string) => (e instanceof ApiError || e instanceof Error ? e.message : fallback);

/** The signed-in user's resume: upload, replace, download, earlier versions. */
export function ResumePage() {
  const auth = useAuth();
  const token = auth.user?.access_token;
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

  return (
    <>
      <header className="page-head">
        <h1>Resume</h1>
        <p>Keep your latest resume here. Only you can see it. PDF or Word (.docx), up to 5 MB; your last 5 versions are kept.</p>
      </header>

      <div
        className={`card dropzone ${dragging ? 'dragging' : ''}`}
        onDragOver={(e) => {
          e.preventDefault();
          setDragging(true);
        }}
        onDragLeave={() => setDragging(false)}
        onDrop={onDrop}
      >
        {uploading ? (
          <div className="upload-progress" role="status" aria-live="polite">
            <span>Uploading… {Math.round((progress ?? 0) * 100)}%</span>
            <progress max={1} value={progress ?? 0} />
          </div>
        ) : (
          <>
            <span className="dropzone-icon" aria-hidden>
              📄
            </span>
            <strong>{current ? 'Upload a new version' : 'Upload your resume'}</strong>
            <span className="muted">Drag a file here, or</span>
            <label className="btn btn-primary">
              Choose a file
              <input
                id="resume-file"
                ref={inputRef}
                type="file"
                accept={ACCEPT}
                className="visually-hidden"
                onChange={(e) => void upload(e.target.files?.[0])}
              />
            </label>
          </>
        )}
      </div>

      {notice && (
        <p role={notice.ok ? 'status' : 'alert'} className={notice.ok ? 'notice ok' : 'notice error'}>
          {notice.text}
        </p>
      )}

      {loadError ? (
        <div className="banner">⚠️ Could not load your resumes. Check that the API is running, then refresh.</div>
      ) : resumes === null ? (
        <div className="center" style={{ minHeight: 120 }}>
          <Spinner />
        </div>
      ) : current ? (
        <div className="card">
          <div className="row">
            <h3>Current resume</h3>
            <Badge tone="success" dot>
              Current
            </Badge>
          </div>
          <ResumeLine r={current} />
          {rowActions(current)}

          {earlier.length > 0 && (
            <div className="resume-earlier">
              <h4>Earlier versions</h4>
              <ul>
                {earlier.map((r) => (
                  <li key={r.id}>
                    <ResumeLine r={r} />
                    {rowActions(r)}
                  </li>
                ))}
              </ul>
            </div>
          )}
        </div>
      ) : (
        <p className="muted">You haven't uploaded a resume yet.</p>
      )}
    </>
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
