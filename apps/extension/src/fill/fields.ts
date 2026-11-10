import type { CandidateProfile, JobPreferences } from '../api';

/*
 * Fills an application form from the user's profile. Works from each field's
 * label, so it copes with both Greenhouse and Lever (and their redesigns).
 * Rules: never overwrite what's already typed; never answer demographic
 * (EEO) questions; never submit; report everything left for the user.
 */

export interface FillData {
  firstName: string | null;
  lastName: string | null;
  fullName: string | null;
  email: string | null;
  phone: string | null;
  location: string | null;
  linkedin: string | null;
  github: string | null;
  website: string | null;
  currentCompany: string | null;
  currentTitle: string | null;
  needsSponsorship: boolean | null;
}

export interface ResumeFile {
  name: string;
  type: string;
  /** base64, so it can be passed in a Chrome message. */
  base64: string;
}

export type Outcome = 'filled' | 'already' | 'left' | 'sensitive';

export interface FieldReport {
  label: string;
  outcome: Outcome;
}

/** "Jane van der Berg" → first "Jane", last "van der Berg". */
export function splitName(full: string | null): { first: string | null; last: string | null } {
  const parts = (full ?? '').trim().split(/\s+/).filter(Boolean);
  if (!parts.length) return { first: null, last: null };
  return { first: parts[0], last: parts.length > 1 ? parts.slice(1).join(' ') : null };
}

export function buildFillData(profile: CandidateProfile, prefs: JobPreferences | null, accountEmail: string | null): FillData {
  const { first, last } = splitName(profile.fullName);
  const link = (re: RegExp) => profile.links.find((l) => re.test(l)) ?? null;
  const linkedin = link(/linkedin\.com/i);
  const github = link(/github\.com/i);
  const current = profile.workHistory.find((w) => w.current) ?? null;
  return {
    firstName: first,
    lastName: last,
    fullName: profile.fullName,
    email: profile.email ?? accountEmail,
    phone: profile.phone,
    location: profile.location,
    linkedin,
    github,
    website: profile.links.find((l) => l !== linkedin && l !== github) ?? null,
    currentCompany: current?.company ?? null,
    currentTitle: current?.title ?? null,
    needsSponsorship: prefs?.needsSponsorship ?? null,
  };
}

type Key = Exclude<keyof FillData, 'needsSponsorship'>;
type Kind = { key: Key } | { sponsorship: true } | { resume: true } | { sensitive: true } | null;

const SENSITIVE = /gender|sex\b|race|ethnic|hispanic|latin[oax]|veteran|disabilit|pronoun|sexual orientation|transgender/;

/** What a field asks for, from its label (and name/id). */
export function classify(label: string, el: Element): Kind {
  const l = label.toLowerCase();
  const attrs = `${el.getAttribute('name') ?? ''} ${el.id}`.toLowerCase();
  const type = (el.getAttribute('type') ?? '').toLowerCase();
  if (SENSITIVE.test(l)) return { sensitive: true };
  if (type === 'file') return /resume|cv\b|curriculum/.test(`${l} ${attrs}`) && !/cover/.test(`${l} ${attrs}`) ? { resume: true } : null;
  if (/sponsor/.test(l)) return { sponsorship: true };
  if (/preferred name|nickname/.test(l)) return null;
  if (/first.?name|given name/.test(l) || /first_name/.test(attrs)) return { key: 'firstName' };
  if (/last.?name|surname|family name/.test(l) || /last_name/.test(attrs)) return { key: 'lastName' };
  if (/^(full\s+)?name\b|^your name/.test(l) || /^name$/.test((el.getAttribute('name') ?? '').toLowerCase())) return { key: 'fullName' };
  if (/e-?mail/.test(l) || type === 'email') return { key: 'email' };
  if (/phone|mobile/.test(l) || type === 'tel') return { key: 'phone' };
  if (/linkedin/.test(`${l} ${attrs}`)) return { key: 'linkedin' };
  if (/github/.test(`${l} ${attrs}`)) return { key: 'github' };
  if (/website|portfolio|personal site|blog/.test(l) || /urls\[(portfolio|other)\]/.test(attrs)) return { key: 'website' };
  if (/current (company|employer)|^company$|^organi[sz]ation$/.test(l) || /^org$/.test(el.getAttribute('name') ?? '')) return { key: 'currentCompany' };
  if (/current (job )?(title|role|position)/.test(l)) return { key: 'currentTitle' };
  if (/^location|current location|where are you (located|based)|^city\b/.test(l)) return { key: 'location' };
  return null;
}

/** Escapes a value for use inside a quoted attribute selector. */
const q = (v: string) => v.replace(/["\\]/g, '\\$&');

const clean = (s: string) => s.replace(/\*/g, '').replace(/\s+/g, ' ').trim();

/** The question a field belongs to, as the user sees it. */
export function labelOf(el: Element, doc: Document = el.ownerDocument): string {
  const id = el.id;
  if (id) {
    const lab = doc.querySelector(`label[for="${q(id)}"]`);
    if (lab?.textContent && clean(lab.textContent)) return clean(lab.textContent);
  }
  const labelledBy = el.getAttribute('aria-labelledby');
  if (labelledBy) {
    const t = labelledBy
      .split(/\s+/)
      .map((x) => doc.getElementById(x)?.textContent ?? '')
      .join(' ');
    if (clean(t)) return clean(t);
  }
  const aria = el.getAttribute('aria-label');
  if (aria && clean(aria)) return clean(aria);
  const isChoice = el instanceof HTMLInputElement && (el.type === 'radio' || el.type === 'checkbox');
  // A radio's own <label> is its option ("Yes"); the question is the group's legend or heading.
  if (!isChoice) {
    const wrap = el.closest('label');
    if (wrap?.textContent && clean(wrap.textContent)) return clean(wrap.textContent);
  }
  const group = el.closest('fieldset, .application-question, .field, [class*="question"]');
  const heading = group?.querySelector('legend, .application-label, label, .label, [class*="label"]');
  if (heading?.textContent && clean(heading.textContent)) return clean(heading.textContent);
  return clean(el.getAttribute('placeholder') ?? el.getAttribute('name') ?? '');
}

/** Sets a value the way typing would, so React-based forms notice it. */
function setValue(el: HTMLInputElement | HTMLTextAreaElement, value: string) {
  const proto = el instanceof HTMLTextAreaElement ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype;
  Object.getOwnPropertyDescriptor(proto, 'value')?.set?.call(el, value);
  el.dispatchEvent(new Event('input', { bubbles: true }));
  el.dispatchEvent(new Event('change', { bubbles: true }));
}

const answer = (yes: boolean) => (yes ? /^\s*yes\b/i : /^\s*no\b/i);

function chooseSelect(el: HTMLSelectElement, yes: boolean): boolean {
  const opt = [...el.options].find((o) => answer(yes).test(o.textContent ?? ''));
  if (!opt) return false;
  el.value = opt.value;
  el.dispatchEvent(new Event('change', { bubbles: true }));
  return true;
}

function chooseRadio(radios: HTMLInputElement[], yes: boolean): boolean {
  const r = radios.find((x) => answer(yes).test(labelOfOption(x)));
  if (!r) return false;
  r.click();
  return true;
}

function labelOfOption(r: HTMLInputElement): string {
  const lab = (r.id && r.ownerDocument.querySelector(`label[for="${q(r.id)}"]`)) || r.closest('label');
  return clean(lab?.textContent ?? r.value);
}

function base64ToBytes(b64: string): Uint8Array<ArrayBuffer> {
  const bin = atob(b64);
  const out = new Uint8Array(new ArrayBuffer(bin.length));
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

/** Puts a file into a file input, as if the user had chosen it. */
export function attachFile(input: HTMLInputElement, file: ResumeFile): boolean {
  if (typeof DataTransfer === 'undefined') return false;
  const dt = new DataTransfer();
  dt.items.add(new File([base64ToBytes(file.base64)], file.name, { type: file.type }));
  input.files = dt.files;
  input.dispatchEvent(new Event('input', { bubbles: true }));
  input.dispatchEvent(new Event('change', { bubbles: true }));
  return true;
}

const HIGHLIGHT = { filled: '2px solid #16a34a', left: '2px solid #f59e0b' } as const;

function mark(el: HTMLElement, how: keyof typeof HIGHLIGHT | null) {
  el.style.outline = how ? HIGHLIGHT[how] : '';
  el.style.outlineOffset = how ? '2px' : '';
  if (how) el.setAttribute('data-job-apply', how);
  else el.removeAttribute('data-job-apply');
}

const isVisibleField = (el: Element) => {
  const input = el as HTMLInputElement;
  if (input.disabled) return false;
  const type = (el.getAttribute('type') ?? '').toLowerCase();
  if (['hidden', 'submit', 'button', 'reset', 'image', 'search'].includes(type)) return false;
  if (el.closest('[aria-hidden="true"]') && type !== 'file') return false;
  return true;
};

/**
 * Fills what the profile supports and reports every question on the form.
 * Highlights filled fields green and the ones left for the user amber.
 */
export function fillForm(root: Document | Element, data: FillData, resume: ResumeFile | null, attach = attachFile): FieldReport[] {
  const doc = root instanceof Document ? root : root.ownerDocument;
  const form = (root instanceof Document ? root.querySelector('form#application-form, form#application_form, form[action*="apply"], form') : root) ?? root;
  const report: FieldReport[] = [];
  const seenGroups = new Set<string>();
  const fields = [...(form as ParentNode).querySelectorAll('input, textarea, select')].filter(isVisibleField);
  doc.querySelectorAll('[data-job-apply]').forEach((el) => mark(el as HTMLElement, null));

  for (const el of fields) {
    const input = el as HTMLInputElement;
    const isRadio = input.type === 'radio' || input.type === 'checkbox';
    if (isRadio) {
      const group = input.name || labelOf(el);
      if (seenGroups.has(group)) continue;
      seenGroups.add(group);
    }
    const label = labelOf(el, doc) || '(unlabelled field)';
    const kind = classify(label, el);
    let outcome: Outcome = 'left';

    if (kind && 'sensitive' in kind) outcome = 'sensitive';
    else if (kind && 'resume' in kind) {
      if (input.files?.length) outcome = 'already';
      else if (resume && attach(input, resume)) outcome = 'filled';
    } else if (kind && 'sponsorship' in kind) {
      if (data.needsSponsorship !== null) {
        const ok = isRadio
          ? chooseRadio([...form.querySelectorAll<HTMLInputElement>(`input[type="${input.type}"][name="${q(input.name)}"]`)], data.needsSponsorship)
          : el instanceof HTMLSelectElement && chooseSelect(el, data.needsSponsorship);
        if (ok) outcome = 'filled';
      }
    } else if (kind && 'key' in kind && !(el instanceof HTMLSelectElement) && !isRadio) {
      const value = data[kind.key];
      const target = el as HTMLInputElement | HTMLTextAreaElement;
      if (target.value.trim()) outcome = 'already';
      else if (value) {
        setValue(target, value);
        outcome = 'filled';
      }
    } else if (!kind && (el as HTMLInputElement).value?.trim?.() && !isRadio && !(el instanceof HTMLSelectElement)) {
      outcome = 'already';
    }

    const visible = (input.type === 'file' ? el.closest('fieldset, .field, .application-question, div') : el) as HTMLElement | null;
    if (visible) mark(visible, outcome === 'filled' ? 'filled' : outcome === 'left' || outcome === 'sensitive' ? 'left' : null);
    report.push({ label, outcome });
  }
  return report;
}
