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

// Backfills grammar detail (phonetic, word_type, tense, person, infinitive,
// gender, article, usage_note) onto vocab_master rows, using the same model
// and grammar schema as the Language Tools translator's word breakdown —
// so "My Vocabulary" can render each term with identical treatment.
// Admin-only: runs under the caller's own session so RLS (is_admin()) gates it,
// no service-role key needed. Call this repeatedly (once per batch) from the
// admin panel until { done: true }.
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
    const batchSize = Math.min(Math.max(Number(body.batchSize) || 12, 1), 20)

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

    const apiKey = Deno.env.get('ANTHROPIC_API_KEY')
    if (!apiKey) throw new Error('ANTHROPIC_API_KEY not set in Supabase secrets')

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

    const client = new Anthropic({ apiKey })
    const message = await client.messages.create({
      model: 'claude-haiku-4-5-20251001',
      max_tokens: 3000,
      messages: [{ role: 'user', content: prompt }],
    })

    const textBlock = message.content.find((b): b is { type: 'text'; text: string } => b.type === 'text')
    if (!textBlock) throw new Error('Model response had no text content block.')
    const raw = textBlock.text.trim()
    const clean = raw.replace(/^```(?:json)?\n?/, '').replace(/\n?```$/, '').trim()
    const parsed = JSON.parse(clean)
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
