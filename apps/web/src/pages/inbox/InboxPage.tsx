import { useCallback, useEffect, useRef, useState } from 'react';
import { useAuth } from 'react-oidc-context';
import { Link } from 'react-router-dom';
import { ApiError, apiDelete, apiGet, apiPatch, apiPost } from '../../api/client';
import type { GmailConnection, InboxEmail, InboxView, JobSummary } from '../../api/types';
import { Badge, Spinner } from '../../components/ui';
import { formatDateTime } from '../admin/format';
import { statusInfo } from '../jobs/applicationView';
import { POLL_MS } from '../jobs/JobsPage';
import { jobTitle } from '../jobs/jobView';
import { CATEGORIES, dueLabel, filterCounts, filterEmails, FILTERS, sender, shouldAutoSync, type InboxFilter } from './inboxView';

/** The linked job's name (the email only carries its title and company). */
const linkedTitle = (j: NonNullable<InboxEmail['job']>) => j.title ?? 'Untitled job';

const message = (e: unknown, fallback: string) => (e instanceof ApiError || e instanceof Error ? e.message : fallback);

/**
 * Job emails from the user's Gmail: Claude's summary of each, what to do and
 * by when, which saved job it's about (highlighted), and stage changes to accept.
 */
export function InboxPage() {
  const token = useAuth().user?.access_token;
  const [view, setView] = useState<InboxView | null>(null);
  const [jobs, setJobs] = useState<JobSummary[]>([]);
  const [loadError, setLoadError] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [filter, setFilter] = useState<InboxFilter>('all');
  const autoSynced = useRef(false);

  const load = useCallback(async () => {
    try {
      const [v, j] = await Promise.all([apiGet<InboxView>('/inbox', token), apiGet<JobSummary[]>('/jobs', token)]);
      setView(v);
      setJobs(j);
      setLoadError(false);
    } catch {
      setLoadError(true);
    }
  }, [token]);

  useEffect(() => {
    void load();
  }, [load]);

  const syncing = view?.connection?.syncStatus === 'syncing';
  useEffect(() => {
    if (!syncing) return;
    const t = window.setInterval(() => void load(), POLL_MS);
    return () => window.clearInterval(t);
  }, [syncing, load]);

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

  const connect = () =>
    act(async () => {
      const { url } = await apiPost<{ url: string }>('/inbox/connect', token);
      window.location.assign(url);
    }, 'Could not start connecting Gmail.');

  const sync = useCallback(
    () =>
      act(async () => {
        setView(await apiPost<InboxView>('/inbox/sync', token));
      }, 'Could not check for new emails.'),
    [token],
  );

  const disconnect = () =>
    act(async () => {
      await apiDelete('/inbox/connection', token);
      await load();
    }, 'Could not disconnect Gmail.');

  // Opening the page checks for new mail, unless that happened in the last few minutes.
  useEffect(() => {
    if (!view || autoSynced.current || !view.aiEnabled || !shouldAutoSync(view.connection)) return;
    autoSynced.current = true;
    void sync();
  }, [view, sync]);

  const replace = (e: InboxEmail) => setView((v) => (v ? { ...v, emails: v.emails.map((x) => (x.id === e.id ? e : x)) } : v));

  if (loadError) return <div className="banner">⚠️ Could not load your inbox. Check that the API is running, then refresh.</div>;
  if (!view)
    return (
      <div className="center" style={{ minHeight: 160 }}>
        <Spinner />
      </div>
    );

  const shown = filterEmails(view.emails, filter);
  const counts = filterCounts(view.emails);

  return (
    <>
      <header className="page-head">
        <h1>Inbox</h1>
        <p>Job emails from your Gmail, summarized. Emails about jobs you've saved here are highlighted and can move them along your Applications board.</p>
      </header>

      {error && (
        <p role="alert" className="notice error" style={{ marginBottom: 12 }}>
          {error}
        </p>
      )}

      {!view.enabled ? (
        <div className="card">
          <p className="muted" style={{ margin: 0 }}>
            Connecting Gmail isn't set up on this server yet (it needs a Google OAuth client).
          </p>
        </div>
      ) : !view.connection ? (
        <ConnectCard busy={busy} onConnect={() => void connect()} />
      ) : (
        <>
          <ConnectionBar c={view.connection} busy={busy} aiEnabled={view.aiEnabled} onSync={() => void sync()} onReconnect={() => void connect()} onDisconnect={() => void disconnect()} />

          {view.emails.length > 0 && (
            <div className="row" style={{ margin: '4px 0 12px' }}>
              <div className="tabs" role="tablist" aria-label="Filter emails">
                {FILTERS.map((f) => (
                  <button key={f.value} role="tab" aria-selected={filter === f.value} className={`tab${filter === f.value ? ' active' : ''}`} onClick={() => setFilter(f.value)}>
                    {f.label} ({counts[f.value]})
                  </button>
                ))}
              </div>
            </div>
          )}

          {view.emails.length === 0 && !syncing && view.connection.lastSyncedAt && (
            <div className="card">
              <p className="muted" style={{ margin: 0 }}>
                No job emails found in the last 60 days.
              </p>
            </div>
          )}
          {shown.length === 0 && view.emails.length > 0 && (
            <div className="card">
              <p className="muted" style={{ margin: 0 }}>
                Nothing here right now.
              </p>
            </div>
          )}

          <ul className="inbox-list">
            {shown.map((e) => (
              <EmailCard key={e.id} e={e} jobs={jobs} token={token} onChange={replace} />
            ))}
          </ul>
        </>
      )}
    </>
  );
}

function ConnectCard({ busy, onConnect }: { busy: boolean; onConnect: () => void }) {
  return (
    <div className="card">
      <h3>Connect your Gmail</h3>
      <p style={{ margin: 0 }}>We'll look for job emails from the last 60 days (application updates, interviews, assessments, offers, recruiters) and summarize each one.</p>
      <ul className="muted" style={{ margin: 0, paddingLeft: 20 }}>
        <li>Only emails that look job-related are read, and only their summaries are saved, never the emails themselves.</li>
        <li>Nothing is ever sent from your account without you clicking Send.</li>
        <li>Disconnect at any time: that deletes everything saved here and revokes our access.</li>
      </ul>
      <div>
        <button className="btn btn-primary" onClick={onConnect} disabled={busy}>
          {busy && <Spinner small />} Connect Gmail
        </button>
      </div>
      <p className="muted" style={{ margin: 0, fontSize: 13 }}>
        Google will say this app is unverified while it's in testing. Choose Continue, and allow reading and sending email.
      </p>
    </div>
  );
}

function ConnectionBar(props: {
  c: GmailConnection;
  busy: boolean;
  aiEnabled: boolean;
  onSync: () => void;
  onReconnect: () => void;
  onDisconnect: () => void;
}) {
  const { c, busy } = props;
  const [confirm, setConfirm] = useState(false);
  const syncing = c.syncStatus === 'syncing';
  return (
    <div className="card" style={{ marginBottom: 12 }}>
      {c.status === 'expired' && (
        <div className="banner" role="alert" style={{ display: 'flex', gap: 12, alignItems: 'center', flexWrap: 'wrap' }}>
          <span>⚠️ Google needs you to connect Gmail again (it ends test-mode connections after 7 days).</span>
          <button className="btn btn-primary" onClick={props.onReconnect} disabled={busy}>
            Reconnect Gmail
          </button>
        </div>
      )}
      <div className="row">
        <span>
          Connected as <strong>{c.email}</strong>
        </span>
        <span className="muted">· {c.lastSyncedAt ? `checked ${formatDateTime(c.lastSyncedAt)}` : 'not checked yet'}</span>
        <span className="spacer" />
        {syncing ? (
          <span className="row" role="status" aria-live="polite" style={{ gap: 6 }}>
            <Spinner small /> Reading new job emails…
          </span>
        ) : (
          c.status === 'connected' &&
          props.aiEnabled && (
            <button className="btn btn-ghost" onClick={props.onSync} disabled={busy}>
              Check for new emails
            </button>
          )
        )}
        {confirm ? (
          <span className="row" style={{ gap: 8 }}>
            <button className="btn btn-danger" onClick={props.onDisconnect} disabled={busy}>
              Disconnect and delete summaries
            </button>
            <button className="btn btn-ghost" onClick={() => setConfirm(false)}>
              Cancel
            </button>
          </span>
        ) : (
          <button className="link-btn" onClick={() => setConfirm(true)} disabled={busy || syncing}>
            Disconnect
          </button>
        )}
      </div>
      {!props.aiEnabled && <p className="muted" style={{ margin: 0 }}>Reading emails with AI isn't set up on this server.</p>}
      {c.syncError && (
        <p role="alert" className={`notice${c.syncStatus === 'failed' ? ' error' : ''}`} style={{ margin: 0 }}>
          {c.syncError}
        </p>
      )}
    </div>
  );
}

function EmailCard(props: { e: InboxEmail; jobs: JobSummary[]; token: string | undefined; onChange: (e: InboxEmail) => void }) {
  const { e, token } = props;
  const [body, setBody] = useState<string | null>(null);
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const cat = CATEGORIES[e.category];
  const due = dueLabel(e.actionDue);
  const base = `/inbox/emails/${encodeURIComponent(e.id)}`;

  const run = async (fn: () => Promise<void>, fallback: string) => {
    setBusy(true);
    setError(null);
    try {
      await fn();
    } catch (err) {
      setError(message(err, fallback));
    } finally {
      setBusy(false);
    }
  };

  const toggleBody = () => {
    if (open) return setOpen(false);
    setOpen(true);
    if (body === null) void run(async () => setBody((await apiGet<{ text: string }>(`${base}/body`, token)).text), 'Could not load this email.');
  };

  return (
    <li className={`card inbox-card${e.job ? ' linked' : ''}`}>
      <div className="row" style={{ gap: 8 }}>
        <Badge tone={cat.tone}>{cat.label}</Badge>
        <strong className="inbox-subject">{e.subject}</strong>
        <span className="spacer" />
        <span className="muted" style={{ fontSize: 13 }}>
          {formatDateTime(e.receivedAt)}
        </span>
      </div>
      <span className="muted" style={{ fontSize: 13 }}>
        From {sender(e)}
        {e.fromName && <> &lt;{e.fromAddress}&gt;</>}
      </span>

      {e.summary && <p style={{ margin: 0 }}>{e.summary}</p>}
      {e.action && (
        <p style={{ margin: 0 }}>
          <strong>To do:</strong> {e.action}{' '}
          {due && (
            <Badge tone={due.overdue ? 'danger' : 'warning'} dot>
              {due.text}
            </Badge>
          )}
        </p>
      )}

      {e.job && (
        <p style={{ margin: 0 }} className="inbox-job">
          About your job <Link to={`/jobs/${e.job.id}`}>{linkedTitle(e.job)}{e.job.company ? ` at ${e.job.company}` : ''}</Link> ·{' '}
          <Badge tone={statusInfo(e.job.applicationStatus).tone}>{statusInfo(e.job.applicationStatus).label}</Badge>
          {e.linkSource === 'thread' && <span className="muted"> (same email thread)</span>}
        </p>
      )}

      {e.suggestion && e.job && (
        <div className="notice inbox-suggestion" role="status">
          <span>
            This looks like it moves <strong>{linkedTitle(e.job)}</strong> to <strong>{statusInfo(e.suggestion.status).label}</strong>.
          </span>
          <span className="row" style={{ gap: 8 }}>
            <button
              className="btn btn-primary"
              disabled={busy}
              onClick={() => void run(async () => props.onChange(await apiPost<InboxEmail>(`${base}/suggestion`, token, { accept: true })), 'Could not move the job.')}
            >
              Move to {statusInfo(e.suggestion.status).label}
            </button>
            <button
              className="btn btn-ghost"
              disabled={busy}
              onClick={() => void run(async () => props.onChange(await apiPost<InboxEmail>(`${base}/suggestion`, token, { accept: false })), 'Could not dismiss this.')}
            >
              Dismiss
            </button>
          </span>
        </div>
      )}

      {error && (
        <p role="alert" className="notice error" style={{ margin: 0 }}>
          {error}
        </p>
      )}

      {open && (
        <div className="inbox-body">
          {body === null ? <Spinner small /> : <pre>{body || '(This email has no text.)'}</pre>}
        </div>
      )}

      <div className="row" style={{ gap: 12 }}>
        <button className="link-btn" onClick={toggleBody} aria-expanded={open}>
          {open ? 'Hide email' : 'Show email'}
        </button>
        <a href={e.threadUrl} target="_blank" rel="noreferrer">
          Open in Gmail ↗
        </a>
        <span className="spacer" />
        <label className="row" style={{ gap: 6, fontSize: 13 }}>
          <span className="muted">Job</span>
          <select
            className="input"
            style={{ width: 'auto', maxWidth: 260, minHeight: 30, padding: '4px 8px', fontSize: 13 }}
            value={e.job?.id ?? ''}
            disabled={busy}
            onChange={(ev) =>
              void run(async () => props.onChange(await apiPatch<InboxEmail>(base, token, { jobId: ev.target.value || null })), 'Could not change the link.')
            }
          >
            <option value="">Not linked</option>
            {props.jobs.map((j) => (
              <option key={j.id} value={j.id}>
                {jobTitle(j)}
                {j.company ? ` at ${j.company}` : ''}
              </option>
            ))}
          </select>
        </label>
      </div>
    </li>
  );
}
