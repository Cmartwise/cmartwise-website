-- ══════════════════════════════════════════════════════════════
-- CmartWise Student Portal — Test review add-on schema
-- Run this in: Supabase Dashboard → SQL Editor → New Query
-- (Run AFTER schema.sql. Adds per-question review detail so
--  students and Ika can see which answers were right/wrong and why,
--  not just the final score.)
-- ══════════════════════════════════════════════════════════════

alter table public.test_sessions
  add column if not exists detail jsonb;
  -- detail shape (reading/listening): [
  --   { "question": "...", "type": "multiple_choice"|"true_false"|"short",
  --     "options": [...] | null,
  --     "student_answer": ..., "correct_answer": ...,
  --     "is_correct": true|false|null, "explanation": "..." }
  -- ]
  -- Existing rows are unaffected (detail defaults to null). RLS policies
  -- already defined on test_sessions in schema.sql cover this column too.
