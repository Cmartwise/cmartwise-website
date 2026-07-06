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

      const verbList = rows.map((r, i) =>
        `${i}. "${r.infinitive || r.term}" (English: "${r.translation || ''}")`
      ).join('\n')

      const prompt = `You are a European Portuguese grammar reference assistant building a detailed per-verb reference for a language-coaching student portal. Note: "Portuguese" always means European Portuguese, not Brazilian — conjugations, vocabulary and pronunciation must reflect European Portuguese specifically (e.g. "tu" forms, "comprámos" not "compramos" for the simple past, etc).

Verbs (given as their infinitive):
${verbList}

For EACH verb, in the SAME order, return full reference detail. Return ONLY valid JSON, no markdown fences, in this exact schema:
{
  "verbs": [
    {
      "regularity": "<one of: 'AR regular', 'ER regular', 'IR regular', 'Irregular' — if irregular only in specific tenses, still say 'Irregular' and note it in usage_note fields>",
      "frequency": "<one of: 'Extremely common', 'Very common', 'Common', 'Less common'>",
      "contexts": [
        {"label": "<short label for this usage, e.g. 'Literal' or 'Figurative' or 'Formal' or 'Colloquial'>", "note": "<one sentence explaining this usage>", "example_pt": "<a natural European Portuguese example sentence>", "example_en": "<its English translation>"}
      ],
      "fixed_expressions": [
        {"phrase": "<a real fixed expression or collocation using this verb>", "meaning": "<its English meaning>"}
      ],
      "conjugations": [
        {"tense": "Present", "tense_pt": "Presente do Indicativo", "usage_note": "<when this tense is used>", "forms": {"eu": "<form>", "tu": "<form>", "ele_ela_voce": "<form>", "nos": "<form>", "eles_elas_voces": "<form>"}},
        {"tense": "Simple Past", "tense_pt": "Pretérito Perfeito do Indicativo", "usage_note": "<when this tense is used>", "forms": {"eu": "<form>", "tu": "<form>", "ele_ela_voce": "<form>", "nos": "<form>", "eles_elas_voces": "<form>"}},
        {"tense": "Imperfect", "tense_pt": "Pretérito Imperfeito do Indicativo", "usage_note": "<when this tense is used>", "forms": {"eu": "<form>", "tu": "<form>", "ele_ela_voce": "<form>", "nos": "<form>", "eles_elas_voces": "<form>"}},
        {"tense": "Future", "tense_pt": "Futuro do Presente", "usage_note": "<when this tense is used>", "forms": {"eu": "<form>", "tu": "<form>", "ele_ela_voce": "<form>", "nos": "<form>", "eles_elas_voces": "<form>"}},
        {"tense": "Conditional", "ten