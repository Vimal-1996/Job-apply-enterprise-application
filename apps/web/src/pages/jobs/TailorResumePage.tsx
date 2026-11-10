import { useCallback, useEffect, useRef, useState } from 'react';
import { useAuth } from 'react-oidc-context';
import { Link, useParams } from 'react-router-dom';
import { ApiError, apiDownload, apiGet, apiPatch, apiPost, apiPut } from '../../api/client';
import type { Decision, DraftView, JobView, Suggestion } from '../../api/types';
import { Badge, Spinner } from '../../components/ui';
import { formatDateTime } from '../admin/format';
import { POLL_MS } from './JobsPage';
import { jobTitle } from './jobView';
import { GapsCard, type GapAnswer } from './GapsCard';
import { FormatSelect, ResumeFormat } from './ResumeFormat';
import { ScoreCard } from './ScoreCard';
import {
  acceptAllIds,
  counts,
  documentUrl,
  finalText,
  isWorkdayJob,
  ownSuggestions,
  shouldAutoStart,
  suggestionLabel,
  tailorProgress,
  type FileFormat,
} from './tailorView';

const message = (e: unknown, fallback: string) => (e instanceof ApiError || e instanceof Error ? e.message : fallback);

interface Update {
  id: string;
  decision: Decision;
  editedText?: string | null;
}

/**
 * Tailor the resume to one job, in three steps: review Claude's suggestions
 * (accept, edit or reject each); answer the job's gaps (describe experience
 * the resume doesn't show, and Claude writes it up); then generate the
 * resume, which scores it against the job, and download it as a PDF or Word
 * file. Suggestions start as soon as the page opens.
 */
export function TailorResumePage() {
  const { id = '' } = useParams();
  const token = useAuth().user?.access_token;
  const base = `/jobs/${encodeURIComponent(id)}/resume-draft`;
  const [job, setJob] = useState<JobView | null>(null);
  const [draft, setDraft] = useState<DraftView | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [confirmRedo, setConfirmRedo] = useState(false);
  /** null until the user chooses: then the job's own default (Workday jobs get the Workday layout). */
  const [workdayChoice, setWorkdayChoice] = useState<boolean | null>(null);
  const [format, setFormat] = useState<FileFormat>('pdf');
  /** Starts suggestions once per visit, even if effects run twice (React's dev mode). */
  const autoStarted = useRef(false);

  const load = useCallback(async () => {
    try {
      const [j, d] = await Promise.all([apiGet<JobView>(`/jobs/${encodeURIComponent(id)}`, token), apiGet<DraftView>(base, token)]);
      setJob(j);
      setDraft(d);
      setLoadError(null);
    } catch (e) {
      setLoadError(e instanceof ApiError && (e.status === 404 || e.status === 400) ? 'This job was not found.' : 'Could not load this page.');
    }
  }, [id, base, token]);

  useEffect(() => {
    void load();
  }, [load]);

  const suggesting = draft?.status === 'suggesting';
  const scoring = draft?.score.status === 'scoring';
  useEffect(() => {
    if (!suggesting && !scoring) return;
    const t = window.setInterval(() => void load(), POLL_MS);
    return () => window.clearInterval(t);
  }, [suggesting, scoring, load]);

  const act = async (fn: () => Promise<void>, fallback: string) => {
    setBusy(true);
    setError(null);
    try {
      await fn();
    } catch (e) {
      setError(message(e, fallback));
    } finally {
      setBusy(false);
    }
  };

  const start = useCallback(
    () =>
      act(async () => {
        setDraft(await apiPost<DraftView>(base, token));
        setConfirmRedo(false);
      }, 'Could not start making suggestions.'),
    [base, token],
  );

  // Opening this page (the job's "Tailor my resume" button) starts the suggestions: no extra click.
  useEffect(() => {
    if (!job || !draft || autoStarted.current || !shouldAutoStart(draft, job)) return;
    autoStarted.current = true;
    void start();
  }, [job, draft, start]);

  const generate = () => act(async () => setDraft(await apiPost<DraftView>(`${base}/score`, token)), 'Could not generate your resume.');

  /** Answers a gap; true if it was saved (a "yes" waits while Claude writes it up). */
  const answerGap = async (gapId: string, a: GapAnswer): Promise<boolean> => {
    setBusy(true);
    setError(null);
    try {
      setDraft(await apiPut<DraftView>(`${base}/gaps/${encodeURIComponent(gapId)}`, token, a));
      return true;
    } catch (e) {
      setError(message(e, 'Could not save your answer.'));
      return false;
    } finally {
      setBusy(false);
    }
  };

  const decide = (updates: Update[]) =>
    act(async () => setDraft(await apiPatch<DraftView>(base, token, { decisions: updates })), 'Could not save your choice.');

  const workdaySuggested = job ? isWorkdayJob(job) : false;
  const workday = workdayChoice ?? workdaySuggested;
  const download = () =>
    act(() => apiDownload(documentUrl(`${base}/document`, { format, workday }), token, `Tailored resume.${format}`), 'Could not create the resume.');

  if (loadError)
    return (
      <div className="card">
        <p className="notice error" role="alert">
          {loadError}
        </p>
        <Link to="/jobs">← Back to jobs</Link>
      </div>
    );
  if (!job || !draft)
    return (
      <div className="center" style={{ minHeight: 160 }}>
        <Spinner />
      </div>
    );

  const own = ownSuggestions(draft.suggestions);
  const c = counts(own);
  const bulk = acceptAllIds(own);
  const hasSuggestions = own.length > 0;
  const hasResult = hasSuggestions || draft.gaps.length > 0;
  const decided = c.accepted + c.rejected > 0 || draft.gaps.some((g) => g.answer !== 'pending');
  const progress = tailorProgress(draft);

  return (
    <>
      <p style={{ margin: '0 0 12px' }}>
        <Link to={`/jobs/${id}`}>← {jobTitle(job)}</Link>
      </p>
      <header className="page-head">
        <h1>Tailor your resume</h1>
        <p>
          For {jobTitle(job)}
          {job.company ? ` at ${job.company}` : ''}. Claude suggests changes that make your resume clearer to applicant tracking systems
          (ATS) and recruiters. Nothing changes until you accept it, and your original resume is never touched.
        </p>
      </header>

      {error && (
        <p role="alert" className="notice error" style={{ marginBottom: 12 }}>
          {error}
        </p>
      )}

      {draft.status === 'none' && (
        <div className="card">
          {!draft.aiEnabled ? (
            <p className="muted">Tailoring resumes with AI isn't set up on this server.</p>
          ) : !job.details ? (
            <p className="muted">Wait until this job has been matched, then come back to tailor your resume to it.</p>
          ) : (
            <div className="row" role="status" aria-live="polite">
              {error && !busy ? (
                // Starting failed (the error is shown above): let the user try again.
                <button className="btn btn-primary" onClick={() => void start()}>
                  Try again
                </button>
              ) : (
                <>
                  <Spinner small /> Starting your suggestions…
                </>
              )}
            </div>
          )}
        </div>
      )}

      {suggesting && (
        <div className="card">
          <div className="row" role="status" aria-live="polite">
            <Spinner small /> Reading your profile and the job, and preparing suggestions. This usually takes under a minute.
          </div>
        </div>
      )}

      {draft.status === 'failed' && draft.error && (
        <div className="card">
          <p role="alert" className="notice error">
            {draft.error}
            {hasResult && ' Your previous suggestions are shown below.'}
          </p>
          <div>
            <button className="btn btn-ghost" onClick={() => void start()} disabled={busy}>
              Try again
            </button>
          </div>
        </div>
      )}

      {hasResult && !suggesting && (
        <>
          <div className="card">
            <div className="row">
              <h3>Suggestions</h3>
              {hasSuggestions && (
                <span className="muted">
                  {c.accepted} accepted · {c.rejected} rejected · {c.pending} to review
                </span>
              )}
              <span className="spacer" />
              {bulk.length > 0 && (
                <button className="btn btn-ghost" onClick={() => void decide(bulk.map((x) => ({ id: x, decision: 'accepted' })))} disabled={busy}>
                  Accept all ({bulk.length})
                </button>
              )}
            </div>
            {draft.suggestedAt && <p className="muted" style={{ margin: 0 }}>Suggested {formatDateTime(draft.suggestedAt)}</p>}
            {!hasSuggestions && <p className="muted" style={{ margin: 0 }}>Your resume already words what it shows well for this job: nothing worth rewording.</p>}
            {draft.profileChanged && (
              <p role="status" className="notice">
                Your profile changed after these suggestions were made. Fixes to dates, locations and contact details are included; get new
                suggestions if you changed your experience or skills.
              </p>
            )}
          </div>

          {own.map((s) => (
            <SuggestionCard key={s.id} s={s} roles={draft.roles} busy={busy} onDecide={(u) => void decide([u])} />
          ))}

          <GapsCard draft={draft} busy={busy} onAnswer={answerGap} onDecide={(id, decision) => void decide([{ id, decision }])} />

          <ScoreCard draft={draft} progress={progress} busy={busy} onGenerate={() => void generate()}>
            <ResumeFormat workday={workday} onChange={setWorkdayChoice} checks={draft.checks} suggested={workdaySuggested} />
            <div className="row" style={{ gap: 8 }}>
              <FormatSelect value={format} onChange={setFormat} />
              <button className="btn btn-primary" onClick={() => void download()} disabled={busy}>
                {busy && <Spinner small />} Download resume
              </button>
            </div>
          </ScoreCard>

          <div className="card">
            <div className="row">
              <span className="muted">Want a fresh set? New suggestions and gaps replace these and your answers.</span>
              <span className="spacer" />
              {confirmRedo || !decided ? (
                <span className="row" style={{ gap: 8 }}>
                  <button className="btn btn-ghost" onClick={() => void start()} disabled={busy}>
                    Get new suggestions
                  </button>
                  {confirmRedo && (
                    <button className="btn btn-ghost" onClick={() => setConfirmRedo(false)}>
                      Cancel
                    </button>
                  )}
                </span>
              ) : (
                <button className="btn btn-ghost" onClick={() => setConfirmRedo(true)} disabled={busy}>
                  Get new suggestions…
                </button>
              )}
            </div>
          </div>
        </>
      )}

      {draft.status === 'ready' && !hasResult && (
        <div className="card">
          <p className="muted">Your resume already covers this job well: there's nothing worth changing.</p>
        </div>
      )}
    </>
  );
}

function SuggestionCard(props: { s: Suggestion; roles: DraftView['roles']; busy: boolean; onDecide: (u: Update) => void }) {
  const { s, busy, onDecide } = props;
  const [editing, setEditing] = useState(false);
  const [text, setText] = useState(finalText(s));
  const confirm = s.source === 'needs_confirmation';
  const isAdd = s.kind === 'add_skill' || s.kind === 'add_bullet';

  return (
    <div className="card" style={{ gap: 10, opacity: s.decision === 'rejected' ? 0.6 : 1 }}>
      <div className="row">
        <strong>{suggestionLabel(s, props.roles)}</strong>
        {confirm && <Badge tone="warning">Needs your confirmation</Badge>}
        <span className="spacer" />
        {s.decision === 'accepted' && (
          <Badge tone="success" dot>
            {s.editedText ? 'Accepted (edited)' : 'Accepted'}
          </Badge>
        )}
        {s.decision === 'rejected' && <Badge dot>Rejected</Badge>}
      </div>

      {s.before && (
        <p style={{ margin: 0 }} className="muted">
          <span className="visually-hidden">Before: </span>
          <del>{s.before}</del>
        </p>
      )}
      {editing ? (
        <label className="field">
          Your wording
          <textarea className="input" rows={s.kind === 'add_skill' || s.kind === 'headline' ? 1 : 3} value={text} onChange={(e) => setText(e.target.value)} maxLength={1000} autoFocus />
        </label>
      ) : (
        <p style={{ margin: 0, fontWeight: 500 }}>
          <span className="visually-hidden">{isAdd ? 'Add: ' : 'After: '}</span>
          {isAdd && '+ '}
          {finalText(s)}
        </p>
      )}

      <p className="muted" style={{ margin: 0, fontSize: 14 }}>
        {s.reason}
      </p>
      {confirm && s.question && (
        <p className="notice" style={{ margin: 0 }}>
          ⚠️ {s.question} Only accept this if it's true: your profile doesn't show it.
        </p>
      )}

      <div className="row" style={{ gap: 8 }}>
        {editing ? (
          <>
            <button
              className="btn btn-primary"
              disabled={busy || !text.trim()}
              onClick={() => {
                onDecide({ id: s.id, decision: 'accepted', editedText: text.trim() === s.after ? null : text });
                setEditing(false);
              }}
            >
              Save and accept
            </button>
            <button
              className="btn btn-ghost"
              onClick={() => {
                setText(finalText(s));
                setEditing(false);
              }}
            >
              Cancel
            </button>
          </>
        ) : (
          <>
            {s.decision !== 'accepted' && (
              <button className="btn btn-primary" disabled={busy} onClick={() => onDecide({ id: s.id, decision: 'accepted' })}>
                {confirm ? 'Yes, add it' : 'Accept'}
              </button>
            )}
            <button className="btn btn-ghost" disabled={busy} onClick={() => setEditing(true)}>
              Edit
            </button>
            {s.decision !== 'rejected' && (
              <button className="btn btn-ghost" disabled={busy} onClick={() => onDecide({ id: s.id, decision: 'rejected' })}>
                {confirm ? "No, I don't" : 'Reject'}
              </button>
            )}
            {s.decision !== 'pending' && (
              <button className="link-btn" disabled={busy} onClick={() => onDecide({ id: s.id, decision: 'pending', editedText: null })}>
                Undo
              </button>
            )}
          </>
        )}
      </div>
    </div>
  );
}
