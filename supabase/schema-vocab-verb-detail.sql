-- ══════════════════════════════════════════════════════════════
-- CmartWise Student Portal — Verb deep-detail add-on
-- Run this in: Supabase Dashboard → SQL Editor → New Query
-- (Run AFTER schema-vocab-grammar.sql and schema-vocab-split-multi-terms.sql.)
--
-- Adds the richer per-verb reference content Ika wants in "My Vocabulary":
-- regularity + frequency (shown in the basic card), plus contexts/examples,
-- fixed expressions, and full conjugation tables (shown when a student
-- clicks a verb to expand it). Modelled on the "Verbos do Dia a Dia" PDF's
-- content structure, not its visual design — the site keeps its own
-- forest/gold card style.
--
-- New columns are nullable — existing rows (and non-verb rows) just don't
-- have this detail until the admin panel's "Enrich verb details" tool
-- (Vocabulary tab) backfills verb entries via Claude.
-- ══════════════════════════════════════════════════════════════

alter table public.vocab_master
  add column if not exists frequency         text,   -- e.g. 'Extremely common', 'Very common'
  add column if not exists regularity        text,   -- e.g. 'AR regular', 'ER regular', 'IR regular', 'Irregular'
  add column if not exists contexts          jsonb,  -- [{label, note, example_pt, example_en}, ...]
  add column if not exists fixed_expressions jsonb,  -- [{phrase, meaning}, ...]
  add column if not exists conjugations      jsonb;  -- [{tense, tense_pt, usage_note, forms:{eu,tu,ele_ela_voce,nos,eles_elas_voces}}, ...]

-- Helper index so the "Enrich verb details" admin tool can cheaply find
-- verb rows that still need this deeper detail generated.
create index if not exists vocab_master_needs_verb_detail
  on public.vocab_master (student_id)
  where conjugations is null;
