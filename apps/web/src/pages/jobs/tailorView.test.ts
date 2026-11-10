import { describe, expect, it } from 'vitest';
import type { Suggestion } from '../../api/types';
import { acceptAllIds, counts, finalText, suggestionLabel } from './tailorView';

const s = (over: Partial<Suggestion>): Suggestion => ({
  id: 'a',
  kind: 'add_skill',
  workIndex: null,
  bulletIndex: null,
  before: null,
  after: 'PostgreSQL',
  reason: '',
  source: 'resume',
  question: null,
  decision: 'pending',
  editedText: null,
  ...over,
});

describe('tailorView', () => {
  const roles = [{ title: 'Engineer', company: 'Globex' }];

  it('labels what each suggestion changes', () => {
    expect(suggestionLabel(s({ kind: 'summary' }), roles)).toBe('Summary');
    expect(suggestionLabel(s({ kind: 'rewrite_bullet', workIndex: 0, bulletIndex: 0 }), roles)).toBe('Experience · Engineer, Globex · reworded bullet');
    expect(suggestionLabel(s({ kind: 'add_bullet', workIndex: 5 }), roles)).toBe('Experience · new bullet');
  });

  it("uses the user's edit when there is one", () => {
    expect(finalText(s({ editedText: 'Postgres (PostgreSQL)' }))).toBe('Postgres (PostgreSQL)');
    expect(finalText(s({}))).toBe('PostgreSQL');
  });

  it('accepts all only pending suggestions backed by the resume', () => {
    const list = [
      s({ id: '1' }),
      s({ id: '2', source: 'needs_confirmation', question: 'Used Kubernetes?' }),
      s({ id: '3', decision: 'rejected' }),
      s({ id: '4', decision: 'accepted' }),
    ];
    expect(acceptAllIds(list)).toEqual(['1']);
    expect(counts(list)).toEqual({ accepted: 1, rejected: 1, pending: 2 });
  });
});
