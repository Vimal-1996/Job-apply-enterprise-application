import { useEffect, useState } from 'react';
import { useAuth } from 'react-oidc-context';
import { Link } from 'react-router-dom';
import { apiGet } from '../../api/client';
import type { JobSummary } from '../../api/types';
import { Spinner } from '../../components/ui';
import { formatDate } from '../admin/format';
import { groupByStatus, pipelineCounts } from './applicationView';
import { MatchBadge } from './JobsPage';
import { jobTitle } from './jobView';

/** Where the user is with each job, grouped by stage. */
export function ApplicationsPage() {
  const token = useAuth().user?.access_token;
  const [jobs, setJobs] = useState<JobSummary[] | null>(null);
  const [loadError, setLoadError] = useState(false);

  useEffect(() => {
    apiGet<JobSummary[]>('/jobs', token)
      .then(setJobs)
      .catch(() => setLoadError(true));
  }, [token]);

  if (loadError) return <div className="banner">⚠️ Could not load your applications. Check that the API is running, then refresh.</div>;
  if (!jobs)
    return (
      <div className="center" style={{ minHeight: 160 }}>
        <Spinner />
      </div>
    );

  const c = pipelineCounts(jobs);
  const stats = [
    { label: 'Applied', value: c.applied },
    { label: 'In progress', value: c.active },
    { label: 'Interviewing', value: c.interviewing },
    { label: 'Offers', value: c.offers },
  ];

  return (
    <>
      <header className="page-head">
        <h1>Applications</h1>
        <p>Where you are with each job. Change a job's stage on its page as things move along.</p>
      </header>

      {jobs.length === 0 ? (
        <div className="card">
          <p className="muted" style={{ margin: 0 }}>
            No jobs yet. <Link to="/jobs">Add a job</Link> to start tracking your applications.
          </p>
        </div>
      ) : (
        <>
          <div className="grid" style={{ marginBottom: 16 }}>
            {stats.map((s) => (
              <div key={s.label} className="card stat">
                <div className="value">{s.value}</div>
                <div className="label">{s.label}</div>
              </div>
            ))}
          </div>

          <div className="grid" style={{ gridTemplateColumns: 'repeat(auto-fit, minmax(min(320px, 100%), 1fr))' }}>
            {groupByStatus(jobs)
              .filter((g) => !g.closed || g.jobs.length > 0)
              .map((g) => (
                <section key={g.value} className="card" aria-label={g.label}>
                  <div className="row">
                    <h3 style={{ margin: 0 }}>{g.label}</h3>
                    <span className="muted">{g.jobs.length}</span>
                  </div>
                  {g.jobs.length === 0 ? (
                    <p className="muted" style={{ margin: 0 }}>
                      None yet.
                    </p>
                  ) : (
                    <ul className="mini-list">
                      {g.jobs.map((j) => (
                        <li key={j.id}>
                          <div style={{ display: 'grid', gap: 2, minWidth: 0, flex: 1 }}>
                            <Link to={`/jobs/${j.id}`} className="cell-main" style={{ maxWidth: '100%' }}>
                              {jobTitle(j)}
                            </Link>
                            <span className="cell-sub">
                              {[j.company, formatDate(j.statusChangedAt ?? j.createdAt)].filter(Boolean).join(' · ')}
                            </span>
                          </div>
                          <MatchBadge job={j} />
                        </li>
                      ))}
                    </ul>
                  )}
                </section>
              ))}
          </div>
        </>
      )}
    </>
  );
}
