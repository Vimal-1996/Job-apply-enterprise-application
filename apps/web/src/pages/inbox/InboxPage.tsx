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
import {
  CATEGORIES,
  dueLabel,
  filterCounts,
  filterEmails,
  FILTERS,
  groupByDay,
  isRead,
  MAX_DAYS_BACK,
  presetRange,
  PRESETS,
  rangeLabel,
  rangeProblem,
  rangeWindow,
  sender,
  shouldAutoSync,
  ymd,
  type DayRange,
  type InboxFilter,
  type RangePreset,
} from './inboxView';

/** The linked job's name (the email only carries its title and company). */
const linkedTitle = (j: NonNullable<InboxEmail['job']>) => j.title ?? 'Untitled job';

const message = (e: unknown, fallback: string) => (e instanceof ApiError || e instanceof Error ? e.message : fallback);

/**
 * Emails about the user's applications, from their Gmail, for a date range
 * they pick: Claude's summary of each, what to do and by when, which saved job
 * it's about (highlighted), and stage changes to accept. Dates not read from
 * Gmail before are read when chosen.
 */
export function InboxPage() {
  const token = useAuth().user?.access_token;
  const [view, setView] = useState<InboxView | null>(null);
  const [jobs, setJobs] = useState<JobSummary[]>([]);
  const [loadError, setLoadError] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [filter, setFilter] = useState<InboxFilter>('all');
  const [preset, setPreset] = useState<RangePreset>('30');
  /** The dates shown. */
  const [range, setRange] = useState<DayRange>(() => presetRange(30));
  const autoSynced = useRef(false);
  /** Date ranges already asked to be read this visit, so a partly read range isn't re-requested in a loop. */
  const requested = useRef(new Set<string>());

  const window_ = rangeWindow(range);
  const query = `/inbox?since=${encodeURIComponent(window_.since)}&until=${encodeURIComponent(window_.until)}`;

  const load = useCallback(async () => {
    try {
      const [v, j] = await Promise.all([apiGet<InboxView>(query, token), apiGet<JobSummary[]>('/jobs', token)]);
      setView(v);
      setJobs(j);
      setLoadError(false);
    } catch {
      setLoadError(true);
    }
  }, [query, token]);

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

  /** Reads new mail, or (with a window) the chosen dates; then shows the chosen dates. */
  const sync = useCallback(
    (w?: { since: string; until: string }) =>
      act(async () => {
        await apiPost<InboxView>('/inbox/sync', token, w);
        await load();
      }, 'Could not read your emails.'),
    [token, load],
  );

  const disconnect = () =>
    act(async () => {
      await apiDelete('/inbox/connection', token);
      requested.current.clear();
      await load();
    }, 'Could not disconnect Gmail.');

  const c = view?.connection ?? null;
  const ready = Boolean(view?.aiEnabled && c && c.status === 'connected' && c.syncStatus !== 'syncing');
  const unread = Boolean(c && !isRead(c.readRanges, window_));

  // Opening the page checks for new mail, unless that happened in the last few minutes;
  // choosing dates that haven't been read yet reads them.
  useEffect(() => {
    if (!view || !ready || busy) return;
    if (!autoSynced.current && shouldAutoSync(c)) {
      autoSynced.current = true;
      void sync();
      return;
    }
    const key = `${window_.since}|${window_.until}`;
    if (unread && !requested.current.has(key)) {
      requested.current.add(key);
      void sync(window_);
    }
  }, [view, ready, busy, unread, c, window_, sync]);

  const choosePreset = (p: RangePreset) => {
    setPreset(p);
    if (p !== 'custom') setRange(presetRange(Number(p)));
  };

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
        <p>Emails about your applications, from your Gmail, summarized. Ones about jobs you've saved here are highlighted and can move them along your Applications board.</p>
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
      ) : !c ? (
        <ConnectCard busy={busy} onConnect={() => void connect()} />
      ) : (
        <>
          <ConnectionBar c={c} busy={busy} aiEnabled={view.aiEnabled} onSync={() => void sync()} onReconnect={() => void connect()} onDisconnect={() => void disconnect()} />

          <DateBar
            preset={preset}
            range={range}
            onPreset={choosePreset}
            onCustom={(r) => setRange(r)}
            count={view.emails.length}
            syncing={syncing}
            unread={unread}
            canRead={ready && !busy}
            onReadRest={() => void sync(window_)}
          />

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

          {view.emails.length === 0 && !syncing && !unread && (
            <div className="card">
              <p className="muted" style={{ margin: 0 }}>
                No emails about your applications between {rangeLabel(range)}.
              </p>
            </div>
          )}
          {shown.length === 0 && view.emails.length > 0 && (
            <div className="card">
              <p className="muted" style={{ margin: 0 }}>
                Nothing here for these dates.
              </p>
            </div>
          )}

          {groupByDay(shown).map((g) => (
            <section key={g.key} className="inbox-day" aria-label={g.label}>
              <h3 className="inbox-day-head">{g.label}</h3>
              <ul className="inbox-list">
                {g.emails.map((e) => (
                  <EmailCard key={e.id} e={e} jobs={jobs} token={token} onChange={replace} />
                ))}
              </ul>
            </section>
          ))}
        </>
      )}
    </>
  );
}

/** Which dates to show: presets, or two picked dates. Says when dates are still being read from Gmail. */
function DateBar(props: {
  preset: RangePreset;
  range: DayRange;
  onPreset: (p: RangePreset) => void;
  onCustom: (r: DayRange) => void;
  count: number;
  syncing: boolean;
  unread: boolean;
  canRead: boolean;
  onReadRest: () => void;
}) {
  const [draft, setDraft] = useState<DayRange>(props.range);
  const problem = rangeProblem(draft);
  const today = new Date();
  const oldest = new Date(today.getFullYear(), today.getMonth(), today.getDate() - MAX_DAYS_BACK);

  // Picking "Pick dates" starts from what's shown.
  useEffect(() => {
    if (props.preset === 'custom') setDraft(props.range);
  }, [props.preset]);

  return (
    <div className="card" style={{ marginBottom: 12, gap: 10 }}>
      <div className="row" style={{ gap: 12 }}>
        <div className="tabs" role="tablist" aria-label="Dates">
          {PRESETS.map((p) => (
            <button key={p.value} role="tab" aria-selected={props.preset === p.value} className={`tab${props.preset === p.value ? ' active' : ''}`} onClick={() => props.onPreset(p.value)}>
              {p.label}
            </button>
          ))}
        </div>
        <span className="spacer" />
        <span className="muted">
          {rangeLabel(props.range)} · {props.count} email{props.count === 1 ? '' : 's'}
        </span>
      </div>

      {props.preset === 'custom' && (
        <form
          className="row"
          style={{ gap: 10, alignItems: 'flex-end' }}
          onSubmit={(e) => {
            e.preventDefault();
            if (!problem) props.onCustom(draft);
          }}
        >
          <label className="field" style={{ margin: 0 }}>
            From
            <input className="input" type="date" value={draft.from} min={ymd(oldest)} max={ymd(today)} onChange={(e) => setDraft({ ...draft, from: e.target.value })} />
          </label>
          <label className="field" style={{ margin: 0 }}>
            To
            <input className="input" type="date" value={draft.to} min={ymd(oldest)} max={ymd(today)} onChange={(e) => setDraft({ ...draft, to: e.target.value })} />
          </label>
          <button className="btn btn-primary" type="submit" disabled={Boolean(problem)}>
            Show emails
          </button>
          {problem && draft.from && draft.to && <span className="notice error">{problem}</span>}
        </form>
      )}

      {props.syncing ? (
        <span className="row" role="status" aria-live="polite" style={{ gap: 6 }}>
          <Spinner small /> Reading your emails for these dates from Gmail…
        </span>
      ) : (
        props.unread && (
          <span className="row" style={{ gap: 8 }}>
            <span className="muted">Some of these dates haven't been read from Gmail yet.</span>
            <button className="btn btn-ghost" onClick={props.onReadRest} disabled={!props.canRead}>
              Read these dates
            </button>
          </span>
        )
      )}
    </div>
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
