// Supabase Edge Function: evaluate-speaking
// Evaluates a student's spoken response transcript using Claude
// Deploy alongside generate-test

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS })

  try {
    const apiKey = Deno.env.get("ANTHROPIC_API_KEY")
    if (!apiKey) throw new Error("ANTHROPIC_API_KEY secret not set")

    const { transcript, prompt, language, level, rubric } = await req.json()
    if (!transcript) throw new Error("transcript required")

    const systemPrompt = `You are an expert ${language || "Portuguese"} language examiner evaluating a student's spoken response for a ${level || "B1"} level exam.

Evaluate the following transcript of what the student said in response to the given prompt.

Return ONLY valid JSON:
{
  "overall_score": 72,
  "band": "B1",
  "scores": {
    "fluency": 75,
    "vocabulary": 70,
    "grammar": 68,
    "pronunciation": 80,
    "task_completion": 65
  },
  "strengths": ["What the student did well (2-3 specific points)"],
  "improvements": ["What to work on (2-3 specific, actionable suggestions)"],
  "corrected_excerpt": "If the student made notable errors, show a corrected version of their key sentences",
  "coach_note": "A short, encouraging note a good language coach would give (warm, honest, specific)"
}`

    const userMessage = `PROMPT given to student: "${prompt || "Speak freely on the topic"}"

STUDENT'S TRANSCRIPT: "${transcript}"

RUBRIC: ${JSON.stringify(rubric || {})}`

    const response = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-api-key": apiKey,
        "anthropic-version": "2023-06-01",
      },
      body: JSON.stringify({
        model: "claude-haiku-4-5",
        max_tokens: 1200,
        system: systemPrompt,
        messages: [{ role: "user", content: userMessage }],
      }),
    })

    if (!response.ok) throw new Error(`Anthropic error ${response.status}`)

    const data = await response.json()
    const raw = data.content?.[0]?.text || ""

    let parsed
    try { parsed = JSON.parse(raw) }
    catch {
      const match = raw.match(/\{[\s\S]*\}/)
      if (match) parsed = JSON.parse(match[0])
      else throw new Error("Could not parse response")
    }

    return new Response(JSON.stringify(parsed), {
      headers: { ...CORS, "Content-Type": "application/json" },
    })
  } catch (err) {
    return new Response(JSON.stringify({ error: String(err) }), {
      status: 500, headers: { ...CORS, "Content-Type": "application/json" },
    })
  }
})
