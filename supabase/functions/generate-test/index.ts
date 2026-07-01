import Anthropic from 'npm:@anthropic-ai/sdk@0.27.3'

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
}

const PROMPTS: Record<string, Record<string, string>> = {
  CIPLE: {
    reading: `Generate a CIPLE (A2 Portuguese) reading comprehension test. Return ONLY valid JSON, no markdown fences.
Schema: {"passage":"<150-word European Portuguese text on everyday topic>","questions":[8 questions, mix of {"type":"multiple_choice","question":"...","options":["A","B","C","D"],"correct":"A"} and {"type":"true_false","question":"...","correct":true}],"duration_minutes":20}
Topics: daily routine, shopping, weather, family, leisure. Use simple European Portuguese.`,

    writing: `Generate a CIPLE (A2 Portuguese) writing test. Return ONLY valid JSON, no markdown fences.
Schema: {"tasks":[{"prompt":"<short Portuguese writing prompt>","prompt_en":"<English translation>","word_count_min":40,"word_count_max":80},{"prompt":"<slightly longer prompt>","prompt_en":"<translation>","word_count_min":60,"word_count_max":120}],"duration_minutes":30}
Tasks: postcard, short email to a friend, describe your weekend.`,

    listening: `Generate a CIPLE (A2 Portuguese) listening test. Return ONLY valid JSON, no markdown fences.
Schema: {"tracks":[{"id":"t1","title":"<title>","context":"<setting>","script":"<120-word European Portuguese dialogue>","questions":[5 questions with correct answers]},{"id":"t2","title":"...","context":"...","script":"...","questions":[3 questions]}],"duration_minutes":25}`,

    speaking: `Generate a CIPLE (A2 Portuguese) speaking test. Return ONLY valid JSON, no markdown fences.
Schema: {"parts":[{"type":"describe_image","instruction":"Descreve a imagem que imaginas.","topic":"<simple scene in Portuguese>","topic_en":"<English>","prep_time_seconds":30,"speak_time_seconds":45},{"type":"interaction","instruction":"Responde às perguntas.","prompts":[{"question":"Como te chamas e de onde és?"},{"question":"O que gostas de fazer nos tempos livres?"},{"question":"Descreve a tua rotina diária."}],"speak_time_seconds_per_prompt":30}],"evaluation_rubric":{"fluency":"Speaks with minimal hesitation","vocabulary":"Appropriate A2 vocabulary","grammar":"Correct present and past tense","communication":"Gets the message across"},"duration_minutes":10}`
  },
  DIPLE: {
    reading: `Generate a DIPLE (B1-B2 Portuguese) reading test. Return ONLY valid JSON, no markdown fences.
Schema: {"passage":"<250-word European Portuguese text on current affairs or culture>","questions":[10 questions mixing multiple_choice and true_false and short, include correct for mc/tf],"duration_minutes":30}`,

    writing: `Generate a DIPLE (B1-B2 Portuguese) writing test. Return ONLY valid JSON, no markdown fences.
Schema: {"tasks":[{"prompt":"<formal letter prompt in Portuguese>","prompt_en":"<translation>","word_count_min":80,"word_count_max":150},{"prompt":"<argumentative task>","prompt_en":"<translation>","word_count_min":150,"word_count_max":250}],"duration_minutes":40}`,

    listening: `Generate a DIPLE (B1-B2 Portuguese) listening test. Return ONLY valid JSON, no markdown fences.
Schema: {"tracks":[{"id":"t1","title":"...","context":"News or interview","script":"<200-word European Portuguese>","questions":[6 questions]},{"id":"t2","title":"...","context":"...","script":"...","questions":[4 questions]}],"duration_minutes":35}`,

    speaking: `Generate a DIPLE (B1-B2 Portuguese) speaking test. Return ONLY valid JSON, no markdown fences.
Schema: {"parts":[{"type":"opinion","instruction":"Dá a tua opinião.","topic":"<debatable topic in Portuguese>","topic_en":"<English>","prep_time_seconds":60,"speak_time_seconds":90},{"type":"interaction","instruction":"Participa na conversa.","prompts":[{"question":"Qual é a tua opinião sobre as redes sociais?"},{"question":"Como resolverias o problema do tráfego nas cidades?"},{"question":"Compara a vida urbana e rural."}],"speak_time_seconds_per_prompt":45}],"evaluation_rubric":{"fluency":"Sustains speech with good pace","vocabulary":"B1-B2 range","grammar":"Multiple tenses used accurately","coherence":"Logical structure"},"duration_minutes":15}`
  },
  IELTS: {
    reading: `Generate an IELTS Academic Reading practice test. Return ONLY valid JSON, no markdown fences.
Schema: {"passage":"<300-word academic English passage>","questions":[10 questions mixing multiple_choice and true_false and short, include correct for mc/tf],"duration_minutes":20}`,

    writing: `Generate an IELTS Writing practice test. Return ONLY valid JSON, no markdown fences.
Schema: {"tasks":[{"prompt":"Task 1: Describe the following graph or chart (describe a trend or comparison).","prompt_en":"Summarise the main features and make comparisons where relevant.","word_count_min":150,"word_count_max":200},{"prompt":"Task 2: Some people believe that universities should focus on practical skills rather than theoretical knowledge. To what extent do you agree?","prompt_en":"Give your opinion with examples.","word_count_min":250,"word_count_max":350}],"duration_minutes":60}`,

    listening: `Generate an IELTS Listening practice test. Return ONLY valid JSON, no markdown fences.
Schema: {"tracks":[{"id":"s1","title":"Section 1","context":"Social conversation","script":"<200-word British English dialogue>","questions":[5 questions]},{"id":"s2","title":"Section 2","context":"Information talk","script":"<200-word monologue>","questions":[5 questions]}],"duration_minutes":30}`,

    speaking: `Generate an IELTS Speaking test. Return ONLY valid JSON, no markdown fences.
Schema: {"parts":[{"type":"opinion","instruction":"Part 2: Speak for 1-2 minutes.","topic":"Describe a time when you had to make an important decision.","topic_en":"Talk about what the decision was, why it was difficult, and what happened.","prep_time_seconds":60,"speak_time_seconds":120},{"type":"interaction","instruction":"Part 3 discussion.","prompts":[{"question":"How has technology changed decision-making in modern life?"},{"question":"Do you think people today face more difficult choices than previous generations?"},{"question":"What role should education play in helping young people make good decisions?"}],"speak_time_seconds_per_prompt":60}],"evaluation_rubric":{"fluency":"Fluency and coherence","vocabulary":"Lexical resource","grammar":"Grammatical range and accuracy","pronunciation":"Clear pronunciation"},"duration_minutes":15}`
  },
  GRE: {
    reading: `Generate a GRE Verbal Reasoning reading comprehension practice test. Return ONLY valid JSON, no markdown fences.
Schema: {"passage":"<250-word dense academic passage>","questions":[6 multiple_choice questions with 5 options A-E, GRE critical reasoning style, include correct],"duration_minutes":15}`,

    writing: `Generate a GRE Analytical Writing practice test. Return ONLY valid JSON, no markdown fences.
Schema: {"tasks":[{"prompt":"Issue Task: As societies become increasingly digital, the skills most valued in the workforce have fundamentally changed. Write an essay discussing this claim.","prompt_en":"Develop a well-reasoned argument with specific examples.","word_count_min":450,"word_count_max":650},{"prompt":"Argument Task: The following appeared in a business report: 'Our company should switch to remote work permanently because productivity increased by 15% during our six-month trial.' Evaluate this argument.","prompt_en":"Identify logical flaws and explain what evidence would strengthen or weaken the conclusion.","word_count_min":350,"word_count_max":500}],"duration_minutes":60}`,

    listening: `Generate a GRE-style critical listening exercise. Return ONLY valid JSON, no markdown fences.
Schema: {"tracks":[{"id":"a1","title":"Academic Lecture Excerpt","context":"Graduate seminar on cognitive science","script":"<250-word dense academic English with complex vocabulary>","questions":[5 critical reasoning questions with 4 options each, include correct]}],"duration_minutes":20}`,

    speaking: `Generate a GRE-style oral academic exercise. Return ONLY valid JSON, no markdown fences.
Schema: {"parts":[{"type":"opinion","instruction":"Analyse and respond to the prompt.","topic":"The most significant advances in human history have come from individual genius rather than collective effort.","topic_en":"Support or refute this claim with reasoning and specific examples.","prep_time_seconds":120,"speak_time_seconds":180},{"type":"interaction","instruction":"Respond to follow-up questions.","prompts":[{"question":"What counterarguments exist against your position?"},{"question":"How does this idea apply to contemporary scientific or technological development?"},{"question":"What historical evidence most strongly supports or undermines this view?"}],"speak_time_seconds_per_prompt":90}],"evaluation_rubric":{"argumentation":"Clear thesis with evidence","vocabulary":"Graduate-level vocabulary","coherence":"Logical structure","critical_thinking":"Depth of analysis"},"duration_minutes":20}`
  }
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders })

  try {
    const { testType, section } = await req.json()
    const promptKey = testType as keyof typeof PROMPTS

    if (!PROMPTS[promptKey]?.[section]) {
      return new Response(JSON.stringify({ error: `Unknown: ${testType}/${section}` }), {
        status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' }
      })
    }

    const apiKey = Deno.env.get('ANTHROPIC_API_KEY')
    if (!apiKey) throw new Error('ANTHROPIC_API_KEY not set in Supabase secrets')

    const client = new Anthropic({ apiKey })
    const message = await client.messages.create({
      model: 'claude-haiku-4-5-20251001',
      max_tokens: 3000,
      messages: [{ role: 'user', content: PROMPTS[promptKey][section] }]
    })

    const raw = (message.content[0] as { text: string }).text.trim()
    const clean = raw.replace(/^```(?:json)?\n?/,'').replace(/\n?```$/,'').trim()
    const parsed = JSON.parse(clean)

    return new Response(JSON.stringify(parsed), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' }
    })
  } catch(e) {
    return new Response(JSON.stringify({ error: e instanceof Error ? e.message : String(e) }), {
      status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' }
    })
  }
})
