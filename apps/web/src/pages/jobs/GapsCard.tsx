import { useState } from 'react';
import type { Decision, DraftView, Gap, Suggestion } from '../../api/types';
import { Badge, Spinner } from '../../components/ui';
import { finalText } from './tailorView';

/** What the page sends when the user answers a gap. */
export type GapAnswer = { answer: 'pending' | 'no' } | { answer: 'yes'; experience: string; workIndex: number | null };

/**
 * The job's gaps: what it asks for that the resume doesn't show. For each, the
 * user says whether they have the experience; if so, they describe it and
 * Claude writes it up as resume lines (in ATS-friendly wording), which they can
 * still remove one by one.
 */
export function GapsCard(props: {
  draft: DraftView;
  busy: boolean;
  onAnswer: (gapId: string, a: GapAnswer) => Promise<boolean>;
  onDecide: (id: string, decision: Decision) => void;
}) {
  const { gaps, roles, suggestions } = props.draft;
  if (gaps.length === 0) return null;
  const pending = gaps.filter((g) => g.answer === 'pending').length;

  return (
    <div className="card" style={{ gap: 12 }}>
      <div className="row">
        <h3>Gaps</h3>
        <span className="muted">{pending ? `${pending} to answer` : 'All answered'}</span>
      </div>
      <p className="muted" style={{ margin: 0 }}>
        What this job asks for that your resume doesn't show. If you do have the experience, tell us about it and we'll add it to your
        resume in words applicant tracking systems look for. Only say yes if it's true: you may be asked about it in an interview.
      </p>
      <ul className="gap-list">
        {gaps.map((g) => (
          <GapItem
            key={g.id}
            gap={g}
            roles={roles}
            lines={suggestions.filter((s) => s.gapId === g.id)}
            busy={props.busy}
            onAnswer={(a) => props.onAnswer(g.id, a)}
            onDecide={props.onDecide}
          />
        ))}
      </ul>
    </div>
  );
}

function GapItem(props: {
  gap: Gap;
  roles: DraftView['roles'];
  lines: Suggestion[];
  busy: boolean;
  onAnswer: (a: GapAnswer) => Promise<boolean>;
  onDecide: (id: string, decision: Decision) => void;
}) {
  const { gap, roles, busy } = props;
  const [open, setOpen] = useState(false);
  const [experience, setExperience] = useState(gap.experience ?? '');
  // The current role is the usual place for new experience.
  const [role, setRole] = useState<string>(String(gap.workIndex ?? (roles.length ? 0 : '')));
  const [writing, setWriting] = useState(false);

  const submit = async () => {
    setWriting(true);
    const ok = await props.onAnswer({ answer: 'yes', experience: experience.trim(), workIndex: role === '' ? null : Number(role) });
    setWriting(false);
    if (ok) setOpen(false);
  };

  return (
    <li className={`gap-item gap-${gap.answer}`}>
      <div className="row">
        <strong>{gap.text}</strong>
        <span className="spacer" />
        {gap.answer === 'yes' && (
          <Badge tone="success" dot>
            Added to your resume
          </Badge>
        )}
        {gap.answer === 'no' && <Badge dot>Skipped</Badge>}
      </div>

      {open ? (
        <form
          className="gap-form"
          onSubmit={(e) => {
            e.preventDefault();
            void submit();
          }}
        >
          <label className="field">
            Your experience
            <span className="hint muted">Where you did it, what you did, and any results. A sentence or two is enough.</span>
            <textarea
              className="input"
              rows={3}
              value={experience}
              onChange={(e) => setExperience(e.target.value)}
              maxLength={1500}
              placeholder="e.g. At Globex I moved our 12 services to Kubernetes and ran the clusters for two years."
              autoFocus
            />
          </label>
          <label className="field">
            Add it under
            <select className="input" value={role} onChange={(e) => setRole(e.target.value)}>
              {roles.map((r, i) => (
                <option key={i} value={i}>
                  {r.title}, {r.company}
                </option>
              ))}
              <option value="">Skills only (not tied to one role)</option>
            </select>
          </label>
          <div className="row" style={{ gap: 8 }}>
            <button className="btn btn-primary" type="submit" disabled={busy || experience.trim().length < 15}>
              {writing && <Spinner small />} {writing ? 'Writing it up…' : 'Add to my resume'}
            </button>
            <button className="btn btn-ghost" type="button" onClick={() => setOpen(false)} disabled={writing}>
              Cancel
            </button>
          </div>
        </form>
      ) : gap.answer === 'pending' ? (
        <div className="row" style={{ gap: 8 }}>
          <span className="muted">Do you have experience with this?</span>
          <button className="btn btn-primary" onClick={() => setOpen(true)} disabled={busy}>
            Yes, I do
          </button>
          <button className="btn btn-ghost" onClick={() => void props.onAnswer({ answer: 'no' })} disabled={busy}>
            No
          </button>
        </div>
      ) : (
        <>
          {gap.answer === 'yes' && (
            <>
              {gap.experience && <p className="muted gap-said">You said: “{gap.experience}”</p>}
              <ul className="gap-lines">
                {props.lines.map((s) => (
                  <li key={s.id} style={{ opacity: s.decision === 'rejected' ? 0.6 : 1 }}>
                    <span>
                      <span className="muted">{s.kind === 'add_skill' ? 'Skill' : `${roleName(roles, s.workIndex)}`}: </span>+ {finalText(s)}
                    </span>
                    {s.decision === 'rejected' ? (
                      <button className="link-btn" onClick={() => props.onDecide(s.id, 'accepted')} disabled={busy}>
                        Put back
                      </button>
                    ) : (
                      <button className="link-btn" onClick={() => props.onDecide(s.id, 'rejected')} disabled={busy}>
                        Remove
                      </button>
                    )}
                  </li>
                ))}
              </ul>
            </>
          )}
          <div className="row" style={{ gap: 8 }}>
            {gap.answer === 'yes' && (
              <button className="btn btn-ghost" onClick={() => setOpen(true)} disabled={busy}>
                Rewrite
              </button>
            )}
            <button className="link-btn" onClick={() => void props.onAnswer({ answer: 'pending' })} disabled={busy}>
              Change my answer
            </button>
          </div>
        </>
      )}
    </li>
  );
}

const roleName = (roles: DraftView['roles'], i: number | null) => {
  const r = i === null ? null : roles[i];
  return r ? `${r.title}, ${r.company}` : 'Experience';
};
