import type { DraftView, ScoredMatch } from '../../api/types';
import { Badge, Spinner } from '../../components/ui';
import { formatDateTime } from '../admin/format';
import { verdictLabel } from './jobView';
import { scoreDelta } from './tailorView';

/**
 * How the tailored resume compares with the original: required-skill keywords
 * mentioned (instant), and, on request, both matched against the job side by side.
 */
export function ScoreCard(props: { draft: DraftView; accepted: number; busy: boolean; onScore: () => void }) {
  const { keywords: k, score } = props.draft;
  const scoring = score.status === 'scoring';
  const result = score.result;
  const canScore = props.draft.aiEnabled && props.accepted > 0 && !scoring && !props.busy;

  return (
    <div className="card score-card">
      <h3>How your tailored resume scores</h3>

      {k && (
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
          <span className="score-detail muted">The words keyword filters in applicant tracking systems look for. Counts only what you've accepted.</span>
        </div>
      )}

      <div className="score-row">
        <span className="score-label">Match score</span>
        {result ? (
          <>
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
            {score.scoredAt && <span className="score-detail muted">Both versions scored {formatDateTime(score.scoredAt)}.</span>}
          </>
        ) : (
          !scoring && <span className="muted">Not scored yet.</span>
        )}
        {score.outdated && !scoring && (
          <span role="status" className="notice score-detail">
            You've changed which suggestions are accepted since this was scored.
          </span>
        )}
        {score.status === 'failed' && score.error && (
          <span role="alert" className="notice error score-detail">
            {score.error}
          </span>
        )}
        <span className="score-detail">
          {scoring ? (
            <span className="row" role="status" aria-live="polite" style={{ gap: 6 }}>
              <Spinner small /> Scoring your original and tailored resume side by side…
            </span>
          ) : (
            <button className={`btn ${result && !score.outdated ? 'btn-ghost' : 'btn-primary'}`} onClick={props.onScore} disabled={!canScore}>
              {result ? 'Score again' : 'Score my tailored resume'}
            </button>
          )}
        </span>
        {props.accepted === 0 && <span className="score-detail muted">Accept at least one suggestion to score your tailored resume.</span>}
        <span className="score-detail muted">
          Both versions are matched against the job the same way, at the same time, so the comparison is fair. The score judges real fit:
          rewording alone rarely moves it much, while skills and experience you confirm can.
        </span>
      </div>
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
