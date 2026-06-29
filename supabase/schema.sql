-- ══════════════════════════════════════════════════════════════
-- CmartWise Student Portal — Supabase Schema
-- Run this in: Supabase Dashboard → SQL Editor → New Query
-- ══════════════════════════════════════════════════════════════

-- Enable UUID extension
create extension if not exists "uuid-ossp";

-- ── PROFILES ────────────────────────────────────────────────
-- Extends Supabase auth.users with display name and role
create table public.profiles (
  id        uuid references auth.users(id) on delete cascade primary key,
  full_name text not null,
  email     text not null,
  role      text not null default 'student',  -- 'student' | 'admin'
  language  text default 'pt',               -- main language being coached
  joined_at timestamptz default now()
);

-- Auto-create profile on signup
create or replace function public.handle_new_user()
returns trigger as $$
begin
  insert into public.profiles (id, full_name, email)
  values (new.id, coalesce(new.raw_user_meta_data->>'full_name', split_part(new.email, '@', 1)), new.email);
  return new;
end;
$$ language plpgsql security definer;

create trigger on_auth_user_created
  after insert on auth.users
  for each row execute procedure public.handle_new_user();

-- ── RESOURCES (shared — all students can read) ───────────────
create table public.resources (
  id          uuid default uuid_generate_v4() primary key,
  title       text not null,
  description text,
  content     text,          -- markdown / rich text
  type        text default 'document',  -- 'document' | 'link' | 'video' | 'exercise'
  url         text,          -- for external links / videos
  pinned      boolean default false,
  created_at  timestamptz default now(),
  updated_at  timestamptz default now()
);

-- ── COACHING NOTES (private per student) ────────────────────
create table public.coaching_notes (
  id           uuid default uuid_generate_v4() primary key,
  student_id   uuid references public.profiles(id) on delete cascade not null,
  title        text not null,
  content      text,          -- markdown
  session_date date default current_date,
  tags         text[],        -- e.g. ['pronunciation', 'vocabulary', 'grammar']
  pinned       boolean default false,
  created_by   uuid references public.profiles(id),  -- Ika or the student
  created_at   timestamptz default now(),
  updated_at   timestamptz default now()
);

-- ── TEST SESSIONS (stores completed test results) ────────────
create table public.test_sessions (
  id           uuid default uuid_generate_v4() primary key,
  student_id   uuid references public.profiles(id) on delete cascade not null,
  test_type    text not null,  -- 'CIPLE' | 'DIPLE' | 'GRE' | 'IELTS'
  section      text not null,  -- 'reading' | 'writing' | 'listening' | 'speaking'
  level        text,           -- 'A2' | 'B1' | 'B2' etc.
  score        numeric(5,2),   -- 0–100
  feedback     text,           -- AI feedback
  duration_sec int,            -- actual time taken
  completed_at timestamptz default now()
);

-- ══════════════════════════════════════════════════════════════
-- ROW LEVEL SECURITY
-- ══════════════════════════════════════════════════════════════

alter table public.profiles        enable row level security;
alter table public.resources       enable row level security;
alter table public.coaching_notes  enable row level security;
alter table public.test_sessions   enable row level security;

-- Helper: is the current user an admin?
create or replace function public.is_admin()
returns boolean as $$
  select exists (
    select 1 from public.profiles
    where id = auth.uid() and role = 'admin'
  );
$$ language sql security definer stable;

-- PROFILES: users see own; admin sees all
create policy "profiles_select_own"    on public.profiles for select using (id = auth.uid() or public.is_admin());
create policy "profiles_update_own"    on public.profiles for update using (id = auth.uid() or public.is_admin());

-- RESOURCES: all authenticated users can read; only admin can write
create policy "resources_read"         on public.resources for select using (auth.role() = 'authenticated');
create policy "resources_admin_write"  on public.resources for all    using (public.is_admin());

-- COACHING NOTES: students see own; admin (Ika) sees all and can write
create policy "notes_student_read"     on public.coaching_notes for select using (student_id = auth.uid() or public.is_admin());
create policy "notes_admin_write"      on public.coaching_notes for insert using (public.is_admin());
create policy "notes_admin_update"     on public.coaching_notes for update using (public.is_admin());
create policy "notes_admin_delete"     on public.coaching_notes for delete using (public.is_admin());

-- TEST SESSIONS: students see own; admin sees all; students insert own
create policy "tests_student_read"     on public.test_sessions for select using (student_id = auth.uid() or public.is_admin());
create policy "tests_student_insert"   on public.test_sessions for insert with check (student_id = auth.uid());

-- ══════════════════════════════════════════════════════════════
-- MAKE IKA AN ADMIN
-- Run this AFTER you have signed up with cmartwise@gmail.com
-- ══════════════════════════════════════════════════════════════
-- update public.profiles set role = 'admin' where email = 'cmartwise@gmail.com';
