"""
watch_notes.py — local note-formatting pipeline for cmartwise

Uses a local LM Studio server (free, offline, no Claude tokens) to turn raw
lesson transcripts into structured JSON matching the exact `ai_output` shape
used by the (not-yet-deployed) process-lesson edge function and read by
portal-admin.html's review queue — session title, level assessment, what
was covered, coach focus suggestions, corrections, a student-facing note,
vocab additions, and exercises. Nothing here publishes anything; it just
produces a .json file per lesson, ready to paste into the Admin panel by
hand whenever you're ready.

Watches tools/transcripts/ — the same folder record_lesson.py already saves
every transcript into — so there's nothing to copy: record a lesson, and it
gets picked up on its own. Output lands in notes_processed/ as
<same filename>.json.

Nothing here ever gets pushed to GitHub or Netlify — tools/transcripts/ and
notes_processed/ are both gitignored.

Setup (one-time):
  1. Open LM Studio, load a model (e.g. Qwen 3 8B).
  2. Go to the "Developer" tab -> click "Start Server" (default port 1234).

Each time you want to process new lessons:
  1. Run:  python watch_notes.py
  2. Record a lesson as usual with record_lesson.py — its transcript is
     already saved into tools/transcripts/, so it's picked up automatically.
  3. The formatted .json appears in notes_processed/ within a few minutes.
     Ctrl+C to stop watching.

Already-processed transcripts are skipped on every run (a transcript counts
as done once a matching .json exists in notes_processed/), so it's always
safe to stop and restart this script — it only ever works on what's new.

If a recording isn't actually a lesson (a mic test, a personal call, etc.),
the model is instructed to say so instead of inventing a fake student note
— you'll see a "not a real lesson" message printed and no .json is written.
"""

import json
import os
import re
import time
import urllib.error
import urllib.request

BASE_DIR = os.path.dirname(os.path.abspath(__file__))
INBOX = os.path.join(BASE_DIR, "..", "transcripts")  # fed directly by record_lesson.py
OUTBOX = os.path.join(BASE_DIR, "notes_processed")
LMSTUDIO_URL = "http://localhost:1234/v1/chat/completions"
POLL_SECONDS = 5

# Mirrors supabase/functions/process-lesson/index.ts so local output can
# slot into the same Admin panel review flow. Edit freely if you want the
# local pass to behave differently from the cloud one.
SYSTEM_PROMPT = """You are Ika's (Cedric Martin's) private lesson-processing assistant for his Portuguese coaching business (CmartWise). Turn the raw lesson transcript below into structured JSON.

Read the whole transcript carefully — most of it is natural conversation, not a scripted lesson, so you have to find the language-teaching content inside it (vocabulary reached for, corrections made in the moment, level markers, recurring themes). Timestamps like [12:34] are noise — ignore them.

IMPORTANT — first decide if this is actually a coaching session with a real student. Solo mic/transcription tests, personal calls, or business talk with no student present are NOT lessons. If this transcript is not a real lesson, output ONLY this JSON and nothing else:
{"not_a_lesson": true, "reason": "<one short sentence on what the recording actually is>"}

Otherwise, produce ONLY valid JSON (no markdown fences, no commentary), matching this schema exactly:

{
  "session_title": "<short descriptive title, e.g. 'Private Equity, Well Water & Portal Feedback'>",
  "admin_summary": {
    "level_assessment": {"comprehension": "<CEFR level>", "speaking": "<CEFR level, can be a range like 'B2 -> C1'>"},
    "what_was_covered": ["<3-6 short bullet facts about session content>"],
    "coach_focus_suggestions": ["<2-4 concrete things Ika should prioritise in upcoming sessions, based on real gaps or opportunities>"],
    "corrections_flagged": ["<specific errors or near-misses the student made, with the correct form>"],
    "coach_notes_meta": "<1-3 sentences on anything non-language but relevant to the coaching relationship>"
  },
  "student_notes_markdown": "<the SAME session, rewritten as if Ika personally wrote it directly to the student after the lesson. Second person ('you'), warm, specific, encouraging, honest. Use markdown ## headings for sections like 'What we covered', 'How you're doing', 'Try this before next time'. Reference actual things the student said. Never mention 'transcript' or 'AI' or sound like a report.>",
  "vocab_additions": [{"term": "<PT term>", "translation": "<EN>", "category": "<short topic label>", "tags": ["<1-3 tags>"]}],
  "exercises": [
    {"type": "flashcard", "prompt": "<PT term or short phrase>", "answer": "<EN translation or explanation>", "explanation": "<optional context>"},
    {"type": "fill_blank", "prompt": "<PT sentence with ___ where a word from this session goes>", "answer": "<the missing word>", "explanation": "<why/context>"},
    {"type": "open_prompt", "prompt": "<a short speaking/writing prompt in PT reusing today's themes>", "answer": "", "explanation": "<what good use of today's vocab would look like>"}
  ]
}

Guidelines:
- Base everything on what's actually in the transcript. Never invent vocabulary, corrections, or content that didn't come up. If a field can't be honestly filled from the material, use an empty array/string rather than guessing.
- vocab_additions: roughly 5-12 genuinely new/reinforced terms from THIS session only, not a generic list.
- exercises: 3-6 total across the three types, based on topics that actually came up.
- student_notes_markdown must sound like Ika, not like a report about a student. No "the student demonstrated..." language anywhere in it.
- Keep coach_focus_suggestions specific and actionable, not generic."""


def call_local_model(text):
    # Gemma's chat template has no separate "system" role — a system message
    # makes the server 400. Fold the instructions into the user turn instead.
    combined = f"{SYSTEM_PROMPT}\n\n---\n\nTRANSCRIPT:\n\n{text}"
    payload = {
        "model": "google/gemma-4-e4b",
        "messages": [
            {"role": "user", "content": combined},
        ],
        "temperature": 0.3,
        "max_tokens": 4000,
    }
    req = urllib.request.Request(
        LMSTUDIO_URL,
        data=json.dumps(payload).encode("utf-8"),
        headers={"Content-Type": "application/json"},
        method="POST",
    )
    try:
        with urllib.request.urlopen(req, timeout=1800) as resp:
            result = json.loads(resp.read().decode("utf-8"))
    except urllib.error.HTTPError as e:
        body = e.read().decode("utf-8", errors="replace")
        raise RuntimeError(f"{e.code} {e.reason}: {body}") from None
    return result["choices"][0]["message"]["content"]


def parse_model_json(raw_text):
    """Strip markdown fences if present, then parse. Falls back to pulling
    out the largest {...} block in case the model added stray commentary."""
    clean = raw_text.strip()
    clean = re.sub(r"^```(?:json)?\s*", "", clean)
    clean = re.sub(r"\s*```$", "", clean)
    clean = clean.strip()
    try:
        return json.loads(clean)
    except json.JSONDecodeError:
        match = re.search(r"\{[\s\S]*\}", clean)
        if not match:
            raise ValueError(f"Model didn't return valid JSON. First 300 chars: {clean[:300]}")
        return json.loads(match.group(0))


def process_file(filename):
    src = os.path.join(INBOX, filename)
    with open(src, "r", encoding="utf-8") as f:
        raw = f.read()
    if not raw.strip():
        return
    approx_tokens = len(raw) // 4
    print(f"Processing {filename} (~{approx_tokens} tokens) ... this can take several minutes on this GPU, be patient.")
    try:
        response_text = call_local_model(raw)
        data = parse_model_json(response_text)
    except Exception as e:
        print(f"  Failed ({e}). Is LM Studio's local server running on port 1234?")
        return

    if isinstance(data, dict) and data.get("not_a_lesson"):
        print(f"  Not a real lesson ({data.get('reason', 'no reason given')}) — skipping, no file written.")
        return

    base, _ext = os.path.splitext(filename)
    dst = os.path.join(OUTBOX, base + ".json")
    with open(dst, "w", encoding="utf-8") as f:
        json.dump(data, f, ensure_ascii=False, indent=2)
    print(f"  -> {dst}")


def already_processed(filename):
    base, _ext = os.path.splitext(filename)
    return os.path.exists(os.path.join(OUTBOX, base + ".json"))


def main():
    os.makedirs(INBOX, exist_ok=True)
    os.makedirs(OUTBOX, exist_ok=True)
    print("Watching:", INBOX)
    print("Output to:", OUTBOX)
    print("(Ctrl+C to stop)")
    # Anything that already has a matching .json in notes_processed/ is done —
    # skip it, so restarting this script never redoes old lessons.
    seen = set(
        f for f in os.listdir(INBOX)
        if f.endswith((".txt", ".md")) and already_processed(f)
    )
    while True:
        try:
            current = set(f for f in os.listdir(INBOX) if f.endswith((".txt", ".md")))
            for f in current - seen:
                process_file(f)
                seen.add(f)
            time.sleep(POLL_SECONDS)
        except KeyboardInterrupt:
            print("Stopped.")
            break


if __name__ == "__main__":
    main()
