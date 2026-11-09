import { useCallback, useEffect, useState, type ReactNode } from 'react';
import { useAuth } from 'react-oidc-context';
import { Link } from 'react-router-dom';
import { ApiError, apiGet, apiPost, apiPut } from '../../api/client';
import type { CandidateProfile, JobPreferences, ProfileView, WorkMode } from '../../api/types';
import { Badge, Spinner } from '../../components/ui';
import { formatDateTime } from '../admin/format';
import {
  EMPTY_EDUCATION,
  EMPTY_WORK,
  fromDraft,
  fromPreferencesDraft,
  toDraft,
  toPreferencesDraft,
  type PreferencesDraft,
  type ProfileDraft,
} from './profileForm';

type Notice = { ok: boolean; text: string } | null;

const message = (e: unknown, fallback: string) => (e instanceof ApiError || e instanceof Error ? e.message : fallback);

/** How often to check while Claude reads the resume. */
const POLL_MS = 3000;

/** The candidate profile read from the user's resume, which they can correct, plus their job preferences. */
export function ProfilePage() {
  const token = useAuth().user?.access_token;
  const [view, setView] = useState<ProfileView | null>(null);
  const [loadError, setLoadError] = useState(false);
  const [draft, setDraft] = useState<ProfileDraft | null>(null);
  const [busy, setBusy] = useState(false);
  const [confirmReread, setConfirmReread] = useState(false);
  const [notice, setNotice] = useState<Notice>(null);

  const load = useCallback(async () => {
    try {
      setView(await apiGet<ProfileView>('/profile', token));
      setLoadError(false);
    } catch {
      setLoadError(true);
    }
  }, [token]);

  useEffect(() => {
    void load();
  }, [load]);

  // While the resume is being read, check again every few seconds.
  const parsing = view?.status === 'parsing';
  useEffect(() => {
    if (!parsing) return;
    const t = window.setInterval(() => void load(), POLL_MS);
    return () => window.clearInterval(t);
  }, [parsing, load]);

  const reread = async () => {
    setBusy(true);
    setNotice(null);
    try {
      setView(await apiPost<ProfileView>('/profile/parse', token));
      setDraft(null);
    } catch (e) {
      setNotice({ ok: false, text: message(e, 'Could not start reading your resume.') });
    } finally {
      setBusy(false);
      setConfirmReread(false);
    }
  };

  const save = async () => {
    if (!draft) return;
    const r = fromDraft(draft);
    if ('error' in r) {
      setNotice({ ok: false, text: r.error });
      return;
    }
    setBusy(true);
    setNotice(null);
    try {
      setView(await apiPut<ProfileView>('/profile', token, r.profile));
      setDraft(null);
      setNotice({ ok: true, text: 'Profile saved.' });
    } catch (e) {
      setNotice({ ok: false, text: message(e, 'Could not save your profile.') });
    } finally {
      setBusy(false);
    }
  };

  if (loadError) return <div className="banner">⚠️ Could not load your profile. Check that the API is running, then refresh.</div>;
  if (!view) {
    return (
      <div className="center" style={{ minHeight: 160 }}>
        <Spinner />
      </div>
    );
  }

  const editing = draft !== null;
  const canReread = view.aiEnabled && !parsing && view.status !== 'none';

  return (
    <>
      <header className="page-head">
        <h1>Profile</h1>
        <p>What we read from your resume, used to match you with jobs and fill in applications. Check it and correct anything that's wrong.</p>
      </header>

      <div className="card">
        <div className="row">
          <h3>From your resume</h3>
          <StatusBadge status={view.status} />
          <span className="spacer" />
          {!editing && view.status !== 'none' && (
            <div className="row" style={{ gap: 8 }}>
              {canReread &&
                (confirmReread ? (
                  <span className="row" style={{ gap: 8 }} role="group" aria-label="Read the resume again?">
                    <span className="muted">This replaces your edits.</span>
                    <button className="btn btn-primary" onClick={() => void reread()} disabled={busy} autoFocus>
                      {busy && <Spinner small />} Read again
                    </button>
                    <button className="btn btn-ghost" onClick={() => setConfirmReread(false)}>
                      Cancel
                    </button>
                  </span>
                ) : (
                  <button className="btn btn-ghost" onClick={() => (view.editedAt ? setConfirmReread(true) : void reread())} disabled={busy}>
                    Read resume again
                  </button>
                ))}
              {!parsing && (
                <button
                  className="btn btn-primary"
                  onClick={() => {
                    setNotice(null);
                    setDraft(toDraft(view.profile));
                  }}
                >
                  {view.profile ? 'Edit' : 'Fill in by hand'}
                </button>
              )}
            </div>
          )}
        </div>

        <SourceLine view={view} />

        {notice && (
          <p role={notice.ok ? 'status' : 'alert'} className={notice.ok ? 'notice ok' : 'notice error'}>
            {notice.text}
          </p>
        )}

        {view.status === 'failed' && view.error && (
          <p role="alert" className="notice error">
            {view.error}
            {view.profile && ' Your previous profile is shown below.'}
          </p>
        )}

        {editing ? (
          <ProfileForm draft={draft} onChange={setDraft} onSave={() => void save()} onCancel={() => setDraft(null)} busy={busy} />
        ) : parsing && !view.profile ? (
          <div className="row" role="status" aria-live="polite">
            <Spinner small /> Reading your resume. This usually takes under a minute.
          </div>
        ) : view.profile ? (
          <ProfileDetails p={view.profile} />
        ) : view.status === 'none' ? (
          <NoProfile aiEnabled={view.aiEnabled} busy={busy} onRead={() => void reread()} onFillIn={() => setDraft(toDraft(null))} />
        ) : null}
      </div>

      <PreferencesCard token={token} />
    </>
  );
}

function StatusBadge({ status }: { status: ProfileView['status'] }) {
  if (status === 'parsing')
    return (
      <Badge tone="primary" dot>
        Reading…
      </Badge>
    );
  if (status === 'ready')
    return (
      <Badge tone="success" dot>
        Ready
      </Badge>
    );
  if (status === 'failed')
    return (
      <Badge tone="danger" dot>
        Couldn't read
      </Badge>
    );
  return null;
}

function SourceLine({ view }: { view: ProfileView }) {
  const bits: string[] = [];
  if (view.sourceFileName) bits.push(`Read from ${view.sourceFileName}`);
  if (view.parsedAt) bits.push(formatDateTime(view.parsedAt));
  if (view.editedAt) bits.push(`edited by you ${formatDateTime(view.editedAt)}`);
  if (!view.aiEnabled) bits.push("reading resumes with AI isn't set up on this server");
  return bits.length ? <p className="muted" style={{ margin: 0 }}>{bits.join(' · ')}</p> : null;
}

function NoProfile(props: { aiEnabled: boolean; busy: boolean; onRead: () => void; onFillIn: () => void }) {
  return (
    <div className="empty" style={{ justifyItems: 'start', textAlign: 'left' }}>
      <p style={{ margin: 0 }}>
        {props.aiEnabled ? (
          <>
            <Link to="/resume">Upload your resume</Link> and we'll read it into your profile automatically. Already uploaded one? Read
            it now.
          </>
        ) : (
          "Reading resumes with AI isn't set up yet, but you can fill in your profile yourself."
        )}
      </p>
      <div className="row" style={{ gap: 8 }}>
        {props.aiEnabled && (
          <button className="btn btn-primary" onClick={props.onRead} disabled={props.busy}>
            {props.busy && <Spinner small />} Read my resume
          </button>
        )}
        <button className="btn btn-ghost" onClick={props.onFillIn} disabled={props.busy}>
          Fill in by hand
        </button>
      </div>
    </div>
  );
}

function ProfileDetails({ p }: { p: CandidateProfile }) {
  const list = (xs: string[]) => (xs.length ? xs.join(', ') : null);
  const rows: [string, ReactNode][] = [
    ['Name', p.fullName],
    ['Headline', p.headline],
    ['Email', p.email],
    ['Phone', p.phone],
    ['Location', p.location],
    ['Experience', p.yearsExperience == null ? null : `${p.yearsExperience} years`],
    ['Work authorization', p.workAuthorization],
    ['Languages', list(p.languages)],
    ['Certifications', list(p.certifications)],
    [
      'Links',
      p.links.length ? (
        <span className="profile-links">
          {p.links.map((l) => (
            <span key={l}>{l}</span>
          ))}
        </span>
      ) : null,
    ],
  ];
  return (
    <div className="profile-details">
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

      {p.summary && (
        <section>
          <h4>Summary</h4>
          <p>{p.summary}</p>
        </section>
      )}

      {p.skills.length > 0 && (
        <section>
          <h4>Skills</h4>
          <ul className="chips">
            {p.skills.map((s) => (
              <li key={s}>{s}</li>
            ))}
          </ul>
        </section>
      )}

      {p.workHistory.length > 0 && (
        <section>
          <h4>Work history</h4>
          <ul className="entries">
            {p.workHistory.map((w, i) => (
              <li key={i}>
                <strong>{w.title}</strong> · {w.company}
                <div className="muted">
                  {[dates(w.startDate, w.current ? 'present' : w.endDate), w.location].filter(Boolean).join(' · ')}
                </div>
                {w.highlights.length > 0 && (
                  <ul>
                    {w.highlights.map((h, j) => (
                      <li key={j}>{h}</li>
                    ))}
                  </ul>
                )}
              </li>
            ))}
          </ul>
        </section>
      )}

      {p.education.length > 0 && (
        <section>
          <h4>Education</h4>
          <ul className="entries">
            {p.education.map((e, i) => (
              <li key={i}>
                <strong>{[e.degree, e.field].filter(Boolean).join(', ') || e.institution}</strong>
                <div className="muted">{[e.degree || e.field ? e.institution : null, e.endYear].filter(Boolean).join(' · ')}</div>
              </li>
            ))}
          </ul>
        </section>
      )}
    </div>
  );
}

const dates = (start: string | null, end: string | null) => (start || end ? `${start ?? '?'} – ${end ?? '?'}` : null);

function TextField(props: { label: string; value: string; onChange: (v: string) => void; type?: string; placeholder?: string; wide?: boolean }) {
  return (
    <label className={`field ${props.wide ? 'wide' : ''}`}>
      <span>{props.label}</span>
      <input className="input" type={props.type ?? 'text'} value={props.value} placeholder={props.placeholder} onChange={(e) => props.onChange(e.target.value)} />
    </label>
  );
}

function LinesField(props: { label: string; hint?: string; value: string; onChange: (v: string) => void; rows?: number; wide?: boolean }) {
  return (
    <label className={`field ${props.wide ? 'wide' : ''}`}>
      <span>
        {props.label} <span className="muted hint">{props.hint ?? 'one per line'}</span>
      </span>
      <textarea className="input" rows={props.rows ?? 4} value={props.value} onChange={(e) => props.onChange(e.target.value)} />
    </label>
  );
}

function ProfileForm(props: { draft: ProfileDraft; onChange: (d: ProfileDraft) => void; onSave: () => void; onCancel: () => void; busy: boolean }) {
  const { draft: d, onChange } = props;
  const set = <K extends keyof ProfileDraft>(k: K) => (v: ProfileDraft[K]) => onChange({ ...d, [k]: v });
  const setWork = (i: number, patch: Partial<ProfileDraft['workHistory'][number]>) =>
    onChange({ ...d, workHistory: d.workHistory.map((w, j) => (j === i ? { ...w, ...patch } : w)) });
  const setEdu = (i: number, patch: Partial<ProfileDraft['education'][number]>) =>
    onChange({ ...d, education: d.education.map((e, j) => (j === i ? { ...e, ...patch } : e)) });

  return (
    <form
      className="profile-form"
      onSubmit={(e) => {
        e.preventDefault();
        props.onSave();
      }}
      noValidate
    >
      <fieldset disabled={props.busy}>
        <legend>About you</legend>
        <div className="form-grid">
          <TextField label="Full name" value={d.fullName} onChange={set('fullName')} />
          <TextField label="Headline" value={d.headline} onChange={set('headline')} placeholder="e.g. Senior Backend Engineer" />
          <TextField label="Email" type="email" value={d.email} onChange={set('email')} />
          <TextField label="Phone" type="tel" value={d.phone} onChange={set('phone')} />
          <TextField label="Location" value={d.location} onChange={set('location')} />
          <TextField label="Years of experience" value={d.yearsExperience} onChange={set('yearsExperience')} />
          <TextField label="Work authorization" value={d.workAuthorization} onChange={set('workAuthorization')} wide />
          <label className="field wide">
            <span>Summary</span>
            <textarea className="input" rows={3} value={d.summary} onChange={(e) => set('summary')(e.target.value)} />
          </label>
          <LinesField label="Skills" value={d.skills} onChange={set('skills')} rows={6} />
          <LinesField label="Links" value={d.links} onChange={set('links')} rows={6} />
          <LinesField label="Certifications" value={d.certifications} onChange={set('certifications')} rows={3} />
          <LinesField label="Languages" value={d.languages} onChange={set('languages')} rows={3} />
        </div>
      </fieldset>

      <fieldset disabled={props.busy}>
        <legend>Work history</legend>
        {d.workHistory.map((w, i) => (
          <div className="entry-edit" key={i}>
            <div className="form-grid">
              <TextField label="Job title" value={w.title} onChange={(v) => setWork(i, { title: v })} />
              <TextField label="Company" value={w.company} onChange={(v) => setWork(i, { company: v })} />
              <TextField label="Start" value={w.startDate} onChange={(v) => setWork(i, { startDate: v })} placeholder="YYYY-MM" />
              {w.current ? (
                <div className="field">
                  <span>End</span>
                  <span className="muted" style={{ alignSelf: 'center', fontWeight: 400 }}>
                    Present
                  </span>
                </div>
              ) : (
                <TextField label="End" value={w.endDate} onChange={(v) => setWork(i, { endDate: v })} placeholder="YYYY-MM" />
              )}
              <TextField label="Location" value={w.location} onChange={(v) => setWork(i, { location: v })} />
              <label className="field check-field">
                <input type="checkbox" checked={w.current} onChange={(e) => setWork(i, { current: e.target.checked })} />
                <span>I work here now</span>
              </label>
              <LinesField label="Highlights" value={w.highlights} onChange={(v) => setWork(i, { highlights: v })} wide />
            </div>
            <button type="button" className="btn btn-danger-ghost" onClick={() => onChange({ ...d, workHistory: d.workHistory.filter((_, j) => j !== i) })}>
              Remove job
            </button>
          </div>
        ))}
        <button type="button" className="btn btn-ghost" onClick={() => onChange({ ...d, workHistory: [...d.workHistory, { ...EMPTY_WORK }] })}>
          + Add job
        </button>
      </fieldset>

      <fieldset disabled={props.busy}>
        <legend>Education</legend>
        {d.education.map((e, i) => (
          <div className="entry-edit" key={i}>
            <div className="form-grid">
              <TextField label="School or university" value={e.institution} onChange={(v) => setEdu(i, { institution: v })} />
              <TextField label="Degree" value={e.degree} onChange={(v) => setEdu(i, { degree: v })} placeholder="e.g. BSc" />
              <TextField label="Field of study" value={e.field} onChange={(v) => setEdu(i, { field: v })} />
              <TextField label="Year finished" value={e.endYear} onChange={(v) => setEdu(i, { endYear: v })} placeholder="YYYY" />
            </div>
            <button type="button" className="btn btn-danger-ghost" onClick={() => onChange({ ...d, education: d.education.filter((_, j) => j !== i) })}>
              Remove
            </button>
          </div>
        ))}
        <button type="button" className="btn btn-ghost" onClick={() => onChange({ ...d, education: [...d.education, { ...EMPTY_EDUCATION }] })}>
          + Add education
        </button>
      </fieldset>

      <div className="row form-actions">
        <button type="submit" className="btn btn-primary" disabled={props.busy}>
          {props.busy && <Spinner small />} Save profile
        </button>
        <button type="button" className="btn btn-ghost" onClick={props.onCancel} disabled={props.busy}>
          Cancel
        </button>
      </div>
    </form>
  );
}

const WORK_MODES: { value: WorkMode; label: string }[] = [
  { value: 'remote', label: 'Remote' },
  { value: 'hybrid', label: 'Hybrid' },
  { value: 'onsite', label: 'On-site' },
];

function PreferencesCard({ token }: { token: string | undefined }) {
  const [draft, setDraft] = useState<PreferencesDraft | null>(null);
  const [loadError, setLoadError] = useState(false);
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState<Notice>(null);

  useEffect(() => {
    apiGet<JobPreferences>('/preferences', token)
      .then((p) => setDraft(toPreferencesDraft(p)))
      .catch(() => setLoadError(true));
  }, [token]);

  const save = async () => {
    if (!draft) return;
    const r = fromPreferencesDraft(draft);
    if ('error' in r) {
      setNotice({ ok: false, text: r.error });
      return;
    }
    setBusy(true);
    setNotice(null);
    try {
      setDraft(toPreferencesDraft(await apiPut<JobPreferences>('/preferences', token, r.preferences)));
      setNotice({ ok: true, text: 'Preferences saved.' });
    } catch (e) {
      setNotice({ ok: false, text: message(e, 'Could not save your preferences.') });
    } finally {
      setBusy(false);
    }
  };

  const set = <K extends keyof PreferencesDraft>(k: K) => (v: PreferencesDraft[K]) => {
    setNotice(null);
    setDraft((d) => (d ? { ...d, [k]: v } : d));
  };

  return (
    <div className="card" style={{ marginTop: 16 }}>
      <h3>Job preferences</h3>
      <p className="muted" style={{ margin: 0 }}>
        What you're looking for. We use this to decide which jobs are a good match.
      </p>
      {loadError ? (
        <div className="banner">⚠️ Could not load your preferences.</div>
      ) : !draft ? (
        <Spinner small />
      ) : (
        <form
          className="profile-form"
          onSubmit={(e) => {
            e.preventDefault();
            void save();
          }}
          noValidate
        >
          <fieldset disabled={busy}>
            <div className="form-grid">
              <LinesField label="Job titles" value={draft.targetTitles} onChange={set('targetTitles')} />
              <LinesField label="Locations" value={draft.locations} onChange={set('locations')} />
              <div className="field" role="group" aria-labelledby="work-modes-label">
                <span id="work-modes-label">Work arrangement</span>
                <div className="row" style={{ gap: 16 }}>
                  {WORK_MODES.map((m) => (
                    <label key={m.value} className="check-field">
                      <input
                        type="checkbox"
                        checked={draft.workModes.includes(m.value)}
                        onChange={(e) =>
                          set('workModes')(e.target.checked ? [...draft.workModes, m.value] : draft.workModes.filter((x) => x !== m.value))
                        }
                      />
                      <span>{m.label}</span>
                    </label>
                  ))}
                </div>
              </div>
              <label className="field">
                <span>Need visa sponsorship?</span>
                <select className="input" value={draft.needsSponsorship} onChange={(e) => set('needsSponsorship')(e.target.value as PreferencesDraft['needsSponsorship'])}>
                  <option value="">Prefer not to say</option>
                  <option value="no">No</option>
                  <option value="yes">Yes</option>
                </select>
              </label>
              <div className="field wide" role="group" aria-labelledby="salary-label">
                <span id="salary-label">
                  Minimum salary <span className="muted hint">optional</span>
                </span>
                <div className="row salary-row">
                  <input
                    className="input"
                    inputMode="numeric"
                    aria-label="Amount"
                    placeholder="e.g. 90,000"
                    value={draft.salaryAmount}
                    onChange={(e) => set('salaryAmount')(e.target.value)}
                  />
                  <input
                    className="input currency"
                    aria-label="Currency"
                    placeholder="USD"
                    maxLength={3}
                    value={draft.salaryCurrency}
                    onChange={(e) => set('salaryCurrency')(e.target.value)}
                  />
                  <select className="input" aria-label="Per" value={draft.salaryPeriod} onChange={(e) => set('salaryPeriod')(e.target.value as PreferencesDraft['salaryPeriod'])}>
                    <option value="year">per year</option>
                    <option value="month">per month</option>
                    <option value="hour">per hour</option>
                  </select>
                </div>
              </div>
              <LinesField label="Companies to skip" value={draft.excludedCompanies} onChange={set('excludedCompanies')} wide rows={3} />
            </div>
          </fieldset>
          {notice && (
            <p role={notice.ok ? 'status' : 'alert'} className={notice.ok ? 'notice ok' : 'notice error'}>
              {notice.text}
            </p>
          )}
          <div className="row form-actions">
            <button type="submit" className="btn btn-primary" disabled={busy}>
              {busy && <Spinner small />} Save preferences
            </button>
          </div>
        </form>
      )}
    </div>
  );
}
