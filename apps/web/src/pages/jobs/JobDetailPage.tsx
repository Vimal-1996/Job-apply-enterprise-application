import { useCallback, useEffect, useState } from 'react';
import { useAuth } from 'react-oidc-context';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { ApiError, apiDelete, apiGet, apiPatch, apiPost } from '../../api/client';
import type { ApplicationStatus, JobDetails, JobMatch, JobView } from '../../api/types';
import { Badge, Spinner } from '../../components/ui';
import { formatDateTime } from '../admin/format';
import { STATUSES, statusInfo } from './applicationView';
import { MatchBadge, POLL_MS } from './JobsPage';
import { jobTitle, safeUrl, sourceLabel } from './jobView';

const message = (e: unknown, fallback: string) => (e instanceof ApiError || e instanceof Error ? e.message : fallback);

/** One job: what Claude read from the posting and how well the user matches it. */
export function JobDetailPage() {
  const { id = '' } = useParams();
  const token = useAuth().user?.access_token;
  const navigate = useNavigate();
  const [job, setJob] = useState<JobView | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      setJob(await apiGet<JobView>(`/jobs/${encodeURIComponent(id)}`, token));
      setLoadError(null);
    } catch (e) {
      setLoadError(e instanceof ApiError && (e.status === 404 || e.status === 400) ? 'This job was not found.' : 'Could not load this job.');
    }
  }, [id, token]);

  useEffect(() => {
    void load();
  }, [load]);

  const matching = job?.matchStatus === 'matching';
  useEffect(() => {
    if (!matching) return;
    const t = window.setInterval(() => void load(), POLL_MS);
    return () => window.clearInterval(t);
  }, [matching, load]);

  const rematch = async () => {
    setBusy(true);
    setError(null);
    try {
      setJob(await apiPost<JobView>(`/jobs/${encodeURIComponent(id)}/match`, token));
    } catch (e) {
      setError(message(e, 'Could not start matching this job.'));
    } finally {
      setBusy(false);
    }
  };

  const remove = async () => {
    setBusy(true);
    setError(null);
    try {
      await apiDelete(`/jobs/${encodeURIComponent(id)}`, token);
      navigate('/jobs');
    } catch (e) {
      setError(message(e, 'Could not delete this job.'));
      setBusy(false);
      setConfirmDelete(false);
    }
  };

  if (loadError)
    return (
      <div className="card">
        <p className="notice error" role="alert">
          {loadError}
        </p>
        <Link to="/jobs">← Back to jobs</Link>
      </div>
    );
  if (!job)
    return (
      <div className="center" style={{ minHeight: 160 }}>
        <Spinner />
      </div>
    );

  const url = safeUrl(job.url);
  const applyUrl = safeUrl(job.details?.applyUrl ?? null);

  return (
    <>
      <p style={{ margin: '0 0 12px' }}>
        <Link to="/jobs">← Jobs</Link>
      </p>
      <header className="page-head">
        <h1>{jobTitle(job)}</h1>
        <p>
          {[job.company, job.location].filter(Boolean).join(' · ')}
          {(job.company || job.location) && ' · '}
          Added {formatDateTime(job.createdAt)} ({sourceLabel(job.source)})
        </p>
      </header>

      <div className="card">
        <div className="row">
          <h3>Your match</h3>
          <MatchBadge job={job} />
          <span className="spacer" />
          <div className="row" style={{ gap: 8 }}>
            {url && (
              <a className="btn btn-ghost" href={url} target="_blank" rel="noopener noreferrer">
                View posting
              </a>
            )}
            {applyUrl && (
              <a className="btn btn-ghost" href={applyUrl} target="_blank" rel="noopener noreferrer">
                Apply on company site
              </a>
            )}
            {job.details && (
              <Link className="btn btn-primary" to={`/jobs/${job.id}/resume`}>
                Tailor my resume
              </Link>
            )}
            {!matching && (
              <button className="btn btn-ghost" onClick={() => void rematch()} disabled={busy}>
                Match again
              </button>
            )}
            {confirmDelete ? (
              <span className="row" style={{ gap: 8 }} role="group" aria-label="Delete this job?">
                <button className="btn btn-danger" onClick={() => void remove()} disabled={busy} autoFocus>
                  {busy && <Spinner small />} Delete
                </button>
                <button className="btn btn-ghost" onClick={() => setConfirmDelete(false)}>
                  Cancel
                </button>
              </span>
            ) : (
              <button className="btn btn-danger-ghost" onClick={() => setConfirmDelete(true)} disabled={busy}>
                Delete
              </button>
            )}
          </div>
        </div>

        {job.matchedAt && <p className="muted" style={{ margin: 0 }}>Matched {formatDateTime(job.matchedAt)}</p>}

        {error && (
          <p role="alert" className="notice error">
            {error}
          </p>
        )}
        {job.profileChanged && !matching && job.match && (
          <p role="status" className="notice">
            Your profile changed after this job was matched. Match it again to bring the result up to date.
          </p>
        )}
        {job.matchStatus === 'failed' && job.matchError && (
          <p role="alert" className="notice error">
            {job.matchError}
            {job.match && ' The previous result is shown below.'}
          </p>
        )}

        {matching && !job.match ? (
          <div className="row" role="status" aria-live="polite">
            <Spinner small /> Reading the job and comparing it with your profile. This usually takes under a minute.
          </div>
        ) : job.match ? (
          <MatchDetails m={job.match} />
        ) : null}
      </div>

      <ApplicationCard job={job} token={token} onSaved={setJob} />

      <div className="card profile-details">
        <h3 style={{ margin: 0 }}>About the job</h3>
        {job.details ? (
          <JobFacts d={job.details} />
        ) : (
          !matching && <p className="muted">The key points of this job appear here once it has been matched.</p>
        )}
        <OriginalPosting text={job.description} />
      </div>
    </>
  );
}

/** Where the user is with this job: stage, private notes and the timeline of stage changes. */
function ApplicationCard({ job, token, onSaved }: { job: JobView; token: string | undefined; onSaved: (j: JobView) => void }) {
  const [notes, setNotes] = useState(job.notes ?? '');
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState<{ ok: boolean; text: string } | null>(null);

  const save = async (update: { status?: ApplicationStatus; notes?: string | null }, done: string) => {
    setBusy(true);
    setNotice(null);
    try {
      const saved = await apiPatch<JobView>(`/jobs/${encodeURIComponent(job.id)}/application`, token, update);
      onSaved(saved);
      setNotes(saved.notes ?? '');
      setNotice({ ok: true, text: done });
    } catch (e) {
      setNotice({ ok: false, text: message(e, 'Could not save.') });
    } finally {
      setBusy(false);
    }
  };

  const current = statusInfo(job.applicationStatus);
  const notesChanged = notes.trim() !== (job.notes ?? '');

  return (
    <div className="card">
      <div className="row">
        <h3 style={{ margin: 0 }}>Application</h3>
        <Badge tone={current.tone} dot>
          {current.label}
        </Badge>
        <span className="spacer" />
        <label className="row" style={{ gap: 8 }}>
          <span className="muted">Stage</span>
          <select
            className="input"
            style={{ width: 'auto' }}
            value={job.applicationStatus}
            disabled={busy}
            onChange={(e) => {
              const status = e.target.value as ApplicationStatus;
              void save({ status }, `Moved to ${statusInfo(status).label}.`);
            }}
          >
            {STATUSES.map((s) => (
              <option key={s.value} value={s.value}>
                {s.label}
              </option>
            ))}
          </select>
        </label>
      </div>

      <ol className="muted" style={{ margin: 0, paddingLeft: 20, display: 'grid', gap: 2 }} aria-label="Timeline">
        {job.timeline.map((t, i) => (
          <li key={i}>
            {statusInfo(t.status).label} · {formatDateTime(t.at)}
          </li>
        ))}
      </ol>

      <label className="field">
        Notes <span className="hint muted">Only you can see these: contacts, interview dates, what you sent.</span>
        <textarea className="input" rows={3} value={notes} maxLength={5000} onChange={(e) => setNotes(e.target.value)} />
      </label>
      <div className="row" style={{ gap: 8 }}>
        <button className="btn btn-ghost" disabled={busy || !notesChanged} onClick={() => void save({ notes: notes.trim() || null }, 'Notes saved.')}>
          {busy && <Spinner small />} Save notes
        </button>
        {notice && (
          <span role={notice.ok ? 'status' : 'alert'} className={notice.ok ? 'notice ok' : 'notice error'}>
            {notice.text}
          </span>
        )}
      </div>
    </div>
  );
}

function MatchDetails({ m }: { m: JobMatch }) {
  const list = (title: string, xs: string[]) =>
    xs.length > 0 && (
      <section>
        <h4>{title}</h4>
        <ul className="entries" style={{ gap: 6 }}>
          {xs.map((x, i) => (
            <li key={i}>{x}</li>
          ))}
        </ul>
      </section>
    );
  return (
    <div className="profile-details">
      <p>{m.summary}</p>
      {list('Dealbreakers', m.dealbreakers)}
      {list('Strengths', m.strengths)}
      {list('Gaps', m.gaps)}
    </div>
  );
}

const SPONSORSHIP = { offered: 'Offered', not_offered: 'Not offered', not_stated: null } as const;
const WORK_MODE = { remote: 'Remote', hybrid: 'Hybrid', onsite: 'On-site' } as const;

/** The full pasted text, hidden unless asked for: the digest above covers what matters. */
function OriginalPosting({ text }: { text: string }) {
  const [open, setOpen] = useState(false);
  return (
    <section>
      <button className="link-btn" onClick={() => setOpen((o) => !o)} aria-expanded={open}>
        {open ? 'Hide original posting' : 'Show original posting'}
      </button>
      {open && <p style={{ whiteSpace: 'pre-wrap', overflowWrap: 'anywhere', marginTop: 8 }}>{text}</p>}
    </section>
  );
}

function JobFacts({ d }: { d: JobDetails }) {
  const rows: [string, string | null][] = [
    ['Work arrangement', d.workMode ? WORK_MODE[d.workMode] : null],
    ['Employment', d.employmentType],
    ['Seniority', d.seniority],
    ['Experience', d.yearsRequired == null ? null : `${d.yearsRequired}+ years`],
    ['Salary', d.salary],
    ['Visa sponsorship', SPONSORSHIP[d.visaSponsorship]],
  ];
  const points = (title: string, xs: string[] | undefined) =>
    !!xs?.length && (
      <section>
        <h4>{title}</h4>
        <ul className="entries" style={{ gap: 6, listStyle: 'disc', paddingLeft: 20 }}>
          {xs.map((x, i) => (
            <li key={i}>{x}</li>
          ))}
        </ul>
      </section>
    );
  const chips = (title: string, xs: string[]) =>
    xs.length > 0 && (
      <section>
        <h4>{title}</h4>
        <ul className="chips">
          {xs.map((s) => (
            <li key={s}>{s}</li>
          ))}
        </ul>
      </section>
    );
  return (
    <>
      {d.overview && <p>{d.overview}</p>}
      <dl className="kv">
        {rows
          .filter(([, v]) => v)
          .map(([k, v]) => (
            <div key={k} style={{ display: 'contents' }}>
              <dt>{k}</dt>
              <dd>{v}</dd>
            </div>
          ))}
      </dl>
      {chips('Required', d.requiredSkills)}
      {chips('Nice to have', d.niceToHaveSkills)}
      {points('What you would do', d.responsibilities)}
      {points('Benefits', d.benefits)}
    </>
  );
}
