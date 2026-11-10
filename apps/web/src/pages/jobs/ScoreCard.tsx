import type { ReactNode } from 'react';
import type { DraftView, ScoredMatch } from '../../api/types';
import { Badge, Spinner } from '../../components/ui';
import { formatDateTime } from '../admin/format';
import { verdictLabel } from './jobView';
import { leftToReview, scoreDelta, tailorProgress } from './tailorView';

/**
 * The last step: once every suggestion and gap is answered, generate the
 * tailored resume. That scores it against the job side by side with the
 * original, then offers the download (`children`: format and layout choices).
 */
export function ScoreCard(props: {
  draft: DraftView;
  progress: ReturnType<typeof tailorProgress>;
  busy: boolean;
  onGenerate: () => void;
  children: ReactNode;
}) {
  const { draft, progress: p } = props;
  const { keywords: k, score } = draft;
  const scoring = score.status === 'scoring';
  const result = score.result;
  const generated = Boolean(result) && !score.outdated;
  const canGenerate = draft.aiEnabled && p.done && p.accepted > 0 && !scoring && !props.busy;

  return (
    <div className="card score-card">
      <h3>Your tailored resume</h3>

      {!p.done && (
        <p className="muted" style={{ margin: 0 }}>
          Review the remaining {leftToReview(p)} above, then generate your resume.
        </p>
      )}
      {p.done && p.accepted === 0 && (
        <p className="muted" style={{ margin: 0 }}>
          You haven't accepted any changes, so your resume would stay as it is. Accept a suggestion, or add experience for a gap.
        </p>
      )}

      {scoring ? (
        <span className="row" role="status" aria-live="polite" style={{ gap: 6 }}>
          <Spinner small /> Generating your resume and scoring it against the job, side by side with your original…
        </span>
      ) : (
        !generated && (
          <div>
            <button className="btn btn-primary" onClick={props.onGenerate} disabled={!canGenerate}>
              {result ? 'Generate again with your changes' : 'Generate my resume'}
            </button>
          </div>
        )
      )}
      {score.outdated && !scoring && (
        <span role="status" className="notice">
          You've changed your answers since this was generated. Generate again to update the score.
        </span>
      )}
      {score.status === 'failed' && score.error && (
        <span role="alert" className="notice error">
          {score.error}
        </span>
      )}

      {result && (
        <div className="score-row">
          <span className="score-label">Match score</span>
          <span className="row" style={{ gap: 8 }}>
            <Score m={result.original} /> → <Score m={result.tailored} />
            <Badge tone={scoreDelta(result.original.score, result.tailored.score).tone}>{scoreDelta(result.original.score, result.tailored.score).text}</Badge>
          </span>
          <span className="score-detail">{result.tailored.summary}</span>
          {result.tailored.gaps.length > 0 && (
            <span className="score-detail muted">
              Gaps that remain: <SkillList items={result.tailored.gaps} />
            </span>
          )}
          {score.scoredAt && <span className="score-detail muted">Your original and tailored resume, scored side by side {formatDateTime(score.scoredAt)}.</span>}
        </div>
      )}

      {result && k && (
        <div className="score-row">
          <span className="score-label">Required skills mentioned</span>
          <span>
            <strong>
              {k.original}/{k.total}
            </strong>{' '}
            → <strong>{k.tailored}/{k.total}</strong> {k.tailored > k.original && <Badge tone="success">+{k.tailored - k.original}</Badge>}
          </span>
          {k.added.length > 0 && (
            <span className="score-detail">
              Now mentioned: <SkillList items={k.added} />
            </span>
          )}
          {k.missing.length > 0 && (
            <span className="score-detail muted">
              Still not mentioned: <SkillList items={k.missing} />
            </span>
          )}
        </div>
      )}

      {generated && props.children}
    </div>
  );
}

function Score({ m }: { m: ScoredMatch }) {
  const v = verdictLabel(m.verdict);
  return (
    <span className="row" style={{ gap: 6 }}>
      <strong style={{ fontSize: 20 }}>{m.score}</strong>
      <Badge tone={v.tone}>{v.label}</Badge>
    </span>
  );
}

function SkillList({ items }: { items: string[] }) {
  return <>{items.join(', ')}</>;
}
