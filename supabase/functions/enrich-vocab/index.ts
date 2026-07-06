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
    const mode: string = body.mode === 'verb-detail' ? 'verb-detail' : 'basic'
    const defaultBatch = mode === 'verb-detail' ? 3 : 12
    const maxBatch = mode === 'verb-detail' ? 6 : 20
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

      for (const r of rows) {
        const verbLabel = r.infinitive || r.term
        try {
          const prompt = `You are a European Portuguese grammar reference assistant building a detailed reference entry for a language-coaching student portal. Note: "Portuguese" always means European Portuguese, not Brazilian — conjugations, vocabulary and pronunciation must reflect European Portuguese specifically (e.g. "tu" forms, "comprámos" not "compramos" for the simple past, etc).

Verb (infinitive): "${verbLabel}" (English: "${r.translation || ''}")

Return full reference detail for this one verb. Return ONLY valid JSON, no markdown fences, in this ex