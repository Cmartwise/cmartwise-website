-- ══════════════════════════════════════════════════════════════
-- CmartWise Student Portal — vocab accent-check tracking column
-- Run this in: Supabase Dashboard → SQL Editor → New Query
-- (Run AFTER schema.sql and schema-lesson-processing.sql.)
--
-- Backs the new "Fix Portuguese accents" pass in Admin → Vocabulary
-- (enrich-vocab edge function, mode='accents'). Some vocab_master rows
-- lost their diacritics during the original Canva-backfill SQL generation
-- (e.g. "alcancar" instead of "alcançar", "armacao" instead of "armação")
-- -- confirmed still live via screenshots 2026-07-09, on BOTH term and
-- infinitive in some rows, so the earlier "repair term from infinitive"
-- trick (schema-vocab-term-accent-fix.sql) doesn't catch every case.
--
-- accents_checked defaults false for every row -- old AND new -- so the
-- batch pass (same "keep clicking until remaining hits 0" pattern as the
-- existing grammar/verb-detail enrichment buttons) sweeps up the whole
-- table over time, including anything added later by process-lesson,
-- process-direct-notes, or a manual Admin note. This is what makes the
-- fix apply to "existing AND to come" rather than a one-off patch.
-- ══════════════════════════════════════════════════════════════

alter table public.vocab_master
  add column if not exists accents_checked boolean not null default false;
