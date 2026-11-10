import { Link } from 'react-router-dom';
import type { ResumeCheck } from '../../api/types';

/** The "Workday-friendly layout" option and what the profile is missing, shown next to a resume download. */
export function ResumeFormat(props: { workday: boolean; onChange: (workday: boolean) => void; checks: ResumeCheck[]; suggested?: boolean }) {
  const { workday, checks } = props;
  return (
    <div style={{ display: 'grid', gap: 8 }}>
      <label className="check-field">
        <input type="checkbox" checked={workday} onChange={(e) => props.onChange(e.target.checked)} />
        Workday-friendly layout
        {props.suggested && <span className="muted" style={{ fontWeight: 400 }}>(this job applies through Workday)</span>}
      </label>
      <p className="muted" style={{ margin: 0, fontSize: 13 }}>
        {workday
          ? "Laid out for Workday's “Autofill with Resume”: each job's title, company, location and MM/YYYY dates on their own lines, so Workday fills My Experience correctly. Still check each field before you submit."
          : 'A clean one-column layout that applicant tracking systems read well.'}
      </p>
      {checks.length > 0 && (
        <div className="notice" role="status" style={{ display: 'grid', gap: 4 }}>
          <strong>
            {checks.length} thing{checks.length === 1 ? '' : 's'} Workday will ask for {checks.length === 1 ? 'is' : 'are'} missing from your profile
          </strong>
          <ul style={{ margin: 0, paddingLeft: 20 }}>
            {checks.map((c, i) => (
              <li key={i}>
                <span className="muted">{c.where}:</span> {c.message}
              </li>
            ))}
          </ul>
          <span>
            <Link to="/profile">Fix them on your Profile</Link>; they'll appear in the next download. We never fill these in with guesses.
          </span>
        </div>
      )}
    </div>
  );
}
