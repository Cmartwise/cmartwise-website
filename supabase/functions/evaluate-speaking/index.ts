import Anthropic from 'npm:@anthropic-ai/sdk@0.27.3'

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders })

  try {
    const { transcript, prompt, language, level, rubric } = await req.json()

    if (!transcript?.trim()) {
      return new Response(JSON.stringify({
        overall_score: 0,
        scores: {},
        strengths: [],
        improvements: ['No speech was recorded.'],
        coach_note: 'Try again — make sure your microphone is allowed in the browser.'
      }), { headers: { ...corsHeaders, 'Content-Type': 'application/json' } })
    }

    const apiKey = Deno.env.get('ANTHROPIC_API_KEY')
    if (!apiKey) throw new Error('ANTHROPIC_API_KEY not set in Supabase secrets')

    const rubricText = rubric ? Object.entries(rubric).map(([k,v]) => `- ${k}: ${v}`).join('\n') : ''
    const isPortuguese = language === 'Portuguese'
    const levelLabel = { CIPLE: 'A2', DIPLE: 'B1-B2', IELTS: 'B1-C1', GRE: 'C1+' }[level] || level

    const evaluationPrompt = `You are an experienced ${isPortuguese ? 'European Portuguese' : 'English'} language examiner evaluating a ${level} (${levelLabel}) speaking test.

Prompt given to student: "${prompt}"

Student's spoken response (transcribed):
"${transcript}"

${rubricText ? `Evaluation rubric:\n${rubricText}\n` : ''}

Evaluate this response and return ONLY valid JSON, no markdown fences:
{
  "overall_score": <0-100 integer>,
  "scores": {${Object.keys(rubric || {fluency:'',vocabulary:'',grammar:''}).map(k => `"${k}": <0-100>`).join(', ')}},
  "strengths": ["<2-3 specific things done well>"],
  "improvements": ["<2-3 specific, actionable things to work on>"],
  "corrected_excerpt": "<if there are grammatical errors, show 1-2 corrected sentences from the transcript>",
  "coach_note": "<1-2 sentence personal note from the coach, warm and encouraging tone, signed as Cédric>"
}`

    const client = new Anthropic({ apiKey })
    const message = await client.messages.create({
      model: 'claude-haiku-4-5-20251001',
      max_tokens: 1000,
      messages: [{ role: 'user', content: evaluationPrompt }]
    })

    const raw = (message.content[0] as { text: string }).text.trim()
    const clean = raw.replace(/^```(?:json)?\n?/,'').replace(/\n?```$/,'').trim()
    const result = JSON.parse(clean)

    return new Response(JSON.stringify(result), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' }
    })
  } catch(e) {
    return new Response(JSON.stringify({ error: e instanceof Error ? e.message : String(e) }), {
      status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' }
    })
  }
})
