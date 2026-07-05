import Anthropic from 'npm:@anthropic-ai/sdk@0.27.3'

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
}

const LANG_NAMES: Record<string, string> = {
  en: 'English',
  pt: 'European Portuguese',
  fr: 'French',
  es: 'Spanish',
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders })

  try {
    const { text, fromLang, toLang } = await req.json()

    if (!text?.trim()) throw new Error('No text provided.')
    if (!fromLang || !toLang) throw new Error('Missing fromLang or toLang.')
    if (fromLang === toLang) throw new Error('Source and target languages must differ.')

    const apiKey = Deno.env.get('ANTHROPIC_API_KEY')
    if (!apiKey) throw new Error('ANTHROPIC_API_KEY not set in Supabase secrets')

    const fromName = LANG_NAMES[fromLang] || fromLang
    const toName = LANG_NAMES[toLang] || toLang

    const prompt = `You are a translator and language coach helping a student go from ${fromName} to ${toName}. Note that "Portuguese" always means European Portuguese, not Brazilian.

Translate this text: "${text}"

Return ONLY valid JSON, no markdown fences, in this exact schema:
{
  "original": "<the original text, verbatim>",
  "translation": "<formal/neutral written translation into ${toName}>",
  "colloquial": "<how a native speaker would actually say it day-to-day — can equal translation if there's no real difference>",
  "full_phonetic": "<simple phonetic pronunciation guide for the colloquial translation, readable by an English speaker with no IPA training>",
  "cultural_note": "<1 short sentence on register, regional usage, or a false-friend trap — omit as empty string if nothing noteworthy>",
  "similar_phrases": [
    {"pt": "<a related/alternative way to say something close to the original, in ${toName}>", "phonetic": "<simple pronunciation guide>", "en": "<its meaning in English>", "context": "<short label for when you'd use this instead, e.g. 'more formal', 'asking a stranger', 'among friends'>"}
  ],
  "words": [
    {"pt": "<word or short phrase from the TRANSLATED text — i.e. from the ${toName} output (the \"colloquial\" field above), NEVER from the original ${fromName} source text>", "en": "<what that ${toName} word/phrase means, explained in ${fromName}>", "type": "<one of: noun, verb, adjective, adverb, pronoun, preposition, conjunction, article, interjection>", "phonetic": "<simple pronunciation guide for the ${toName} word>", "note": "<short usage note, or empty string>", "tense": "<verb tense e.g. 'present', 'preterite', 'imperfect' — empty string if not a verb>", "person": "<grammatical person e.g. '1st plural', '3rd singular' — empty string if not a verb>", "infinitive": "<the verb's infinitive/dictionary form — empty string if not a verb>", "gender": "<'masculine' or 'feminine' for nouns/adjectives with grammatical gender — empty string otherwise>", "article": "<the definite article that pairs with this noun, e.g. 'o'/'a' — empty string if not a noun>"}
  ]
}

Break "words" into the meaningful words/short phrases of the TRANSLATED text in ${toName} (the "colloquial" field) — this is the language the learner is trying to learn, so words must ALWAYS come from that ${toName} output, never from the original ${fromName} source text, regardless of which direction the translation runs. Skip trivial function words unless genuinely useful to a learner. Fill in tense/person/infinitive for every verb, and gender/article for every noun and adjective that has one — these grammar details are actively used and displayed, they are not optional decoration. "similar_phrases" MUST contain exactly 3 genuinely distinct alternative expressions a learner would find useful (different register, different situation, or a common variant) — this array is never empty, always populate it even if the phrase is simple. Keep it concise — this is for a language-coaching tool, not a linguistics paper.`

    const client = new Anthropic({ apiKey })
    const message = await client.messages.create({
      model: 'claude-haiku-4-5-20251001',
      max_tokens: 2500,
      messages: [{ role: 'user', content: prompt }],
    })

    const textBlock = message.content.find((b): b is { type: 'text'; text: string } => b.type === 'text')
    if (!textBlock) throw new Error('Model response had no text content block.')
    const raw = textBlock.text.trim()
    const clean = raw.replace(/^```(?:json)?\n?/, '').replace(/\n?```$/, '').trim()
    const result = JSON.parse(clean)

    return new Response(JSON.stringify(result), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    })
  } catch (e) {
    return new Response(JSON.stringify({ error: e instanceof Error ? e.message : String(e) }), {
      status: 500,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    })
  }
})
