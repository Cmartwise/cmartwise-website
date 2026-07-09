-- One-time fix: some vocab_master.term values lost their Portuguese accents
-- during the original Canva-backfill SQL generation (see the accent-stripping
-- incident, e.g. "alcancar" instead of "alcançar") -- confirmed still live in
-- production via a screenshot (portal-notes.html "My Vocabulary", 2026-07-09).
-- That earlier fix (fix-missing-accents.sql) patched known cases in coaching_notes/
-- lesson_admin_notes content; this catches the same corruption pattern in
-- vocab_master.term specifically, for ANY affected row, not just alcancar.
--
-- How: the grammar-enrichment pass (enrich-vocab edge function) derives its own
-- `infinitive` field straight from Claude's knowledge of the word, so it's
-- correctly accented even when the original `term` isn't (Claude still
-- recognises "alcancar" as alcançar despite the missing cedilla). Wherever
-- term and infinitive are literally the same word and differ only by accents/
-- case, trust the correctly-accented infinitive and repair term from it.
--
-- Safe / idempotent: only touches verb rows where infinitive is populated AND
-- unaccented-lowercased term/infinitive match exactly -- so "dar oi" (term) vs
-- "dar" (infinitive) is correctly left alone, and running this twice is a no-op
-- once term already equals infinitive.

create extension if not exists unaccent;

update vocab_master
set term = infinitive
where infinitive is not null
  and term <> infinitive
  and lower(unaccent(term)) = lower(unaccent(infinitive));
