import { useCallback, useEffect, useState, type FormEvent } from 'react';
import { useAuth } from 'react-oidc-context';
import { useNavigate } from 'react-router-dom';
import { ApiError, apiGet, apiPost } from '../../api/client';
import type { JobSummary, JobView } from '../../api/types';
import { Badge, Spinner } from '../../components/ui';
import { formatDate } from '../admin/format';
import { jobTitle, newJobRequest, sortJobs, sourceLabel, verdictLabel } from './jobView';

/** How often to check while a job is being matched. */
export const POLL_MS = 3000;

/** Jobs the user has added, best matches first, and a form to add another. */
export function JobsPage() {
  const token = useAuth().user?.access_token;
  const [jobs, setJobs] = useState<JobSummary[] | null>(null);
  const [loadError, setLoadError] = useState(false);

  const load = useCallback(async () => {
    try {
      setJobs(await apiGet<JobSummary[]>('/jobs', token));
      setLoadError(false);
    } catch {
      setLoadError(true);
    }
  }, [token]);

  useEffect(() => {
    void load();
  }, [load]);

  const matching = jobs?.some((j) => j.matchStatus === 'matching') ?? false;
  useEffect(() => {
    if (!matching) return;
    const t = window.setInterval(() => void load(), POLL_MS);
    return () => window.clearInterval(t);
  }, [matching, load]);

  return (
    <>
      <header className="page-head">
        <h1>Jobs</h1>
        <p>Paste a job you found on LinkedIn, Indeed or a company's site, and we'll check how well it matches your profile.</p>
      </header>

      <AddJobCard token={token} onAdded={(j) => setJobs((js) => [j, ...(js ?? []).filter((x) => x.id !== j.id)])} />

      <div className="card" style={{ padding: 0 }}>
        {loadError ? (
          <div className="table-state" style={{ color: 'var(--danger)' }}>
            Could not load your jobs. Check that the API is running, then refresh.
          </div>
        ) : !jobs ? (
          <div className="table-state">
            <Spinner />
          </div>
        ) : jobs.length === 0 ? (
          <div className="table-state muted">No jobs yet. Add one above to see how well you match it.</div>
        ) : (
          <JobTable jobs={sortJobs(jobs)} />
        )}
      </div>
    </>
  );
}

function AddJobCard({ token, onAdded }: { token: string | undefined; onAdded: (j: JobSummary) => void }) {
  const navigate = useNavigate();
  const [link, setLink] = useState('');
  const [description, setDescription] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    const r = newJobRequest(link, description);
    if ('error' in r) {
      setError(r.error);
      return;
    }
    setBusy(true);
    setError(null);
    try {
      const job = await apiPost<JobView>('/jobs', token, r.body);
      setLink('');
      setDescription('');
      onAdded(job);
      navigate(`/jobs/${job.id}`);
    } catch (err) {
      setError(err instanceof ApiError || err instanceof Error ? err.message : 'Could not add this job.');
    } finally {
      setBusy(false);
    }
  };

  return (
    <form className="card profile-form" onSubmit={(e) => void submit(e)} noValidate>
      <h3 style={{ margin: 0 }}>Add a job</h3>
      <label className="field">
        Job link <span className="hint muted">Optional. A LinkedIn or Indeed link or job ID, or the company's job page.</span>
        <input
          className="input"
          value={link}
          onChange={(e) => setLink(e.target.value)}
          placeholder="https://www.linkedin.com/jobs/view/…"
          autoComplete="off"
          maxLength={2000}
        />
      </label>
      <label className="field">
        Job description
        <span className="hint muted">
          Copy the whole posting from the job page and paste it here. We never visit LinkedIn or Indeed for you.
        </span>
        <textarea
          className="input"
          rows={8}
          value={description}
          onChange={(e) => setDescription(e.target.value)}
          placeholder="About the job…"
        />
      </label>
      {error && (
        <p role="alert" className="notice error">
          {error}
        </p>
      )}
      <div className="row form-actions">
        <button className="btn btn-primary" type="submit" disabled={busy}>
          {busy && <Spinner small />} Check my match
        </button>
        <span className="muted" style={{ fontSize: 13 }}>
          Usually takes under a minute.
        </span>
      </div>
    </form>
  );
}

function JobTable({ jobs }: { jobs: JobSummary[] }) {
  const navigate = useNavigate();
  const open = (id: string) => navigate(`/jobs/${id}`);
  return (
    <div className="table-wrap">
      <table className="table">
        <thead>
          <tr>
            <th>Job</th>
            <th>Match</th>
            <th>Added</th>
          </tr>
        </thead>
        <tbody>
          {jobs.map((j) => (
            <tr
              key={j.id}
              tabIndex={0}
              onClick={() => open(j.id)}
              onKeyDown={(e) => {
                if (e.key === 'Enter' || e.key === ' ') {
                  e.preventDefault();
                  open(j.id);
                }
              }}
            >
              <td>
                <div className="cell-main">{jobTitle(j)}</div>
                <div className="cell-sub">{[j.company, j.location, sourceLabel(j.source)].filter(Boolean).join(' · ')}</div>
              </td>
              <td>
                <MatchBadge job={j} />
              </td>
              <td className="muted" style={{ whiteSpace: 'nowrap' }}>
                {formatDate(j.createdAt)}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

export function MatchBadge({ job }: { job: Pick<JobSummary, 'matchStatus' | 'score' | 'verdict'> }) {
  if (job.matchStatus === 'matching')
    return (
      <Badge tone="primary" dot>
        Matching…
      </Badge>
    );
  if (job.matchStatus === 'failed' && job.score == null)
    return (
      <Badge tone="danger" dot>
        Couldn't match
      </Badge>
    );
  if (job.score == null || !job.verdict) return null;
  const v = verdictLabel(job.verdict);
  return (
    <Badge tone={v.tone} dot>
      {job.score} · {v.label}
    </Badge>
  );
}
