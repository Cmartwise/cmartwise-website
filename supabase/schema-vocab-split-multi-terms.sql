-- ══════════════════════════════════════════════════════════════
-- CmartWise Student Portal — split combined multi-item vocab rows
-- Run this in: Supabase Dashboard → SQL Editor → New Query
-- (Safe to run once. Idempotent — re-running finds nothing left to split.)
--
-- Why: some vocab_master rows were saved as one row holding several
-- alternatives joined by " / ", e.g. term = "olhar / assistir / ver",
-- translation = "look / watch / see", infinitive = "olhar / assistir / ver".
-- Ika wants each verb/word on its own line in "My Vocabulary" — this
-- splits every such row (for every student, not just one) into one row
-- per item, then removes the original combined row.
--
-- Does NOT touch genuine single-concept grammar rows like "para vs por"
-- or "future & conditional tense" — those don't contain " / " in `term`.
-- ══════════════════════════════════════════════════════════════

do $$
declare
  r record;
  terms         text[];
  translations  text[];
  phonetics     text[];
  infinitives   text[];
  n             int;
  i             int;
begin
  for r in
    select * from public.vocab_master
    where term like '% / %'
  loop
    terms := regexp_split_to_array(trim(r.term), '\s*/\s*');
    n := array_length(terms, 1);
    if n > 1 then

      translations := case when r.translation is not null and r.translation like '% / %'
                              and array_length(regexp_split_to_array(trim(r.translation), '\s*/\s*'), 1) = n
                           then regexp_split_to_array(trim(r.translation), '\s*/\s*')
                           else null end;

      phonetics := case when r.phonetic is not null and r.phonetic like '% / %'
                           and array_length(regexp_split_to_array(trim(r.phonetic), '\s*/\s*'), 1) = n
                        then regexp_split_to_array(trim(r.phonetic), '\s*/\s*')
                        else null end;

      infinitives := case when r.infinitive is not null and r.infinitive like '% / %'
                             and array_length(regexp_split_to_array(trim(r.infinitive), '\s*/\s*'), 1) = n
                          then regexp_split_to_array(trim(r.infinitive), '\s*/\s*')
                          else null end;

      for i in 1..n loop
        insert into public.vocab_master
          (student_id, term, translation, category, tags, first_seen_note_id,
           times_reinforced, last_seen_date, phonetic, word_type, tense, person,
           infinitive, gender, article, usage_note)
        values (
          r.student_id,
          trim(terms[i]),
          case when translations is not null then trim(translations[i]) else r.translation end,
          r.category,
          r.tags,
          r.first_seen_note_id,
          r.times_reinforced,
          r.last_seen_date,
          case when phonetics is not null then trim(phonetics[i]) else null end,
          r.word_type,
          r.tense,
          r.person,
          case when infinitives is not null then trim(infinitives[i]) else trim(terms[i]) end,
          r.gender,
          r.article,
          r.usage_note
        )
        on conflict (student_id, term) do update set
          translation      = coalesce(public.vocab_master.translation, excluded.translation),
          phonetic         = coalesce(public.vocab_master.phonetic, excluded.phonetic),
          infinitive       = coalesce(public.vocab_master.infinitive, excluded.infinitive),
          word_type        = coalesce(public.vocab_master.word_type, excluded.word_type),
          category         = coalesce(public.vocab_master.category, excluded.category),
          usage_note       = coalesce(public.vocab_master.usage_note, excluded.usage_note),
          times_reinforced = public.vocab_master.times_reinforced + 1;
      end loop;

      delete from public.vocab_master where id = r.id;
    end if;
  end loop;
end $$;

-- Verify: should return zero rows once the migration has run.
select * from public.vocab_master where term like '% / %';
