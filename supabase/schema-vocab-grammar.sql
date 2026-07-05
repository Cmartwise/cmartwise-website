-- ══════════════════════════════════════════════════════════════
-- CmartWise Student Portal — Vocab grammar-detail add-on
-- Run this in: Supabase Dashboard → SQL Editor → New Query
-- (Run AFTER schema-lesson-processing.sql.)
--
-- Adds the same grammar-detail fields the Language Tools translator
-- already generates per word (phonetic, type, tense, person,
-- infinitive, gender, article, usage note) onto vocab_master, so
-- "My Vocabulary" can render each term with the identical word-card
-- treatment. New columns are nullable — existing rows just show as
-- "not yet enriched" until the admin panel's "Enrich vocabulary"
-- tool (Vocabulary tab) backfills them via Claude Haiku.
-- ══════════════════════════════════════════════════════════════

alter table public.vocab_master
  add column if not exists phonetic   text,   -- simple pronunciation guide, e.g. "brah-ZEEL"
  add column if not exists word_type  text,   -- noun | verb | adjective | adverb | pronoun | preposition | conjunction | article | interjection
  add column if not exists tense      text,   -- verb tense, e.g. 'present', 'preterite' — empty if not a verb
  add column if not exists person     text,   -- grammatical person, e.g. '3rd singular' — empty if not a verb
  add column if not exists infinitive text,   -- dictionary form of a verb — empty if not a verb
  add column if not exists gender     text,   -- 'masculine' | 'feminine' — empty if not applicable
  add column if not exists article    text,   -- definite article, e.g. 'o' / 'a' — empty if not a noun
  add column if not exists usage_note text;   -- short usage/context note, same role as the translator's word note

-- Helper index so the "Enrich vocabulary" admin tool can cheaply find
-- rows that still need grammar detail generated.
create index if not exists vocab_master_needs_enrichment
  on public.vocab_master (student_id)
  where phonetic is null;
