// Supabase Edge Function: generate-test
// Generates language test questions via Claude API
// Deploy: supabase.com → Edge Functions → generate-test → paste code → Deploy
// Secret needed: ANTHROPIC_API_KEY (Project Settings → Edge Functions → Secrets)

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
}

type TestConfig = {
  testType: "CIPLE" | "DIPLE" | "GRE" | "IELTS"
  section: "reading" | "writing" | "listening" | "speaking"
  level?: string
  language?: string
}

function buildTestPrompt(config: TestConfig): string {
  const { testType, section, level, language = "Portuguese" } = config

  const levelMap: Record<string, string> = {
    CIPLE: "A2 (beginner-intermediate)",
    DIPLE: "B1-B2 (intermediate)",
    GRE: "C1-C2 (advanced English academic)",
    IELTS: "B1-C1 (international English)",
  }
  const targetLevel = level || levelMap[testType] || "B1"

  const sectionPrompts: Record<string, string> = {
    reading: `Create a ${testType} reading comprehension test at ${targetLevel} level.

Return ONLY valid JSON (no markdown):
{
  "section": "reading",
  "duration_minutes": 20,
  "passage": "A ${language} reading passage of 200-300 words appropriate for ${targetLevel} level. Use authentic, natural language.",
  "passage_translation_hint": "Brief English note on topic/context only (1 sentence)",
  "questions": [
    {
      "id": 1,
      "type": "multiple_choice",
      "question": "Question about the passage in ${language}",
      "options": ["A) ...", "B) ...", "C) ...", "D) ..."],
      "correct": "A",
      "explanation": "Why this answer is correct (in English)"
    }
  ],
  "total_questions": 8
}

Include 5 multiple choice, 2 true/false, 1 short answer. Questions in ${language}, answers in ${language}.`,

    writing: `Create a ${testType} writing test at ${targetLevel} level for ${language}.

Return ONLY valid JSON:
{
  "section": "writing",
  "duration_minutes": 30,
  "tasks": [
    {
      "id": 1,
      "type": "short_text",
      "prompt": "Writing prompt in ${language} (e.g. write a short message/email/description)",
      "prompt_en": "English translation of the prompt",
      "word_count_min": 60,
      "word_count_max": 100,
      "scoring_criteria": ["vocabulary variety", "grammar accuracy", "task completion", "coherence"],
      "example_answer": "A model answer at exactly ${targetLevel} level"
    },
    {
      "id": 2,
      "type": "longer_text",
      "prompt": "A longer writing task prompt in ${language}",
      "prompt_en": "English translation",
      "word_count_min": 100,
      "word_count_max": 150,
      "scoring_criteria": ["vocabulary variety", "grammar accuracy", "task completion", "coherence", "structure"],
      "example_answer": "A model answer"
    }
  ]
}`,

    listening: `Create a ${testType} listening comprehension test at ${targetLevel} level for ${language}.

The audio will be generated via browser Text-to-Speech. Design the content accordingly.

Return ONLY valid JSON:
{
  "section": "listening",
  "duration_minutes": 25,
  "tracks": [
    {
      "id": 1,
      "title": "Short dialogue or monologue title",
      "type": "dialogue",
      "script": "The full script in ${language} to be read aloud (120-180 words). Write naturally, as people actually speak.",
      "speakers": ["Speaker A name", "Speaker B name"],
      "context": "Brief context in English (where/who/what)",
      "questions": [
        {
          "id": 1,
          "question": "Question about the audio in ${language}",
          "type": "multiple_choice",
          "options": ["A) ...", "B) ...", "C) ...", "D) ..."],
          "correct": "B",
          "explanation": "Explanation in English"
        }
      ]
    },
    {
      "id": 2,
      "title": "Second track title",
      "type": "monologue",
      "script": "Second script in ${language} (150-200 words)",
      "speakers": ["Narrator"],
      "context": "Context in English",
      "questions": [
        {"id": 4, "question": "...", "type": "true_false", "correct": true, "explanation": "..."},
        {"id": 5, "question": "...", "type": "true_false", "correct": false, "explanation": "..."},
        {"id": 6, "question": "...", "type": "multiple_choice", "options": ["A)...","B)...","C)...","D)..."], "correct": "C", "explanation": "..."}
      ]
    }
  ],
  "total_questions": 6
}`,

    speaking: `Create a ${testType} speaking test at ${targetLevel} level for ${language}.

The student will speak aloud and their speech will be transcribed by the browser. AI will then evaluate.

Return ONLY valid JSON:
{
  "section": "speaking",
  "duration_minutes": 15,
  "parts": [
    {
      "id": 1,
      "type": "describe_image",
      "instruction": "You will see a short description of a scene. Describe what you imagine in ${language} for 45 seconds.",
      "scene_description": "Describe this imagined scene in English for the student to understand and then speak about it in ${language}: [create a vivid, realistic everyday scene]",
      "prep_time_seconds": 30,
      "speak_time_seconds": 45,
      "scoring_criteria": ["fluency", "vocabulary", "grammar", "pronunciation clarity", "task completion"]
    },
    {
      "id": 2,
      "type": "opinion",
      "instruction": "Give your opinion on the following topic in ${language}. Speak for 60 seconds.",
      "topic": "A topic appropriate for ${targetLevel} — something everyday and relatable for an expat in Portugal",
      "topic_en": "English translation of the topic",
      "prep_time_seconds": 45,
      "speak_time_seconds": 60,
      "scoring_criteria": ["fluency", "vocabulary range", "grammar accuracy", "coherence", "expressing opinions"]
    },
    {
      "id": 3,
      "type": "interaction",
      "instruction": "Respond to these prompts as if in a real conversation:",
      "prompts": [
        {"question": "Conversational question in ${language}", "expected_length": "2-3 sentences"},
        {"question": "Another conversational question", "expected_length": "2-3 sentences"},
        {"question": "A third question, slightly more complex", "expected_length": "3-4 sentences"}
      ],
      "speak_time_seconds_per_prompt": 30
    }
  ],
  "evaluation_rubric": {
    "fluency": "Speaks without excessive hesitation, maintains flow",
    "vocabulary": "Uses appropriate and varied vocabulary for ${targetLevel}",
    "grammar": "Uses correct grammar structures expected at ${targetLevel}",
    "pronunciation": "Speech is intelligible and reasonably clear",
    "task_completion": "Addresses the prompt fully"
  }
}`
  }

  return sectionPrompts[section] || sectionPrompts.reading
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS })

  try {
    const apiKey = Deno.env.get("ANTHROPIC_API_KEY")
    if (!apiKey) throw new Error("ANTHROPIC_API_KEY secret not set")

    const config: TestConfig = await req.json()
    if (!config.testType || !config.section) throw new Error("testType and section required")

    const prompt = buildTestPrompt(config)

    const response = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-api-key": apiKey,
        "anthropic-version": "2023-06-01",
      },
      body: JSON.stringify({
        model: "claude-sonnet-4-6",
        max_tokens: 4000,
        messages: [{ role: "user", content: prompt }],
      }),
    })

    if (!response.ok) {
      const err = await response.text()
      throw new Error(`Anthropic API error ${response.status}: ${err}`)
    }

    const data = await response.json()
    const raw = data.content?.[0]?.text || ""

    let parsed
    try {
      parsed = JSON.parse(raw)
    } catch {
      const match = raw.match(/\{[\s\S]*\}/)
      if (match) parsed = JSON.parse(match[0])
      else throw new Error("Could not parse model response as JSON")
    }

    return new Response(JSON.stringify(parsed), {
      headers: { ...CORS, "Content-Type": "application/json" },
    })
  } catch (err) {
    return new Response(JSON.stringify({ error: String(err) }), {
      status: 500,
      headers: { ...CORS, "Content-Type": "application/json" },
    })
  }
})
