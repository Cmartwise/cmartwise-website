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

// Same "stray unescaped newline inside a JSON string" recovery used by
// enrich-vocab — Claude occasionally line-wraps a long example inside a
// string value, which breaks JSON.parse even though the content is fine.
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
    try {
      return JSON.parse(sanitizeJsonStrings(clean))
    } catch {
      const match = clean.match(/\{[\s\S]*\}/)
      if (!match) throw new Error(`Model didn't return valid JSON. First 300 chars: ${clean.slice(0, 300)}`)
      return JSON.parse(sanitizeJsonStrings(match[0]))
    }
  }
}

const DEFAULT_MODEL = 'claude-sonnet-5'
const MAX_NOTES_PER_RUN = 8  // bounds one run's cost/runtime; any backlog drains over subsequent days

// Runs headless (no logged-in browser session) — triggered once a day by a
// Cowork scheduled task. Deployed with --no-verify-jwt like generate-test
// and evaluate-speaking, so it uses the service-role key (auto-available to
// every edge function, no extra secret to set) to read/write past RLS.
//
// What it does NOT do: create a new coaching_notes row, or touch the
// student-facing note text. A "direct note" (typed straight into the Admin
// "Add note" modal, no transcript/Canva involved) is already final and
// already live the moment Ika saved it — this only extracts an admin
// brief + vocab + exercises FROM it and drops that into the existing
// lesson_drafts review queue, same as the transcript/Canva flow, so
// nothing reaches vocab_master/exercises without Ika approving it in
// Admin > Process Lesson > Pending review.
Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders })

  try {
    const supabaseUrl = Deno.env.get('SUPABASE_URL')
    const serviceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')
    const apiKey = Deno.env.get('ANTHROPIC_API_KEY')
    if (!supabaseUrl || !serviceKey) throw new Error('SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY not available to this function.')
    if (!apiKey) throw new Error('ANTHROPIC_API_KEY not set in Supabase secrets.')

    const supabase = createClient(supabaseUrl, serviceKey)
    const model = Deno.env.get('LESSON_MODEL') || DEFAULT_MODEL

    // 1) Candidates: coaching_notes with no admin brief yet AND not already
    //    sitting in the review queue (or previously discarded from it).
    const [{ data: notes, error: notesErr }, { data: briefs }, { data: drafts }] = await Promise.all([
      supabase.from('coaching_notes')
        .select('id, student_id, title, content, session_date, profiles!coaching_notes_student_id_fkey(full_name, email)')
        .order('session_date', { ascending: true }),
      supabase.from('lesson_admin_notes').select('coaching_note_id'),
      supabase.from('lesson_drafts').select('source_note_id').not('source_note_id', 'is', null),
    ])
    if (notesErr) throw notesErr

    const processedIds = new Set((briefs || []).map((b: any) => b.coaching_note_id))
    const queuedIds = new Set((drafts || []).map((d: any) => d.source_note_id))
    const candidates = (notes || [])
      .filter((n: any) => !processedIds.has(n.id) && !queuedIds.has(n.id) && (n.content || '').trim().length >= 40)
      .slice(0, MAX_NOTES_PER_RUN)

    if (!candidates.length) {
      return json({ scanned: notes?.length || 0, queued: 0, message: 'Nothing new to process.' })
    }

    const client = new Anthropic({ apiKey })
    let queued = 0
    const errors: string[] = []

    for (const note of candidates) {
      try {
        const studentName = note.profiles?.full_name || note.profiles?.email || 'the student'
        const prompt = `You are Cédric's private lesson-processing assistant for his Portuguese coaching business (CmartWise). Below is a coaching note Cédric typed directly into the student portal himself, right after a lesson — it is written AS Cédric TO the student, second person, and it is ALREADY FINAL and already visible to the student. Do not rewrite it, summarise it back to itself, or invent a version of it — your only job is to extract structured data FROM it for Cédric's own private use.

Student: ${studentName}
Session date: ${note.session_date || 'unknown'}
Note title: ${note.title || '(untitled)'}

NOTE (already sent to the student):
"""
${note.content}
"""

Produce ONLY valid JSON (no markdown fences), matching this schema exactly:

{
  "session_title": "<short descriptive title for this session, e.g. 'Private Equity, Well Water & Portal Feedback'>",
  "admin_summary": {
    "level_assessment": {"comprehension": "<CEFR level, or 'not assessed from this material' if the note doesn't support a judgement>", "speaking": "<CEFR level or range like 'B2 → C1', or 'not assessed from this material'>"},
    "what_was_covered": ["<3-6 short bullet facts about session content, drawn only from the note>"],
    "coach_focus_suggestions": ["<2-4 concrete things Cédric should prioritise in upcoming sessions, based on real gaps/opportunities visible in the note>"],
    "corrections_flagged": ["<specific errors or near-misses mentioned in the note, with the correct form — empty array if none are mentioned>"],
    "coach_notes_meta": "<1-3 sentences on anything non-language but relevant to the coaching relationship, if present in the note — empty string if none>"
  },
  "vocab_additions": [{"term": "<PT term>", "translation": "<EN>", "category": "<short topic label>", "tags": ["<1-3 tags>"]}],
  "exercises": [
    {"type": "flashcard", "prompt": "<PT term or short phrase>", "answer": "<EN translation or explanation>", "explanation": "<optional context tying it back to the note>"},
    {"type": "fill_blank", "prompt": "<PT sentence with ___ where a word from this session goes>", "answer": "<the missing word>", "explanation": "<why/context>"},
    {"type": "open_prompt", "prompt": "<a short speaking/writing prompt in PT that reuses today's themes so the student practises actively recalling the vocabulary>", "answer": "", "explanation": "<what good use of today's vocab would look like>"}
  ]
}

Guidelines:
- Base everything strictly on what's actually written in the note. Never invent vocabulary, corrections, or content that isn't there.
- vocab_additions: genuinely new/reinforced terms from THIS note only (roughly 5-16 items depending on how much the note contains) — skip this entirely (empty array) if the note is too short/thin to responsibly extract from.
- exercises: 3-8 total across the three types, based on topics that actually appear in the note.
- Keep coach_focus_suggestions specific and actionable, not generic ("keep practising vocabulary" is not acceptable).
- Every Portuguese word/phrase (vocab_additions terms, exercise prompts/answers) MUST keep its correct diacritics (ã, õ, ç, á, é, í, ó, ú, â, ê, ô, à) — never strip accents.`

        const message = await client.messages.create({
          model,
          max_tokens: 4000,
          messages: [{ role: 'user', content: prompt }],
        })
        const textBlock = message.content.find((b): b is { type: 'text'; text: string } => b.type === 'text')
        if (!textBlock) throw new Error('Model response had no text content block.')
        const parsed = parseJsonLoose(textBlock.text)

        const { error: insertErr } = await supabase.from('lesson_drafts').insert({
          student_id: note.student_id,
          source_type: 'direct_note',
          source_note_id: note.id,
          session_date: note.session_date,
          transcript_text: note.content,
          ai_output: parsed,
          status: 'pending',
        })
        if (insertErr) throw insertErr
        queued++
      } catch (e) {
        errors.push(`${note.id}: ${e instanceof Error ? e.message : String(e)}`)
      }
    }

    return json({ scanned: notes?.length || 0, candidates: candidates.length, queued, errors })
  } catch (e) {
    return json({ error: e instanceof Error ? e.message : String(e) }, 500)
  }
})
