-- Gaps in a tailored resume: what the job wants that the resume doesn't show
-- (from the job's match), each answered by the user. "Yes" with a description
-- of their experience has Claude write it up as resume lines, stored with the
-- suggestions (marked with the gap's id). A JSON list, like the suggestions:
-- [{ id, text, answer: 'pending' | 'yes' | 'no', experience, workIndex }].
ALTER TABLE resume_draft ADD COLUMN gaps jsonb;

-- tailoring_run.kind gains 'gap' (writing up one gap); it has no CHECK.
