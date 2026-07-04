import Anthropic from 'npm:@anthropic-ai/sdk@0.27.3'

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
}

// Personal, self-hosted note processing — runs on Cédric's own Supabase project with his own
// Anthropic key. Nothing here is sent to a third-party "notes" product; it's the same model
// used for the rest of the portal (see generate-test, evaluate-speaking).
const DEFAULT_MODEL = 'claude-sonnet-5'

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders })

  try {
    const { transcript, studentName, studentProfile, sessionDate, sourceType } = await req.json()
    const isCanva = sourceType === 'canva'

    if (!transcript?.trim()) {
      return new Response(JSON.stringify({ error: 'No transcript provided.' }), {
        status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' }
      })
    }

    const spokenContent = transcript.replace(/\[\d{2}:\d{2}\]/g, '').trim()
    if (spokenContent.length < 200) {
      return new Response(JSON.stringify({
        error: `Transcript too short to generate a real lesson summary (only ${spokenContent.length} characters of actual content — a real session needs a few minutes of conversation, not just a mic test).`
      }), { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } })
    }

    const apiKey = Deno.env.get('ANTHROPIC_API_KEY')
    if (!apiKey) throw new Error('ANTHROPIC_API_KEY not set in Supabase secrets')

    const model = Deno.env.get('LESSON_MODEL') || DEFAULT_MODEL

    const SOURCE_GUIDANCE: Record<string, string> = {
      transcript: `Read the whole transcript carefully — most of it is natural conversation, not a scripted lesson, so you have to find the language-teaching content inside it (vocabulary reached for, corrections made in the moment, level markers, recurring themes). Timestamps like [12:34] are noise — ignore them.`,
      canva: `This is NOT a conversation transcript — it's extracted text from Cédric's own Canva lesson slides (his existing note-taking method: one idea per slide — vocabulary, dialogues, corrections, focus points). The content is already curated by Cédric, just unstructured as raw slide text. Your job is to reorganize it into the same schema below, not to "discover" content in dialogue. Preserve everything meaningful; don't invent level assessments you can't support from the material — if the slides don't give you enough to judge comprehension/speaking level, say "not assessed from this material" rather than guessing.`
    }

    const prompt = `You are Cédric's private lesson-processing assistant for his Portuguese coaching business (CmartWise). You turn ${isCanva ? "a set of Cédric's own lesson slide notes" : 'a raw lesson transcript'} into two very different outputs for the same session, plus supporting vocab/exercise data. ${SOURCE_GUIDANCE[isCanva ? 'canva' : 'transcript']}

Student: ${studentName || 'the student'}
Session date: ${sessionDate || 'unknown'}
${studentProfile ? `What Cédric already knows about this student: ${studentProfile}\n` : ''}

${isCanva ? 'SLIDE NOTES (raw extracted text, slide breaks may be lost)' : 'TRANSCRIPT'}:
"""
${transcript}
"""

Produce ONLY valid JSON (no markdown fences), matching this schema exactly:

{
  "session_title": "<short descriptive title, e.g. 'Private Equity, Well Water & Portal Feedback'>",
  "admin_summary": {
    "level_assessment": {"comprehension": "<CEFR level>", "speaking": "<CEFR level, can be a range like 'B2 → C1'>"},
    "what_was_covered": ["<3-6 short bullet facts about session content>"],
    "coach_focus_suggestions": ["<2-4 concrete things Cédric should prioritise in upcoming sessions, based on real gaps or opportunities you noticed>"],
    "corrections_flagged": ["<specific errors or near-misses the student made, with the correct form>"],
    "coach_notes_meta": "<1-3 sentences on anything non-language but relevant to the coaching relationship — e.g. business/personal context that came up, feedback the student gave about the portal or notes format>"
  },
  "student_notes_markdown": "<the SAME session, rewritten as if Cédric personally wrote it directly to the student after the lesson. Second person ('you'), warm, specific, encouraging, honest — never clinical or generic. Use markdown headings (##) for sections like 'What we covered', 'Vocabulary & expressions', 'How you're doing', 'Try this before next time'. Reference actual things the student said or asked about. Do NOT mention 'transcript' or 'AI' or sound like a report — it should read like a coach's note.>",
  "vocab_additions": [{"term": "<PT term>", "translation": "<EN>", "category": "<short topic label>", "tags": ["<1-3 tags>"]}],
  "exercises": [
    {"type": "flashcard", "prompt": "<PT term or short phrase>", "answer": "<EN translation or explanation>", "explanation": "<optional context tying it back to what they discussed>"},
    {"type": "fill_blank", "prompt": "<PT sentence with ___ where a word from this session goes>", "answer": "<the missing word>", "explanation": "<why/context>"},
    {"type": "open_prompt", "prompt": "<a short speaking/writing prompt in PT that reuses today's themes so the student practises actively recalling the vocabulary>", "answer": "", "explanation": "<what good use of today's vocab would look like>"}
  ]
}

Guidelines:
- Base everything on what's actually in the ${isCanva ? 'slide notes' : 'transcript'}. Don't invent vocabulary or corrections that didn't come up.
- vocab_additions should be genuinely new/reinforced terms from THIS session only (roughly 8-16 items), not a generic list.
- exercises: produce 5-8 total across the three types, mixing topics that came up (don't just do one theme).
- The student_notes_markdown must sound like Cédric, not like a report about Cédric. No "the student demonstrated..." language anywhere in it.
- Keep coach_focus_suggestions specific and actionable, not generic ("keep practising vocabulary" is not acceptable).`

    const client = new Anthropic({ apiKey })
    const message = await client.messages.create({
      model,
      max_tokens: 4000,
      messages: [{ role: 'user', content: prompt }]
    })

    const textBlock = message.content.find((b): b is { type: 'text'; text: string } => b.type === 'text')
    if (!textBlock) throw new Error('Model response had no text content block — got: ' + message.content.map(b => b.type).join(', '))
    const raw = textBlock.text.trim()
    const clean = raw.replace(/^```(?:json)?\n?/, '').replace(/\n?```$/, '').trim()

    let parsed
    try {
      parsed = JSON.parse(clean)
    } catch {
      // Fall back to pulling out the largest {...} block, in case the model
      // added any stray commentary before/after the JSON.
      const match = clean.match(/\{[\s\S]*\}/)
      if (!match) {
        throw new Error(
          `Model didn't return valid JSON (transcript may be too short/empty to work with). First 300 chars of its reply: ${clean.slice(0, 300)}`
        )
      }
      parsed = JSON.parse(match[0])
    }

    return new Response(JSON.stringify(parsed), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' }
    })
  } catch (e) {
    return new Response(JSON.stringify({ error: e instanceof Error ? e.message : String(e) }), {
      status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' }
    })
  }
})
