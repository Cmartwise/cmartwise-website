import Anthropic from 'npm:@anthropic-ai/sdk@0.27.3'
import { createClient } from 'npm:@supabase/supabase-js@2'

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
}

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  })
}

// Claude occasionally emits a raw, unescaped newline (or tab) inside a JSON
// string value — usually a long example sentence or usage note that got
// line-wrapped instead of kept on one line. That produces a technically
// invalid JSON payload ("Unterminated string...") that JSON.parse rejects
// outright even though the content itself is fine. This walks the raw text
// tracking whether we're inside a string (respecting \" escapes) and
// re-escapes any literal newline/tab found there, so a single stray line
// break doesn't blow up the whole response.
function sanitizeJsonStrings(text: string): string {
  let out = ''
  let inString = false
  let escaped = false
  for (let i = 0; i < text.length; i++) {
    const ch = text[i]
    if (inString) {
      if (escaped) { out += ch; escaped = false; continue }
      if (ch === '\\') { out += ch; escaped = true; continue }
      if (ch === '"') { inString = false; out += ch; continue }
      if (ch === '\n') { out += '\\n'; continue }
      if (ch === '\r') { continue }
      if (ch === '\t') { out += '\\t'; continue }
      out += ch
    } else {
      if (ch === '"') inString = true
      out += ch
    }
  }
  return out
}

function parseJsonLoose(raw: string): any {
  const clean = raw.trim().replace(/^```(?:json)?\n?/, '').replace(/\n?```$/, '').trim()
  try {
    return JSON.parse(clean)
  } catch {
    // Fall back to the sanitized version rather than failing outright.
    return JSON.parse(sanitizeJsonStrings(clean))
  }
}

// Two enrichment passes over vocab_master, both admin-only (runs under the
// caller's own session so RLS/is_admin() gates it, no service-role key needed):
//
// mode 'basic' (default) — phonetic, word_type, tense, person, infinitive,
// gender, article, usage_note. Same grammar schema as the Language Tools
// translator's word breakdown. Cheap, runs over every vocab_master row.
//
// mode 'verb-detail' — regularity, frequency, usage contexts with PT/EN
// examples, fixed expressions/collocations, and full conjugation tables
// (5 tenses × 5 persons). Only makes sense for verbs, so it only selects
// rows already identified as a verb (word_type='verb' or a populated
// infinitive from the basic pass). Heavier output per item, so smaller
// batches. Content structure is modelled on Ika's "Verbos do Dia a Dia"
// reference PDF — same information, rendered in the site's own card style.
//
// mode 'accents' — proofreads term/infinitive for missing/wrong Portuguese
// diacritics (fixes data-migration damage like "alcancar" -> "alcançar").
// Gated by accents_checked (schema-vocab-accents-checked.sql) rather than
// a null grammar field, so it sweeps the WHOLE table over repeated runs —
// old rows and anything added later — not just unenriched ones.
Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders })

  try {
    const authHeader = req.headers.get('Authorization') || ''
    const supabaseUrl = Deno.env.get('SUPABASE_URL')
    const anonKey = Deno.env.get('SUPABASE_ANON_KEY')
    if (!supabaseUrl || !anonKey) throw new Error('Supabase URL/anon key not available to this function.')

    const supabase = createClient(supabaseUrl, anonKey, {
      global: { headers: { Authorization: authHeader } },
    })

    const { data: { user } } = await supabase.auth.getUser()
    if (!user) return json({ error: 'Not authenticated.' }, 401)

    const { data: profile } = await supabase.from('profiles').select('role').eq('id', user.id).single()
    if (profile?.role !== 'admin') return json({ error: 'Admin only.' }, 403)

    const body = await req.json().catch(() => ({}))
    const studentId: string | undefined = body.studentId || undefined
    const mode: string = body.mode === 'verb-detail' ? 'verb-detail' : body.mode === 'accents' ? 'accents' : 'basic'
    const defaultBatch = mode === 'verb-detail' ? 3 : mode === 'accents' ? 20 : 12
    const maxBatch = mode === 'verb-detail' ? 6 : mode === 'accents' ? 40 : 20
    const batchSize = Math.min(Math.max(Number(body.batchSize) || defaultBatch, 1), maxBatch)

    const apiKey = Deno.env.get('ANTHROPIC_API_KEY')
    if (!apiKey) throw new Error('ANTHROPIC_API_KEY not set in Supabase secrets')
    const client = new Anthropic({ apiKey })

    if (mode === 'verb-detail') {
      let selectQuery = supabase
        .from('vocab_master')
        .select('id, term, translation, infinitive, word_type')
        .is('conjugations', null)
        .or('word_type.eq.verb,infinitive.not.is.null')
        .order('created_at', { ascending: true })
        .limit(batchSize)
      if (studentId) selectQuery = selectQuery.eq('student_id', studentId)

      const { data: rows, error: selErr } = await selectQuery
      if (selErr) throw new Error(selErr.message)

      const countRemaining = async () => {
        let q = supabase
          .from('vocab_master')
          .select('id', { count: 'exact', head: true })
          .is('conjugations', null)
          .or('word_type.eq.verb,infinitive.not.is.null')
        if (studentId) q = q.eq('student_id', studentId)
        const { count } = await q
        return count || 0
      }

      if (!rows || rows.length === 0) {
        return json({ done: true, processed: 0, remaining: 0 })
      }

      // One Claude call PER VERB (not one call for the whole batch). A verb
      // whose response comes back malformed only costs that one verb — it
      // doesn't take the other 2-5 verbs in the batch down with it.
      let updated = 0
      const failures: string[] = []
      const skipped: string[] = []

      for (const r of rows) {
        const verbLabel = r.infinitive || r.term
        try {
          const prompt = `You are a European Portuguese grammar reference assistant building a detailed reference entry for a language-coaching student portal. Note: "Portuguese" always means European Portuguese, not Brazilian — conjugations, vocabulary and pronunciation must reflect European Portuguese specifically (e.g. "tu" forms, "comprámos" not "compramos" for the simple past, etc).

Verb (infinitive): "${verbLabel}" (English: "${r.translation || ''}")

Return full reference detail for this one verb. Return ONLY valid JSON, no markdown fences, in this exact schema:
{
  "regularity": "<one of: 'AR regular', 'ER regular', 'IR regular', 'Irregular'>",
  "frequency": "<one of: 'Extremely common', 'Very common', 'Common', 'Less common'>",
  "contexts": [
    {"label": "<short label, e.g. 'Literal' or 'Figurative' or 'Formal' or 'Colloquial'>", "note": "<one sentence explaining this usage>", "example_pt": "<a natural European Portuguese example sentence>", "example_en": "<its English translation>"}
  ],
  "fixed_expressions": [
    {"phrase": "<a real fixed expression or collocation using this verb>", "meaning": "<its English meaning>"}
  ],
  "conjugations": [
    {"tense": "Present", "tense_pt": "Presente do Indicativo", "usage_note": "<when this tense is used>", "forms": {"eu": "<form>", "tu": "<form>", "ele_ela_voce": "<form>", "nos": "<form>", "eles_elas_voces": "<form>"}},
    {"tense": "Simple Past", "tense_pt": "Pretérito Perfeito do Indicativo", "usage_note": "<when this tense is used>", "forms": {"eu": "<form>", "tu": "<form>", "ele_ela_voce": "<form>", "nos": "<form>", "eles_elas_voces": "<form>"}},
    {"tense": "Imperfect", "tense_pt": "Pretérito Imperfeito do Indicativo", "usage_note": "<when this tense is used>", "forms": {"eu": "<form>", "tu": "<form>", "ele_ela_voce": "<form>", "nos": "<form>", "eles_elas_voces": "<form>"}},
    {"tense": "Future", "tense_pt": "Futuro do Presente", "usage_note": "<when this tense is used>", "forms": {"eu": "<form>", "tu": "<form>", "ele_ela_voce": "<form>", "nos": "<form>", "eles_elas_voces": "<form>"}},
    {"tense": "Conditional", "tense_pt": "Condicional", "usage_note": "<when this tense is used>", "forms": {"eu": "<form>", "tu": "<form>", "ele_ela_voce": "<form>", "nos": "<form>", "eles_elas_voces": "<form>"}}
  ]
}

Include 2-3 contexts (a mix of literal/figurative or formal/colloquial where the verb genuinely has that range — don't force a distinction that doesn't exist). Include 2-5 fixed_expressions where genuinely common ones exist; an empty array is fine otherwise. All 5 conjugation tenses are required, fully conjugated for all 5 persons, even if irregular. IMPORTANT: every string value must stay on a single line — never insert a literal line break inside a string, use a plain space instead — and escape any double-quote character that appears inside a string value as \\".

If "${verbLabel}" is NOT actually a verb (e.g. it's really a noun, adjective, place name, or a multi-word phrase with no true infinitive) — this can happen because it was miscategorized by an earlier automated pass — do not attempt to force conjugations onto it. Instead return ONLY this JSON: {"not_a_verb": true}`

          const message = await client.messages.create({
            model: 'claude-sonnet-5',
            max_tokens: 3000,
            messages: [{ role: 'user', content: prompt }],
          })

          const textBlock = message.content.find((b): b is { type: 'text'; text: string } => b.type === 'text')
          if (!textBlock) throw new Error('Model response had no text content block.')
          const v = parseJsonLoose(textBlock.text)

          if (v?.not_a_verb) {
            // Genuinely not a verb (miscategorized by an earlier pass) —
            // mark it "handled" with an empty (non-null) conjugations array
            // so it stops matching this query forever instead of failing
            // and being re-picked-up every single run.
            const { error: skipErr } = await supabase
              .from('vocab_master')
              .update({ conjugations: [] })
              .eq('id', r.id)
            if (skipErr) throw new Error(skipErr.message)
            skipped.push(verbLabel)
            continue
          }

          const { error: updErr } = await supabase
            .from('vocab_master')
            .update({
              regularity: v?.regularity || null,
              frequency: v?.frequency || null,
              contexts: Array.isArray(v?.contexts) ? v.contexts : null,
              fixed_expressions: Array.isArray(v?.fixed_expressions) ? v.fixed_expressions : null,
              conjugations: Array.isArray(v?.conjugations) && v.conjugations.length ? v.conjugations : [],
            })
            .eq('id', r.id)
          if (updErr) throw new Error(updErr.message)
          updated++
        } catch (e) {
          // Deliberately leave the row untouched (still null) so it's picked
          // up again next run. Most real-world failures here are transient —
          // rate limits, an out-of-credits Anthropic account, a momentary
          // model hiccup — not something permanently wrong with the verb
          // itself, so giving up on it forever would be the wrong default.
          // If the exact same verb keeps failing across many runs, that'll
          // show up repeatedly in `failures` and is worth investigating by
          // hand rather than silently blacklisting it here.
          failures.push(`${verbLabel}: ${e instanceof Error ? e.message : String(e)}`)
        }
      }

      const remaining = await countRemaining()
      return json({ done: remaining === 0, processed: updated, remaining, failed: failures.length, failures, skipped: skipped.length, skippedTerms: skipped })
    }

    if (mode === 'accents') {
      // Some rows lost their Portuguese diacritics during the original
      // Canva-backfill SQL generation (e.g. "alcancar"/"armacao" instead of
      // "alcançar"/"armação") — sometimes on term only, sometimes on both
      // term and infinitive. This pass runs over EVERY row (old and new,
      // gated by accents_checked so it's resumable and self-maintaining as
      // fresh vocab comes in), asks Claude to correct diacritics only —
      // never to change the actual word, translation, or anything else —
      // and marks each row checked whether or not a correction was needed.
      let selectQuery = supabase
        .from('vocab_master')
        .select('id, term, translation, infinitive, category')
        .eq('accents_checked', false)
        .order('created_at', { ascending: true })
        .limit(batchSize)
      if (studentId) selectQuery = selectQuery.eq('student_id', studentId)

      const { data: rows, error: selErr } = await selectQuery
      if (selErr) throw new Error(selErr.message)

      const countRemaining = async () => {
        let q = supabase.from('vocab_master').select('id', { count: 'exact', head: true }).eq('accents_checked', false)
        if (studentId) q = q.eq('student_id', studentId)
        const { count } = await q
        return count || 0
      }

      if (!rows || rows.length === 0) {
        return json({ done: true, processed: 0, remaining: 0 })
      }

      const wordList = rows.map((r, i) =>
        `${i}. term="${r.term}"${r.infinitive ? `, infinitive="${r.infinitive}"` : ''} (English: "${r.translation || ''}")`
      ).join('\n')

      const prompt = `You are proofreading European Portuguese vocabulary entries for missing or wrong diacritics/accents (ã, õ, ç, á, é, í, ó, ú, â, ê, ô, à) — these were lost for some entries during an earlier data-migration bug (e.g. "alcancar" should be "alcançar", "armacao" should be "armação").

Items:
${wordList}

For EACH item, in the SAME order, return the correctly-accented European Portuguese spelling. Return ONLY valid JSON, no markdown fences, in this exact schema:
{
  "words": [
    {"term": "<the term with correct accents — IDENTICAL to the input if it was already correct>", "infinitive": "<the infinitive with correct accents, or empty string if the input had no infinitive>"}
  ]
}

Critical rules:
- Fix ONLY diacritics/accents. Never change spelling otherwise, never change the actual word, never "improve" or translate anything.
- If an entry is already correctly accented, return it completely unchanged.
- The "words" array MUST have exactly ${rows.length} entries, in the same order as the numbered list above.`

      const message = await client.messages.create({
        model: 'claude-sonnet-5',
        max_tokens: 3000,
        messages: [{ role: 'user', content: prompt }],
      })

      const textBlock = message.content.find((b): b is { type: 'text'; text: string } => b.type === 'text')
      if (!textBlock) throw new Error('Model response had no text content block.')
      const parsed = parseJsonLoose(textBlock.text)
      const words = Array.isArray(parsed.words) ? parsed.words : []

      let updated = 0
      let corrected = 0
      for (let i = 0; i < rows.length; i++) {
        const r = rows[i]
        const w = words[i] || {}
        const newTerm = (w.term || r.term || '').trim()
        const newInfinitive = r.infinitive ? (w.infinitive || r.infinitive || '').trim() : r.infinitive
        if (newTerm !== r.term || newInfinitive !== r.infinitive) corrected++

        const { error: updErr } = await supabase
          .from('vocab_master')
          .update({ term: newTerm, infinitive: newInfinitive, accents_checked: true })
          .eq('id', r.id)
        if (!updErr) updated++
      }

      const remaining = await countRemaining()
      return json({ done: remaining === 0, processed: updated, corrected, remaining })
    }

    // ── mode === 'basic' ──
    let selectQuery = supabase
      .from('vocab_master')
      .select('id, term, translation, category')
      .is('phonetic', null)
      .order('created_at', { ascending: true })
      .limit(batchSize)
    if (studentId) selectQuery = selectQuery.eq('student_id', studentId)

    const { data: rows, error: selErr } = await selectQuery
    if (selErr) throw new Error(selErr.message)

    const countRemaining = async () => {
      let q = supabase.from('vocab_master').select('id', { count: 'exact', head: true }).is('phonetic', null)
      if (studentId) q = q.eq('student_id', studentId)
      const { count } = await q
      return count || 0
    }

    if (!rows || rows.length === 0) {
      return json({ done: true, processed: 0, remaining: 0 })
    }

    const wordList = rows.map((r, i) => `${i}. "${r.term}" (translation given: "${r.translation || ''}", topic: "${r.category || 'general'}")`).join('\n')

    const prompt = `You are a European Portuguese grammar reference assistant helping enrich a language-coaching vocabulary list. Note: "Portuguese" always means European Portuguese, not Brazilian. Each item below is a word or short phrase a student has already learned, with its existing English translation (may be blank or approximate).

Items:
${wordList}

For EACH item, in the SAME order, return its grammar detail. Return ONLY valid JSON, no markdown fences, in this exact schema:
{
  "words": [
    {"phonetic": "<simple pronunciation guide, readable by an English speaker with no IPA training>", "word_type": "<one of: noun, verb, adjective, adverb, pronoun, preposition, conjunction, article, interjection, phrase>", "tense": "<verb tense e.g. 'present', 'preterite', 'imperfect' — empty string if not a verb>", "person": "<grammatical person e.g. '1st plural', '3rd singular' — empty string if not a verb>", "infinitive": "<the verb's infinitive/dictionary form — empty string if not a verb>", "gender": "<'masculine' or 'feminine' for nouns/adjectives with grammatical gender — empty string otherwise>", "article": "<the definite article that pairs with this noun, e.g. 'o'/'a' — empty string if not a noun>", "usage_note": "<one short, genuinely useful note — a false-friend warning, register note, or common trap — empty string if nothing noteworthy>"}
  ]
}

The "words" array MUST have exactly ${rows.length} entries, in the same order as the numbered list above. If an item is a multi-word phrase rather than a single grammatical word, still classify it as best you can (often "phrase" or the type of its head word) and leave tense/person/gender/article empty unless clearly applicable. Keep it concise.`

    const message = await client.messages.create({
      model: 'claude-haiku-4-5-20251001',
      max_tokens: 3000,
      messages: [{ role: 'user', content: prompt }],
    })

    const textBlock = message.content.find((b): b is { type: 'text'; text: string } => b.type === 'text')
    if (!textBlock) throw new Error('Model response had no text content block.')
    const parsed = parseJsonLoose(textBlock.text)
    const words = Array.isArray(parsed.words) ? parsed.words : []

    let updated = 0
    for (let i = 0; i < rows.length; i++) {
      const r = rows[i]
      const w = words[i] || {}
      const { error: updErr } = await supabase
        .from('vocab_master')
        .update({
          phonetic: w.phonetic || null,
          word_type: w.word_type || null,
          tense: w.tense || null,
          person: w.person || null,
          infinitive: w.infinitive || null,
          gender: w.gender || null,
          article: w.article || null,
          usage_note: w.usage_note || null,
        })
        .eq('id', r.id)
      if (!updErr) updated++
    }

    const remaining = await countRemaining()
    return json({ done: remaining === 0, processed: updated, remaining })
  } catch (e) {
    return json({ error: e instanceof Error ? e.message : String(e) }, 500)
  }
})
