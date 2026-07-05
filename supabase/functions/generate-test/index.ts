import Anthropic from 'npm:@anthropic-ai/sdk@0.27.3'

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
}

// Every schema below is built to mirror the REAL exam it's named after —
// official component structure, item types, word counts and part order —
// verified against CAPLE (CIPLE/DEPLE/DIPLE), IELTS (British Council/IDP) and
// ETS (GRE) sources, July 2026. Where the real exam requires a second live
// candidate (CAPLE speaking tests are paired) or isn't practical in a browser
// (GRE has no listening/speaking at all), the practice version is adapted —
// see inline notes.
const PROMPTS: Record<string, Record<string, string>> = {
  // ── CIPLE — A2, CAPLE. Real exam: Reading+Writing combined (1h15, 45%),
  // Listening (30m, 30%), Speaking (15m/pair, 25%).
  CIPLE: {
    reading: `Generate a CIPLE (A2 Portuguese, CAPLE exam) reading test. Return ONLY valid JSON, no markdown fences.
The real CIPLE reading component uses short everyday public texts (notices, ads, messages, e-mails) with two item types: multiple choice and simple matching. There is NO true/false item type in the real CIPLE reading exam — do not use it.
Schema: {"passage":"<2-3 short separate everyday Portuguese texts, labelled 'Texto A:', 'Texto B:', 'Texto C:' — e.g. a shop notice, a text message, a small ad — about 120 words total>","questions":[5 {"type":"multiple_choice","question":"...","options":["A","B","C","D"],"correct":"A","explanation":"<English sentence explaining why, referencing the relevant text>"}, 2 {"type":"matching","question":"<asks which text (A/B/C) matches a description, e.g. 'Em qual texto se fala de...?'>","options":["Texto A","Texto B","Texto C"],"correct":"B","explanation":"<English sentence explaining why>"}],"duration_minutes":20}
Use simple, everyday European Portuguese (A2 level). Every question MUST include an "explanation" field.`,

    writing: `Generate a CIPLE (A2 Portuguese, CAPLE exam) writing test. Return ONLY valid JSON, no markdown fences.
The real CIPLE writing component asks for two short texts: one very short message (25-35 words) and one slightly longer informal e-mail or letter (60-80 words).
Schema: {"tasks":[{"prompt":"<Portuguese prompt for a short message/postcard, e.g. leaving a note or postcard for a friend>","prompt_en":"<English translation>","word_count_min":25,"word_count_max":35},{"prompt":"<Portuguese prompt for an informal e-mail or letter>","prompt_en":"<English translation>","word_count_min":60,"word_count_max":80}],"duration_minutes":20}`,

    listening: `Generate a CIPLE (A2 Portuguese, CAPLE exam) listening test. Return ONLY valid JSON, no markdown fences.
The real CIPLE listening component uses informal-register recordings (everyday phone calls, public announcements, simple instructions) and ONLY multiple-choice items — there is no true/false in the real CIPLE listening exam.
Schema: {"tracks":[{"id":"t1","title":"<title>","context":"<everyday setting: phone call, public announcement, etc.>","script":"<100-word informal European Portuguese dialogue or announcement, A2 level>","questions":[4 {"type":"multiple_choice","question":"...","options":["A","B","C","D"],"correct":"A","explanation":"<English sentence explaining why, referencing the script>"}]},{"id":"t2","title":"...","context":"...","script":"...","questions":[3 questions, same format]}],"duration_minutes":20}
Every question MUST include an "explanation" field.`,

    speaking: `Generate a CIPLE (A2 Portuguese, CAPLE exam) speaking test. Return ONLY valid JSON, no markdown fences.
The real CIPLE oral exam has 3 parts done with an examiner (and normally a paired candidate): Part 1 personal introduction, Part 2 roleplay simulating a public/personal situation, Part 3 conversation about an everyday topic. Since this is solo practice, Part 2 is adapted into a monologue: the student is given the scenario and responds as if speaking to the other person.
Schema: {"parts":[
{"type":"interaction","instruction":"Fala sobre ti.","prompts":[{"question":"Como te chamas e de onde és?"},{"question":"Fala-me da tua família."},{"question":"O que fazes (trabalho ou estudos)?"}],"speak_time_seconds_per_prompt":25},
{"type":"roleplay","instruction":"Simula esta situação, como se estivesses a falar com a outra pessoa.","topic":"<simple everyday scenario in Portuguese, e.g. asking to exchange a product in a shop, or booking a hotel room>","topic_en":"<English>","prep_time_seconds":20,"speak_time_seconds":40},
{"type":"discussion","instruction":"Conversa com o examinador sobre este tema.","topic":"<simple everyday topic in Portuguese, e.g. a hobby or a recent event>","topic_en":"<English>","prep_time_seconds":15,"speak_time_seconds":35}
],"evaluation_rubric":{"fluency":"Speaks with minimal hesitation","vocabulary":"Appropriate A2 vocabulary","grammar":"Correct present and past tense","communication":"Gets the message across"},"duration_minutes":10}`
  },

  // ── DEPLE — B1, CAPLE. Real exam: Reading (30m, 25%), Writing (1h, 25%),
  // Listening (40m, 25%), Speaking (20m/pair, 25%). This is the exam CAPLE
  // maps to B1 — DIPLE below is actually B2, not B1 (verified July 2026).
  DEPLE: {
    reading: `Generate a DEPLE (B1 Portuguese, CAPLE exam) reading test. Return ONLY valid JSON, no markdown fences.
The real DEPLE reading component has global comprehension of everyday texts (ads, articles, letters, product labels) plus detailed comprehension of one press article. Item types used: multiple choice, matching, AND true/false (DEPLE is the one CAPLE level that does use true/false in reading).
Schema: {"passage":"<one ~200-word European Portuguese text, B1 level — a short newspaper-style article or informative letter>","questions":[4 {"type":"multiple_choice","question":"...","options":["A","B","C","D"],"correct":"A","explanation":"<English sentence explaining why, referencing the passage>"}, 2 {"type":"true_false","question":"...","correct":true,"explanation":"<English sentence explaining why>"}, 2 {"type":"matching","question":"<matching-style question about a detail in the text>","options":["A","B","C","D"],"correct":"C","explanation":"<English sentence explaining why>"}],"duration_minutes":20}
Every question MUST include an "explanation" field.`,

    writing: `Generate a DEPLE (B1 Portuguese, CAPLE exam) writing test. Return ONLY valid JSON, no markdown fences.
The real DEPLE writing component has two parts: Part I a longer text (narrating events, describing a situation, or a personal/institutional letter), Part II a short message or postcard.
Schema: {"tasks":[{"prompt":"<Portuguese prompt for Part I — a personal letter, or narrating/describing something>","prompt_en":"<English translation>","word_count_min":90,"word_count_max":130},{"prompt":"<Portuguese prompt for Part II — a short message or postcard>","prompt_en":"<English translation>","word_count_min":30,"word_count_max":50}],"duration_minutes":30}`,

    listening: `Generate a DEPLE (B1 Portuguese, CAPLE exam) listening test. Return ONLY valid JSON, no markdown fences.
The real DEPLE listening component uses dialogues plus radio-style informational texts (news, weather, cultural announcements), with multiple choice, matching, AND true/false items.
Schema: {"tracks":[{"id":"t1","title":"<title>","context":"Dialogue","script":"<130-word European Portuguese dialogue, B1 level>","questions":[3 {"type":"multiple_choice","question":"...","options":["A","B","C","D"],"correct":"A","explanation":"<English sentence explaining why>"}, 1 {"type":"true_false","question":"...","correct":false,"explanation":"<English sentence explaining why>"}]},{"id":"t2","title":"...","context":"Radio news/weather bulletin","script":"<130-word European Portuguese radio-style monologue>","questions":[2 {"type":"multiple_choice",...}, 1 {"type":"matching",...}]}],"duration_minutes":25}
Every question MUST include an "explanation" field.`,

    speaking: `Generate a DEPLE (B1 Portuguese, CAPLE exam) speaking test. Return ONLY valid JSON, no markdown fences.
The real DEPLE oral exam has 3 sections done with an examiner (normally paired): personal identification interview, a roleplay simulating a professional/educational situation, and interaction based on information given just before the interview. Solo practice adapts the roleplay and reaction sections into monologues.
Schema: {"parts":[
{"type":"interaction","instruction":"Fala sobre ti.","prompts":[{"question":"Fala-me da tua vida profissional ou dos teus estudos."},{"question":"O que fazes nos teus tempos livres?"},{"question":"Fala de uma experiência recente importante para ti."}],"speak_time_seconds_per_prompt":30},
{"type":"roleplay","instruction":"Simula esta situação profissional ou de estudo.","topic":"<B1-level scenario in Portuguese, e.g. explaining a work problem to a colleague, or asking about a course>","topic_en":"<English>","prep_time_seconds":25,"speak_time_seconds":45},
{"type":"reaction","instruction":"Reage a esta informação, como farias na entrevista.","topic":"<a short piece of information or statement in Portuguese that the student must react/respond to>","topic_en":"<English>","prep_time_seconds":20,"speak_time_seconds":40}
],"evaluation_rubric":{"fluency":"Sustains speech on predictable topics","vocabulary":"B1 range","grammar":"Handles routine situations accurately","communication":"Interacts appropriately"},"duration_minutes":12}`
  },

  // ── DIPLE — B2 (not B1 — verified against CAPLE July 2026), CAPLE.
  // Real exam: Reading (75m, 25%), Writing (75m, 25%), Listening (40m, 25%),
  // Speaking (20m/pair, 25%).
  DIPLE: {
    reading: `Generate a DIPLE (B2 Portuguese, CAPLE exam) reading test. Return ONLY valid JSON, no markdown fences.
The real DIPLE reading component uses multiple choice, multiple matching, and completion (gap-fill) items — there is NO true/false in the real DIPLE reading exam.
Schema: {"passage":"<250-word European Portuguese text on current affairs or culture, B2 level>","questions":[5 {"type":"multiple_choice","question":"...","options":["A","B","C","D"],"correct":"A","explanation":"<English sentence explaining why, referencing the passage>"}, 3 {"type":"matching","question":"<matching-style question about a detail or paragraph in the text>","options":["A","B","C","D"],"correct":"B","explanation":"<English sentence explaining why>"}, 2 {"type":"gap_fill","question":"<a sentence taken from or related to the passage with a word removed, shown as '______'>","correct":"<the missing word>","explanation":"<English sentence explaining why>"}],"duration_minutes":30}
Every question MUST include an "explanation" field.`,

    writing: `Generate a DIPLE (B2 Portuguese, CAPLE exam) writing test. Return ONLY valid JSON, no markdown fences.
The real DIPLE writing component has 3 parts: Part I a personal or institutional letter (160-180 words), Part II a narrative/descriptive/argumentative text chosen from 3 given topics (160-180 words — for practice, present ONE representative topic and mention in prompt_en that the real exam offers a choice of 3), Part III sentence rewriting/transformation (rewrite a sentence keeping the same meaning, often starting with a given word) — this part is NOT scored by word count.
Schema: {"tasks":[{"prompt":"<Portuguese prompt for a personal or institutional letter>","prompt_en":"<English translation>","word_count_min":160,"word_count_max":180},{"prompt":"<Portuguese prompt for a narrative/descriptive/argumentative text>","prompt_en":"<English translation, mention '(in the real exam you'd choose 1 of 3 topics)'>","word_count_min":160,"word_count_max":180},{"type":"rewrite","prompt":"<Portuguese sentence to rewrite keeping the same meaning, e.g. starting with a given word or changing active to passive>","prompt_en":"<English explanation of the transformation required>"}],"duration_minutes":35}`,

    listening: `Generate a DIPLE (B2 Portuguese, CAPLE exam) listening test. Return ONLY valid JSON, no markdown fences.
The real DIPLE listening component uses ONLY multiple-choice items — do not use true/false or other types.
Schema: {"tracks":[{"id":"t1","title":"...","context":"News or interview","script":"<200-word European Portuguese, B2 level>","questions":[4 {"type":"multiple_choice","question":"...","options":["A","B","C","D"],"correct":"A","explanation":"<English sentence explaining why, referencing the script>"}]},{"id":"t2","title":"...","context":"...","script":"...","questions":[3 questions, same format]}],"duration_minutes":25}
Every question MUST include an "explanation" field.`,

    speaking: `Generate a DIPLE (B2 Portuguese, CAPLE exam) speaking test. Return ONLY valid JSON, no markdown fences.
The real DIPLE oral exam has 3 parts done with an examiner and a paired candidate: personal identification interview, a negotiation/planning task between candidates, and reaction to one or more prompts given by the examiner beforehand. Solo practice adapts the negotiation into a monologue where the student proposes and justifies a plan.
Schema: {"parts":[
{"type":"interaction","instruction":"Fala sobre ti.","prompts":[{"question":"Fala-me do teu percurso profissional ou académico."},{"question":"Quais são os teus principais interesses?"},{"question":"Fala de um desafio recente e como o resolveste."}],"speak_time_seconds_per_prompt":35},
{"type":"negotiation","instruction":"Propõe e justifica um plano para esta situação, como se estivesses a negociar com outra pessoa.","topic":"<B2-level planning/negotiation scenario in Portuguese, e.g. organising a joint work project or resolving a scheduling conflict>","topic_en":"<English>","prep_time_seconds":40,"speak_time_seconds":70},
{"type":"reaction","instruction":"Reage a este estímulo, como farias na entrevista.","topic":"<a short statement, image description, or piece of information in Portuguese for the student to react to>","topic_en":"<English>","prep_time_seconds":30,"speak_time_seconds":60}
],"evaluation_rubric":{"fluency":"Sustains speech with good pace","vocabulary":"B2 range","grammar":"Multiple tenses used accurately","coherence":"Logical structure"},"duration_minutes":15}`
  },

  // ── IELTS — Academic. Real exam: Listening (30m, 40 Qs, 4 recordings),
  // Reading (60m, 40 Qs, 3 passages), Writing (60m, 2 tasks), Speaking
  // (11-14m, 3-part interview). Practice is scaled down in volume but keeps
  // the real item types and part structure.
  IELTS: {
    reading: `Generate an IELTS Academic Reading practice test. Return ONLY valid JSON, no markdown fences.
The real IELTS Academic Reading test uses passages with a genuine mix of: multiple choice, True/False/Not Given, matching headings, and sentence/summary completion. Reproduce that mix (approximate "Not Given" as True/False where the text doesn't state something, but keep the type as "true_false").
Schema: {"passage":"<two short academic passages labelled 'Passage 1:' and 'Passage 2:', ~140 words each, ~280 words total>","questions":[4 {"type":"multiple_choice","question":"...","options":["A","B","C","D"],"correct":"A","explanation":"<sentence explaining why, referencing the passage>"}, 3 {"type":"true_false","question":"...","correct":true,"explanation":"<sentence explaining why>"}, 2 {"type":"matching","question":"<matching-headings-style question, e.g. matching a paragraph to its main idea>","options":["Heading A","Heading B","Heading C","Heading D"],"correct":"B","explanation":"<sentence explaining why>"}, 1 {"type":"gap_fill","question":"<a sentence-completion question drawn from the passage, with '______' for the missing word(s)>","correct":"<missing word(s)>","explanation":"<sentence explaining why>"}],"duration_minutes":30}
Every question MUST include an "explanation" field.`,

    writing: `Generate an IELTS Academic Writing practice test. Return ONLY valid JSON, no markdown fences.
Task 1 requires describing a graph/chart/table/diagram in at least 150 words. Task 2 requires a discursive essay in at least 250 words.
Schema: {"tasks":[{"prompt":"Task 1: Describe the following graph or chart (describe a trend or comparison).","prompt_en":"Summarise the main features and make comparisons where relevant. Write at least 150 words.","word_count_min":150,"word_count_max":220},{"prompt":"Task 2: Some people believe that universities should focus on practical skills rather than theoretical knowledge. To what extent do you agree?","prompt_en":"Give your opinion with examples. Write at least 250 words.","word_count_min":250,"word_count_max":320}],"duration_minutes":60}`,

    listening: `Generate an IELTS Listening practice test. Return ONLY valid JSON, no markdown fences.
The real IELTS Listening test moves from everyday social conversation to academic monologue, using multiple choice, note/form completion, and matching — true/false is NOT a real IELTS Listening item type, do not use it.
Schema: {"tracks":[{"id":"s1","title":"Section 1","context":"Everyday social conversation","script":"<180-word British English dialogue, e.g. booking something or exchanging personal details>","questions":[3 {"type":"multiple_choice","question":"...","options":["A","B","C","D"],"correct":"A","explanation":"<sentence explaining why, referencing the script>"}, 1 {"type":"gap_fill","question":"<a note/form-completion style question with '______' for the missing detail>","correct":"<missing word(s)>","explanation":"<sentence explaining why>"}]},{"id":"s2","title":"Section 2","context":"Academic monologue/lecture","script":"<200-word monologue, more formal register>","questions":[3 {"type":"multiple_choice",...}, 1 {"type":"matching","question":"...","options":["A","B","C","D"],"correct":"C","explanation":"..."}]}],"duration_minutes":25}
Every question MUST include an "explanation" field.`,

    speaking: `Generate an IELTS Speaking test. Return ONLY valid JSON, no markdown fences.
The real IELTS Speaking test is a 3-part interview: Part 1 introduction and familiar-topic questions, Part 2 a cue-card long turn (1 min prep, speak 1-2 min), Part 3 a discussion connected to the Part 2 topic.
Schema: {"parts":[
{"type":"interaction","instruction":"Part 1: Introduction and familiar topics.","prompts":[{"question":"Can you tell me a little about yourself?"},{"question":"Do you work or are you a student?"},{"question":"What do you enjoy doing in your free time?"}],"speak_time_seconds_per_prompt":30},
{"type":"opinion","instruction":"Part 2: Speak for 1-2 minutes.","topic":"Describe a time when you had to make an important decision.","topic_en":"Talk about what the decision was, why it was difficult, and what happened.","prep_time_seconds":60,"speak_time_seconds":120},
{"type":"interaction","instruction":"Part 3: Discussion connected to Part 2.","prompts":[{"question":"How has technology changed decision-making in modern life?"},{"question":"Do you think people today face more difficult choices than previous generations?"},{"question":"What role should education play in helping young people make good decisions?"}],"speak_time_seconds_per_prompt":60}
],"evaluation_rubric":{"fluency":"Fluency and coherence","vocabulary":"Lexical resource","grammar":"Grammatical range and accuracy","pronunciation":"Clear pronunciation"},"duration_minutes":15}`
  },

  // ── GRE — General Test. Real exam (since Sept 2023): Verbal Reasoning
  // (reading comprehension + text completion + sentence equivalence) and a
  // SINGLE Analyze-an-Issue essay (Argument task was removed). The real GRE
  // has NO listening or speaking section at all — those are intentionally
  // not offered for GRE in this app (see setup screen logic).
  GRE: {
    reading: `Generate a GRE Verbal Reasoning practice set. Return ONLY valid JSON, no markdown fences.
Real GRE Verbal Reasoning mixes three item types: reading comprehension (passage-based multiple choice), text completion (a sentence with a blank, choose the best word), and sentence equivalence (choose the TWO answer choices that both fit the blank and produce sentences with a similar meaning — this MUST allow selecting exactly 2 answers).
Schema: {"passage":"<220-word dense academic passage>","questions":[
3 {"type":"multiple_choice","question":"<passage-based question>","options":["A","B","C","D","E"],"correct":"A","explanation":"<sentence explaining why, referencing the passage, and why the other options are wrong>"},
2 {"type":"multiple_choice","question":"Text Completion: <a standalone sentence, unrelated to the passage, with a blank shown as '______'>","options":["A","B","C","D","E"],"correct":"B","explanation":"<sentence explaining why this word fits>"},
2 {"type":"multi_select","question":"Sentence Equivalence: <a standalone sentence, unrelated to the passage, with a blank shown as '______'. Select the TWO answer choices that both fit and produce similar meaning.>","options":[6 words, where TWO are correct synonyms that both fit the blank],"correct":["B","E"],"explanation":"<sentence explaining why those two, and why the meaning is preserved>"}
],"duration_minutes":20}
Every question MUST include an "explanation" field.`,

    writing: `Generate a GRE Analytical Writing practice task. Return ONLY valid JSON, no markdown fences.
Since 2023 the real GRE Analytical Writing section is a SINGLE "Analyze an Issue" essay, 30 minutes, no separate Argument task. ETS recommends roughly 500-600 words.
Schema: {"tasks":[{"prompt":"Analyze an Issue: <a general claim/opinion statement to discuss, GRE-issue-task style>","prompt_en":"Write a response in which you discuss the extent to which you agree or disagree with the statement, and explain your reasoning. Address the most compelling reasons/examples that could be used to challenge your position.","word_count_min":500,"word_count_max":650}],"duration_minutes":30}`
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
      max_tokens: 4000,
      system: 'You are generating a language exam practice test as strict JSON. Two hard rules, no exceptions: (1) Every question — especially true/false and matching items — must be answerable strictly from the given passage/script/text. Never introduce a fact, name, place, or detail that is not stated or directly implied in that text. (2) For every multiple_choice and matching question, the "correct" field MUST be exactly one of the option letters ("A", "B", "C", or "D") — never the option\'s full text. Follow the schema in the user message exactly.',
      messages: [{ role: 'user', content: PROMPTS[promptKey][section] }]
    })

    const textBlock = message.content.find((b): b is { type: 'text'; text: string } => b.type === 'text')
    if (!