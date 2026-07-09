-- ══════════════════════════════════════════════════════════════
-- CmartWise Student Portal — Direct-note processing add-on schema
-- Run this in: Supabase Dashboard → SQL Editor → New Query
-- (Run AFTER schema.sql and schema-lesson-processing.sql.)
--
-- Backs the daily "process-direct-notes" edge function: it lets a
-- coaching_notes row created straight from the Admin "Add note" modal
-- (no transcript, no Canva export — just typed free-form) get picked up,
-- run through the same AI extraction as recorded/Canva lessons, and land
-- in the existing lesson_drafts review queue for Ika to approve.
--
-- Unlike the transcript/Canva flow, a direct note is ALREADY the
-- student-facing note (it's live in coaching_notes the moment Ika saves
-- it) — so its draft only ever needs to attach an admin brief + vocab +
-- exercises to that SAME note, never create a second one. source_note_id
-- is how a draft points back at the note it came from, and the partial
-- unique index stops the daily scan from queueing the same note twice
-- while it's sitting in the review queue.
-- ══════════════════════════════════════════════════════════════

alter table public.lesson_drafts
  add column if not exists source_note_id uuid references public.coaching_notes(id) on delete cascade;

create unique index if not exists lesson_drafts_source_note_pending_uniq
  on public.lesson_drafts (source_note_id)
  where source_note_id is not null and status = 'pending';
