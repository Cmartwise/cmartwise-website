-- ══════════════════════════════════════════════════════════════
-- CmartWise Student Portal — Lesson Processing add-on schema
-- Run this in: Supabase Dashboard → SQL Editor → New Query
-- (Run AFTER schema.sql. Adds AI note-processing support:
--  admin-only assessments, cumulative vocab, and practice exercises.)
-- ══════════════════════════════════════════════════════════════

-- ── LESSON ADMIN NOTES (admin-only — never shown to the student) ──
-- One row per processed session. Holds the coach-facing brief:
-- level read, what to focus on, corrections flagged, raw AI notes.
-- coaching_notes.content stays the student-facing write-up.
create table public.lesson_admin_notes (
  id                   uuid default uuid_generate_v4() primary key,
  coaching_note_id     uuid references public.coaching_notes(id) on delete cascade,
  student_id           uuid references public.profiles(id) on delete cascade not null,
  session_date         date default current_date,
  level_assessment      jsonb,        -- e.g. {"comprehension":"C1","speaking":"B2→C1"}
  what_was_covered      text[],
  coach_focus_suggestions text[],     -- what Ika should prioritise next
  corrections_flagged   text[],
  coach_notes_meta      text,         -- non-language context (e.g. business chat, personal life)
  ai_raw_summary        text,         -- full unedited model output, for reference
  coach_confirmed        boolean default false,   -- Ika has reviewed/validated
  coach_edits            text,        -- Ika's own override/addendum
  created_at             timestamptz default now()
);

-- ── VOCAB MASTER (cumulative per-student list — grows every session) ──
create table public.vocab_master (
  id                   uuid default uuid_generate_v4() primary key,
  student_id           uuid references public.profiles(id) on delete cascade not null,
  term                 text not null,
  translation          text,
  category             text,          -- e.g. 'finance', 'home', 'general'
  tags                 text[],
  first_seen_note_id   uuid references public.coaching_notes(id),
  times_reinforced     int default 1,
  last_seen_date       date default current_date,
  created_at           timestamptz default now(),
  unique (student_id, term)
);

-- ── EXERCISES (practice items / games generated from a session) ──
create table public.exercises (
  id                 uuid default uuid_generate_v4() primary key,
  student_id         uuid references public.profiles(id) on delete cascade not null,
  coaching_note_id   uuid references public.coaching_notes(id) on delete cascade,
  type               text not null,   -- 'flashcard' | 'fill_blank' | 'matching' | 'open_prompt'
  prompt             text not null,
  options            jsonb,           -- for matching/multiple choice
  answer             text,
  explanation        text,
  created_at         timestamptz default now()
);

-- ── LESSON DRAFTS (auto-generated, awaiting Ika's review in the admin panel) ──
-- The desktop lesson recorder (tools/record_lesson.py) logs in as Ika, transcribes
-- locally with Whisper, calls process-lesson itself, and drops the result here —
-- so by the time Ika opens the Admin panel, the draft is already sitting there to
-- review and publish. Nothing reaches a student until he confirms it.
create table public.lesson_drafts (
  id             uuid default uuid_generate_v4() primary key,
  student_id     uuid references public.profiles(id) on delete cascade,
  source_type    text default 'transcript',   -- 'transcript' | 'canva'
  session_date   date default current_date,
  transcript_text text,
  ai_output      jsonb,          -- full process-lesson response, ready to preview
  status         text default 'pending',  -- 'pending' | 'published' | 'discarded'
  created_at     timestamptz default now()
);

-- ══════════════════════════════════════════════════════════════
-- ROW LEVEL SECURITY
-- ══════════════════════════════════════════════════════════════

alter table public.lesson_admin_notes enable row level security;
alter table public.lesson_drafts      enable row level security;
alter table public.vocab_master       enable row level security;
alter table public.exercises          enable row level security;

-- LESSON ADMIN NOTES: admin only — students never get a policy here
create policy "admin_notes_admin_only" on public.lesson_admin_notes
  for all using (public.is_admin());

-- LESSON DRAFTS: admin only (the recorder app authenticates as Ika, so this is
-- the same admin session the website uses — no separate service key needed)
create policy "drafts_admin_only" on public.lesson_drafts
  for all using (public.is_admin());

-- VOCAB MASTER: students read their own; admin reads/writes all
create policy "vocab_student_read" on public.vocab_master
  for select using (student_id = auth.uid() or public.is_admin());
create policy "vocab_admin_write" on public.vocab_master
  for insert with check (public.is_admin());
create policy "vocab_admin_update" on public.vocab_master
  for update using (public.is_admin());
create policy "vocab_admin_delete" on public.vocab_master
  for delete using (public.is_admin());

-- EXERCISES: students read their own; admin reads/writes all
create policy "exercises_student_read" on public.exercises
  for select using (student_id = auth.uid() or public.is_admin());
create policy "exercises_admin_write" on public.exercises
  for insert with check (public.is_admin());
create policy "exercises_admin_update" on public.exercises
  for update using (public.is_admin());
create policy "exercises_admin_delete" on public.exercises
  for delete using (public.is_admin());

-- ══════════════════════════════════════════════════════════════
-- Helper: upsert a vocab term (bump times_reinforced if it already exists)
-- Used by the admin panel when publishing a processed lesson.
-- ══════════════════════════════════════════════════════════════
create or replace function public.upsert_vocab(
  p_student_id uuid, p_term text, p_translation text,
  p_category text, p_tags text[], p_note_id uuid
) returns void as $$
begin
  insert into public.vocab_master (student_id, term, translation, category, tags, first_seen_note_id)
  values (p_student_id, p_term, p_translation, p_category, p_tags, p_note_id)
  on conflict (student_id, term) do update set
    times_reinforced = public.vocab_master.times_reinforced + 1,
    last_seen_date = current_date,
    translation = coalesce(public.vocab_master.translation, excluded.translation);
end;
$$ language plpgsql security definer;
