-- One-time fix: an earlier version of the verb-detail enrichment edge
-- function permanently marked a verb as "done" (conjugations = '[]')
-- whenever the Claude call failed for ANY reason, including transient
-- Anthropic billing/rate-limit errors -- not just real content errors.
-- That made ~54 verbs look complete to the admin panel's "still need
-- full detail" count, even though they never actually got their
-- regularity / frequency / contexts / fixed_expressions / conjugations
-- filled in. The edge function itself has since been fixed (a failure
-- now just leaves the row untouched so it's naturally retried), but
-- rows already poisoned by the old behaviour need a one-time reset so
-- "Enrich verb details" will pick them up again.
--
-- Safe / idempotent: only touches rows that look exactly like the
-- poisoned signature (empty conjugations AND every other detail field
-- still null) -- a genuinely completed row always has regularity,
-- frequency and contexts populated alongside conjugations, so this
-- can't accidentally wipe real data.

update vocab_master
set conjugations = null
where conjugations = '[]'::jsonb
  and regularity is null
  and frequency is null
  and contexts is null
  and fixed_expressions is null;
