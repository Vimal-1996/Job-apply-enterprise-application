import { api, ApiError, fetchSigned, NOT_SIGNED_IN, type DraftView, type JobPreferences, type JobSummary, type ProfileView, type Resume } from './api';
import { signedInEmail, signIn, signOut } from './auth';
import { buildFillData, type FieldReport, type ResumeFile } from './fill/fields';
import { findSavedJob } from './fill/match';
import type { DetectReply, FillReply, ToContent } from './messages';

/*
 * The side panel. For the job page in the current tab: links it to a saved
 * job (or adds it), shows the match, fills the form from the profile, and
 * marks the job as applied once the user has submitted it themselves.
 * Everything from web pages is shown with textContent, never as HTML.
 */

const MIN_DESCRIPTION = 200;
const POLL_MS = 3000;
const VERDICT: Record<string, string> = { strong: 'Strong match', good: 'Good match', possible: 'Possible match', weak: 'Weak match' };
const STAGE: Record<string, string> = { saved: 'Saved', applied: 'Applied', interviewing: 'Interviewing', offer: 'Offer', rejected: 'Rejected', withdrawn: 'Withdrawn' };

interface State {
  email: string | null;
  tabId: number | null;
  page: DetectReply | null;
  jobs: JobSummary[];
  jobId: string | null;
  profile: ProfileView | null;
  prefs: JobPreferences | null;
  resume: Resume | null;
  tailored: boolean;
  useTailored: boolean;
  report: FieldReport[] | null;
  busy: string | null;
  error: string | null;
  notice: string | null;
}

const state: State = {
  email: null,
  tabId: null,
  page: null,
  jobs: [],
  jobId: null,
  profile: null,
  prefs: null,
  resume: null,
  tailored: false,
  useTailored: false,
  report: null,
  busy: null,
  error: null,
  notice: null,
};

// ---------------------------------------------------------------- tiny DOM helpers

type Child = Node | string | null | false | undefined;
function h<K extends keyof HTMLElementTagNameMap>(tag: K, props: Partial<HTMLElementTagNameMap[K]> & { class?: string } = {}, ...children: Child[]) {
  const el = document.createElement(tag);
  const { class: cls, ...rest } = props;
  if (cls) el.className = cls;
  Object.assign(el, rest);
  for (const c of children) if (c) el.append(c);
  return el;
}
const button = (label: string, onClick: () => void, cls = 'btn', disabled = false) => h('button', { class: cls, disabled, onclick: onClick, type: 'button' }, label);

// ---------------------------------------------------------------- data

const selectedJob = () => state.jobs.find((j) => j.id === state.jobId) ?? null;

async function activeTab(): Promise<chrome.tabs.Tab | undefined> {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  return tab;
}

async function send<T>(msg: ToContent): Promise<T | null> {
  if (state.tabId === null) return null;
  try {
    return ((await chrome.tabs.sendMessage(state.tabId, msg)) as T | undefined) ?? null;
  } catch {
    return null; // no content script here: not a Greenhouse or Lever page
  }
}

async function loadTailored() {
  state.tailored = false;
  const job = selectedJob();
  if (!job) return;
  try {
    const d = await api.get<DraftView>(`/jobs/${job.id}/resume-draft`);
    state.tailored = d.suggestions.some((s) => s.decision === 'accepted');
  } catch {
    /* no draft */
  }
  state.useTailored = state.tailored;
}

async function refresh() {
  state.error = null;
  state.report = null;
  state.notice = null;
  state.email = await signedInEmail();
  const tab = await activeTab();
  state.tabId = tab?.id ?? null;
  state.page = await send<DetectReply>({ type: 'detect' });
  render();
  if (state.email === null || !state.page) return;
  try {
    const [jobs, profile, prefs, resumes] = await Promise.all([
      api.get<JobSummary[]>('/jobs'),
      api.get<ProfileView>('/profile'),
      api.get<JobPreferences>('/preferences'),
      api.get<Resume[]>('/resumes'),
    ]);
    state.jobs = jobs;
    state.profile = profile;
    state.prefs = prefs;
    state.resume = resumes.find((r) => r.isCurrent) ?? null;
    state.jobId = findSavedJob(state.page.job, jobs)?.id ?? null;
    await loadTailored();
  } catch (e) {
    fail(e);
  }
  render();
}

function fail(e: unknown) {
  state.error = e instanceof Error ? e.message : 'Something went wrong.';
  if (e instanceof ApiError && e.status === 401 && e.message === NOT_SIGNED_IN) state.email = null;
}

async function run(label: string, fn: () => Promise<void>) {
  state.busy = label;
  state.error = null;
  state.notice = null;
  render();
  try {
    await fn();
  } catch (e) {
    fail(e);
  } finally {
    state.busy = null;
    render();
  }
}

function toBase64(bytes: Uint8Array): string {
  let s = '';
  for (let i = 0; i < bytes.length; i += 0x8000) s += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(s);
}

function nameFromDisposition(header: string | null): string | null {
  const m = header && (/filename\*=UTF-8''([^;]+)/i.exec(header) ?? /filename="([^"]+)"/i.exec(header));
  if (!m) return null;
  try {
    return decodeURIComponent(m[1]);
  } catch {
    return m[1];
  }
}

async function resumeFile(): Promise<ResumeFile | null> {
  const job = selectedJob();
  if (state.useTailored && job) {
    const f = await api.file(`/jobs/${job.id}/resume-draft/document`);
    return { name: nameFromDisposition(f.disposition) ?? 'Tailored resume.docx', type: f.contentType.split(';')[0], base64: toBase64(f.bytes) };
  }
  if (!state.resume) return null;
  const { url } = await api.get<{ url: string }>(`/resumes/${state.resume.id}/download`);
  return { name: state.resume.fileName, type: state.resume.contentType, base64: toBase64(await fetchSigned(url)) };
}

// ---------------------------------------------------------------- actions

const actions = {
  signIn: () =>
    run('Signing in…', async () => {
      await signIn();
      await refresh();
    }),
  signOut: () =>
    run('Signing out…', async () => {
      await signOut();
      state.email = null;
    }),
  addJob: () =>
    run('Adding the job and checking your match…', async () => {
      const page = state.page!.job;
      const job = await api.post<JobSummary>('/jobs', { link: page.url, description: `${page.title ?? ''}\n${page.company ?? ''}\n\n${page.description}`.trim() });
      state.jobs = [job, ...state.jobs];
      state.jobId = job.id;
      // Matching takes a few seconds; wait for it so the score shows.
      for (let i = 0; i < 40 && selectedJob()?.matchStatus === 'matching'; i++) {
        await new Promise((r) => setTimeout(r, POLL_MS));
        const fresh = await api.get<JobSummary>(`/jobs/${job.id}`);
        state.jobs = state.jobs.map((j) => (j.id === job.id ? { ...j, ...fresh } : j));
        render();
      }
    }),
  fill: () =>
    run('Filling the form…', async () => {
      const profile = state.profile?.profile;
      if (!profile) throw new Error('Set up your profile in Job Apply first.');
      const reply = await send<FillReply>({ type: 'fill', data: buildFillData(profile, state.prefs, state.email), resume: await resumeFile() });
      if (!reply) throw new Error("Couldn't find the application form on this page. Open the job's Apply page and try again.");
      state.report = reply.report;
    }),
  markApplied: () =>
    run('Saving…', async () => {
      const job = selectedJob()!;
      await api.patch(`/jobs/${job.id}/application`, { status: 'applied' });
      state.jobs = state.jobs.map((j) => (j.id === job.id ? { ...j, applicationStatus: 'applied' } : j));
      state.notice = 'Marked as applied. Good luck!';
    }),
  chooseJob: async (id: string) => {
    state.jobId = id || null;
    state.report = null;
    await loadTailored();
    render();
  },
};

// ---------------------------------------------------------------- view

function render() {
  const root = document.getElementById('app')!;
  root.replaceChildren(view());
}

function view(): Node {
  const s = state;
  const header = h(
    'header',
    { class: 'row' },
    h('strong', {}, 'Job Apply'),
    h('span', { class: 'spacer' }),
    s.email !== null && h('span', { class: 'muted small' }, s.email || 'Signed in'),
    s.email !== null && button('Sign out', actions.signOut, 'link', !!s.busy),
  );
  const status = h(
    'div',
    { class: 'stack' },
    s.busy && h('p', { class: 'muted', role: 'status' } as Partial<HTMLParagraphElement>, s.busy),
    s.error && h('p', { class: 'error', role: 'alert' } as Partial<HTMLParagraphElement>, s.error),
    s.notice && h('p', { class: 'ok', role: 'status' } as Partial<HTMLParagraphElement>, s.notice),
  );

  if (s.email === null) {
    return h(
      'div',
      { class: 'stack' },
      header,
      h('p', {}, 'Sign in with your Job Apply account to fill applications from your profile.'),
      button('Sign in', actions.signIn, 'btn btn-primary', !!s.busy),
      status,
      h('p', { class: 'muted small' }, 'Using another environment? Change it in ', h('a', { href: 'options.html', target: '_blank' }, 'Settings'), '.'),
    );
  }

  if (!s.page) {
    return h(
      'div',
      { class: 'stack' },
      header,
      status,
      h('p', {}, 'Open a job posting or application on Greenhouse or Lever, and this panel will help you fill it in.'),
      h('p', { class: 'muted small' }, "Job Apply never fills forms on LinkedIn or Indeed, and never submits for you."),
      button('Check this page again', () => void refresh(), 'btn', !!s.busy),
    );
  }

  const page = s.page.job;
  const job = selectedJob();
  const jobCard = h(
    'section',
    { class: 'card stack' },
    h('div', { class: 'title' }, page.title ?? 'Untitled job'),
    h('div', { class: 'muted small' }, [page.company, page.site === 'greenhouse' ? 'Greenhouse' : 'Lever'].filter(Boolean).join(' · ')),
    job
      ? h(
          'div',
          { class: 'row' },
          job.matchStatus === 'matching'
            ? h('span', { class: 'badge' }, 'Matching…')
            : job.score !== null && h('span', { class: `badge ${job.verdict ?? ''}` }, `${job.score} · ${VERDICT[job.verdict ?? ''] ?? ''}`),
          h('span', { class: 'badge' }, STAGE[job.applicationStatus]),
        )
      : h('p', { class: 'muted small' }, "This job isn't in Job Apply yet."),
    jobPicker(),
    !job &&
      (page.description.length >= MIN_DESCRIPTION
        ? button('Add this job and check my match', actions.addJob, 'btn btn-primary', !!s.busy)
        : h('p', { class: 'muted small' }, "Not enough of the posting is on this page to add it. Open the job's own posting page, or add it in Job Apply.")),
  );

  const noProfile = !s.profile?.profile;
  const fillCard = h(
    'section',
    { class: 'card stack' },
    h('div', { class: 'title' }, 'Fill the application'),
    !s.page.hasForm && h('p', { class: 'muted small' }, 'Open the Apply form for this job to fill it in.'),
    noProfile && h('p', { class: 'error' }, 'Set up your profile in Job Apply first (upload your resume or fill it in).'),
    resumeChoice(),
    button('Fill from my profile', actions.fill, 'btn btn-primary', !!s.busy || noProfile || !s.page.hasForm),
    h('p', { class: 'muted small' }, "Fills only fields your profile supports and never overwrites what you've typed. You check everything and click Submit yourself."),
    s.report && reportView(s.report),
  );

  const applied = job && job.applicationStatus !== 'saved';
  const doneCard =
    job &&
    h(
      'section',
      { class: 'card stack' },
      applied
        ? h('p', {}, `This job is marked as ${STAGE[job.applicationStatus].toLowerCase()}.`)
        : [h('p', {}, 'Submitted the application? Track it in Job Apply.'), button('I submitted it: mark as applied', actions.markApplied, 'btn', !!s.busy)].reduce(
            (frag, n) => (frag.append(n), frag),
            document.createDocumentFragment(),
          ),
    );

  return h('div', { class: 'stack' }, header, status, jobCard, fillCard, doneCard);
}

function jobPicker(): Node | null {
  if (!state.jobs.length) return null;
  const select = h(
    'select',
    { class: 'input', onchange: (e: Event) => void actions.chooseJob((e.target as HTMLSelectElement).value) } as Partial<HTMLSelectElement>,
    h('option', { value: '' }, 'Not one of my saved jobs'),
    ...state.jobs.map((j) => h('option', { value: j.id, selected: j.id === state.jobId }, [j.title ?? 'Untitled job', j.company].filter(Boolean).join(' · '))),
  );
  return h('label', { class: 'field small' }, 'Saved job', select);
}

function resumeChoice(): Node {
  const s = state;
  if (!s.resume && !s.tailored) return h('p', { class: 'muted small' }, 'No resume to attach: upload one in Job Apply.');
  const option = (label: string, tailored: boolean) =>
    h(
      'label',
      { class: 'check small' },
      h('input', { type: 'radio', name: 'resume', checked: s.useTailored === tailored, onchange: () => ((s.useTailored = tailored), render()) } as Partial<HTMLInputElement>),
      label,
    );
  return h(
    'fieldset',
    { class: 'stack tight' },
    h('legend', { class: 'small' }, 'Resume to attach'),
    s.resume && option(`My resume (${s.resume.fileName})`, false),
    s.tailored && option('Tailored for this job (.docx)', true),
  );
}

function reportView(report: FieldReport[]): Node {
  const by = (o: FieldReport['outcome']) => report.filter((r) => r.outcome === o);
  const filled = by('filled');
  const left = [...by('left'), ...by('sensitive')];
  return h(
    'div',
    { class: 'stack tight' },
    h('p', { class: 'ok' }, `Filled ${filled.length} field${filled.length === 1 ? '' : 's'} (outlined green).`),
    by('already').length > 0 && h('p', { class: 'muted small' }, `Kept ${by('already').length} you'd already filled in.`),
    left.length > 0 && h('p', { class: 'small' }, `Left for you (outlined amber): ${left.length}`),
    left.length > 0 &&
      h(
        'ul',
        { class: 'small' },
        ...left.map((r) => h('li', {}, r.label, r.outcome === 'sensitive' ? h('span', { class: 'muted' }, ' (personal question: always yours to answer)') : null)),
      ),
    h('p', { class: 'muted small' }, 'Review the form, then click Submit on the page.'),
  );
}

// ---------------------------------------------------------------- wiring

chrome.tabs.onActivated.addListener(() => void refresh());
chrome.tabs.onUpdated.addListener((_id, info, tab) => {
  if (tab.active && info.status === 'complete') void refresh();
});
void refresh();
