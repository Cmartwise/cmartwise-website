#!/usr/bin/env python3
"""
cmartwise Lesson Recorder
Records Google Meet lessons (both voices), transcribes with Whisper, and — if
you're signed in — automatically sends the transcript to the AI note processor
and drops the result into the Admin panel's "Pending review" queue. You never
have to copy/paste anything; you just open the website afterwards and approve.

If you're not signed in (or you're offline), the transcript is still saved
locally exactly as before — nothing about the recording/transcription itself
depends on the network.
"""

import tkinter as tk
from tkinter import ttk, simpledialog
import threading
import numpy as np
import wave
import os
import json
import time
from datetime import datetime

CHUNK       = 1024
MIC_RATE    = 44100
TOOLS_DIR   = os.path.dirname(os.path.abspath(__file__))
TRANSCRIPT_DIR = os.path.join(TOOLS_DIR, "transcripts")
AUTH_CACHE  = os.path.join(TOOLS_DIR, ".recorder_auth.json")

SUPABASE_URL  = "https://zsgnggtwfxyqzvrnlaqg.supabase.co"
SUPABASE_ANON = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InpzZ25nZ3R3Znh5cXp2cm5sYXFnIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODEwOTYzMzIsImV4cCI6MjA5NjY3MjMzMn0.7iclLaCjyejXHmCcWAJvRJTICrCGt7ks5LieRY0Z9aM"

try:
    import requests
    HAVE_REQUESTS = True
except ImportError:
    HAVE_REQUESTS = False

# ── Colours ──────────────────────────────────────────────────────────────────
BG      = "#1A3A4A"   # Ocean
ACCENT  = "#C4683A"   # Terra
SAND    = "#EDE5D8"
MUTED   = "#7A6E64"
IVORY   = "#FAF7F3"
GREY    = "#2E4E5E"


def find_loopback():
    """Return WASAPI loopback device info, or None if unavailable."""
    try:
        import pyaudiowpatch as pyaudio
        p = pyaudio.PyAudio()
        try:
            info = p.get_default_wasapi_loopback()
            p.terminate()
            return info
        except Exception:
            for i in range(p.get_device_count()):
                d = p.get_device_info_by_index(i)
                if d.get("isLoopbackDevice", False):
                    p.terminate()
                    return d
            p.terminate()
            return None
    except Exception:
        return None


# ── Supabase auth / API helpers ──────────────────────────────────────────────
# The recorder signs in as Ika (admin) so writes respect the exact same RLS
# rules as the website — no separate service key floating around locally.

def _auth_headers(access_token):
    return {"apikey": SUPABASE_ANON, "Authorization": f"Bearer {access_token}", "Content-Type": "application/json"}


def load_cached_refresh_token():
    try:
        with open(AUTH_CACHE, "r") as f:
            return json.load(f).get("refresh_token")
    except Exception:
        return None


def save_refresh_token(token):
    try:
        with open(AUTH_CACHE, "w") as f:
            json.dump({"refresh_token": token}, f)
    except Exception:
        pass  # non-fatal — just means you'll be asked to sign in again next time


def login_password(email, password):
    r = requests.post(
        f"{SUPABASE_URL}/auth/v1/token?grant_type=password",
        headers={"apikey": SUPABASE_ANON, "Content-Type": "application/json"},
        json={"email": email, "password": password}, timeout=15
    )
    r.raise_for_status()
    d = r.json()
    return d["access_token"], d["refresh_token"]


def refresh_session(refresh_token):
    r = requests.post(
        f"{SUPABASE_URL}/auth/v1/token?grant_type=refresh_token",
        headers={"apikey": SUPABASE_ANON, "Content-Type": "application/json"},
        json={"refresh_token": refresh_token}, timeout=15
    )
    r.raise_for_status()
    d = r.json()
    return d["access_token"], d["refresh_token"]


def fetch_students(access_token):
    r = requests.get(
        f"{SUPABASE_URL}/rest/v1/profiles?role=eq.student&select=id,full_name,email&order=full_name",
        headers=_auth_headers(access_token), timeout=15
    )
    r.raise_for_status()
    return r.json()


def call_process_lesson(access_token, transcript, student_name, session_date):
    r = requests.post(
        f"{SUPABASE_URL}/functions/v1/process-lesson",
        headers=_auth_headers(access_token),
        json={"transcript": transcript, "studentName": student_name, "sessionDate": session_date, "sourceType": "transcript"},
        timeout=120
    )
    # Read the body before raising — the function returns a JSON {"error": "..."}
    # on failure, and that real reason is far more useful than requests' generic
    # "500 Server Error: Internal Server Error for url: ..." message.
    try:
        data = r.json()
    except ValueError:
        data = None
    if not r.ok:
        reason = (data or {}).get("error") if isinstance(data, dict) else None
        raise RuntimeError(reason or f"HTTP {r.status_code}: {r.text[:300]}")
    if isinstance(data, dict) and "error" in data:
        raise RuntimeError(data["error"])
    return data


def insert_draft(access_token, student_id, transcript, ai_output, session_date):
    r = requests.post(
        f"{SUPABASE_URL}/rest/v1/lesson_drafts",
        headers={**_auth_headers(access_token), "Prefer": "return=minimal"},
        json={
            "student_id": student_id, "source_type": "transcript", "session_date": session_date,
            "transcript_text": transcript, "ai_output": ai_output, "status": "pending"
        }, timeout=15
    )
    r.raise_for_status()


class LessonRecorder:
    def __init__(self, root):
        self.root        = root
        self.recording   = False
        self.mic_frames  = []
        self.sys_frames  = []
        self.start_time  = None
        self._pa         = None
        self._mic_stream = None
        self._sys_stream = None
        self.loopback    = None
        self._sys_rate   = MIC_RATE
        self._sys_ch     = 1

        self.access_token = None
        self.students     = []      # [{id, full_name, email}]
        self._student_map = {}      # label -> id

        os.makedirs(TRANSCRIPT_DIR, exist_ok=True)
        self._build_ui()
        threading.Thread(target=self._detect, daemon=True).start()
        threading.Thread(target=self._try_restore_session, daemon=True).start()

    # ── UI ────────────────────────────────────────────────────────────────────

    def _build_ui(self):
        self.root.title("cmartwise · Lesson Recorder")
        self.root.geometry("380x400")
        self.root.resizable(False, False)
        self.root.configure(bg=BG)

        tk.Label(self.root, text="Lesson Recorder",
                 font=("Georgia", 20, "bold"), bg=BG, fg=SAND).pack(pady=(22, 2))

        tk.Label(self.root, text="cmartwise coaching",
                 font=("Arial", 9), bg=BG, fg=MUTED).pack()

        # Student picker (only meaningful once signed in)
        tk.Label(self.root, text="Student", font=("Arial", 9), bg=BG, fg=MUTED).pack(pady=(16, 2))
        self.student_var = tk.StringVar(value="(sign in to load students)")
        self.student_combo = ttk.Combobox(self.root, textvariable=self.student_var,
                                           state="disabled", width=34, values=[])
        self.student_combo.pack()

        self.signin_btn = tk.Button(
            self.root, text="Sign in to enable auto-review", font=("Arial", 8),
            bg=GREY, fg=IVORY, relief="flat", padx=8, pady=4, cursor="hand2",
            command=self._prompt_login
        )
        self.signin_btn.pack(pady=(6, 0))

        self.timer_var = tk.StringVar(value="00:00:00")
        tk.Label(self.root, textvariable=self.timer_var,
                 font=("Courier New", 30, "bold"), bg=BG, fg=IVORY).pack(pady=(16, 6))

        self.status_var = tk.StringVar(value="Detecting audio devices…")
        tk.Label(self.root, textvariable=self.status_var,
                 font=("Arial", 9), bg=BG, fg=MUTED, wraplength=340).pack()

        self.btn = tk.Button(
            self.root, text="● START RECORDING",
            font=("Arial", 12, "bold"),
            bg=ACCENT, fg="white", activebackground="#a55228",
            relief="flat", padx=24, pady=11, cursor="hand2",
            command=self._toggle
        )
        self.btn.pack(pady=18)

    # ── Device detection ─────────────────────────────────────────────────────

    def _detect(self):
        self.loopback = find_loopback()
        msg = ("Ready · both voices will be captured"
               if self.loopback else
               "Ready · mic only (student voice may be faint)")
        self.root.after(0, self.status_var.set, msg)

    # ── Auth / student list ──────────────────────────────────────────────────

    def _try_restore_session(self):
        if not HAVE_REQUESTS:
            self.root.after(0, self.status_var.set,
                             "Run setup.bat again to enable auto-review (needs the 'requests' package).")
            return
        token = load_cached_refresh_token()
        if not token:
            return
        try:
            access, refresh = refresh_session(token)
            save_refresh_token(refresh)
            self._on_signed_in(access)
        except Exception:
            pass  # cached session expired — Sign in button stays available

    def _prompt_login(self):
        email = simpledialog.askstring("Sign in", "Email:", parent=self.root)
        if not email:
            return
        password = simpledialog.askstring("Sign in", "Password:", parent=self.root, show="*")
        if not password:
            return
        self.signin_btn.config(state="disabled", text="Signing in…")
        threading.Thread(target=self._do_login, args=(email, password), daemon=True).start()

    def _do_login(self, email, password):
        try:
            access, refresh = login_password(email, password)
            save_refresh_token(refresh)
            self.root.after(0, self._on_signed_in, access)
        except Exception as e:
            self.root.after(0, self._login_failed, str(e))

    def _login_failed(self, msg):
        self.signin_btn.config(state="normal", text="Sign in to enable auto-review")
        self.status_var.set(f"Sign-in failed: {msg}")

    def _on_signed_in(self, access_token):
        self.access_token = access_token
        self.signin_btn.pack_forget()
        try:
            self.students = fetch_students(access_token)
        except Exception as e:
            self.status_var.set(f"Signed in, but couldn't load students: {e}")
            return
        labels = [f"{s.get('full_name') or s.get('email')} — {s.get('email','')}" for s in self.students]
        self._student_map = {lbl: s["id"] for lbl, s in zip(labels, self.students)}
        self.student_combo.config(values=labels, state="readonly")
        if labels:
            self.student_var.set(labels[0])
        self.status_var.set("Signed in — lessons will be sent for review automatically.")

    def _student_id(self):
        return self._student_map.get(self.student_var.get())

    # ── Recording ─────────────────────────────────────────────────────────────

    def _toggle(self):
        if not self.recording:
            self._start()
        else:
            self._stop()

    def _start(self):
        import pyaudiowpatch as pyaudio
        self._pa = pyaudio.PyAudio()
        self.mic_frames = []
        self.sys_frames = []
        self.recording  = True
        self.start_time = time.time()

        # Microphone
        self._mic_stream = self._pa.open(
            format=pyaudio.paInt16, channels=1, rate=MIC_RATE,
            input=True, frames_per_buffer=CHUNK,
            stream_callback=self._mic_cb
        )

        # System audio (loopback)
        if self.loopback:
            self._sys_rate = int(self.loopback["defaultSampleRate"])
            self._sys_ch   = min(int(self.loopback["maxInputChannels"]), 2)
            self._sys_stream = self._pa.open(
                format=pyaudio.paInt16,
                channels=self._sys_ch,
                rate=self._sys_rate,
                input=True,
                frames_per_buffer=CHUNK,
                input_device_index=int(self.loopback["index"]),
                stream_callback=self._sys_cb
            )

        self.btn.config(text="⏹  STOP & TRANSCRIBE", bg=GREY)
        self.status_var.set(
            "Recording… both voices captured" if self.loopback else "Recording… mic only"
        )
        threading.Thread(target=self._tick, daemon=True).start()

    def _mic_cb(self, data, n, t, s):
        import pyaudiowpatch as pyaudio
        self.mic_frames.append(data)
        return None, pyaudio.paContinue

    def _sys_cb(self, data, n, t, s):
        import pyaudiowpatch as pyaudio
        self.sys_frames.append(data)
        return None, pyaudio.paContinue

    def _stop(self):
        self.recording = False
        for stream in (self._mic_stream, self._sys_stream):
            if stream:
                stream.stop_stream()
                stream.close()
        if self._pa:
            self._pa.terminate()

        self.btn.config(state="disabled", text="Transcribing…", bg=GREY)
        self.status_var.set("Saving audio and running Whisper…")
        threading.Thread(target=self._transcribe, daemon=True).start()

    # ── Transcription ─────────────────────────────────────────────────────────

    def _transcribe(self):
        from scipy import signal as sig

        ts       = datetime.now().strftime("%Y-%m-%d_%H-%M")
        session_date = datetime.now().strftime("%Y-%m-%d")
        wav_path = os.path.join(TRANSCRIPT_DIR, f"lesson_{ts}.wav")
        txt_path = os.path.join(TRANSCRIPT_DIR, f"lesson_{ts}.txt")

        # Mic → float32 mono
        mic = np.frombuffer(b"".join(self.mic_frames),
                            dtype=np.int16).astype(np.float32) / 32768.0

        if self.sys_frames and self.loopback:
            raw = np.frombuffer(b"".join(self.sys_frames),
                                dtype=np.int16).astype(np.float32) / 32768.0
            # Stereo → mono
            if self._sys_ch == 2:
                raw = raw.reshape(-1, 2).mean(axis=1)
            # Resample to MIC_RATE
            if self._sys_rate != MIC_RATE:
                raw = sig.resample_poly(raw, MIC_RATE, self._sys_rate)
            # Mix (mic slightly quieter so student voice is clear)
            n     = min(len(mic), len(raw))
            mixed = np.clip(mic[:n] * 0.65 + raw[:n] * 0.80, -1.0, 1.0)
        else:
            mixed = mic

        # Save WAV
        with wave.open(wav_path, "w") as wf:
            wf.setnchannels(1)
            wf.setsampwidth(2)
            wf.setframerate(MIC_RATE)
            wf.writeframes((mixed * 32768).astype(np.int16).tobytes())

        # Whisper (downloads ~1.5 GB medium model on first run)
        self.root.after(0, self.status_var.set,
                        "Whisper is transcribing… (a few minutes for a 60-min lesson)")

        from faster_whisper import WhisperModel
        model    = WhisperModel("medium", device="cpu", compute_type="int8")
        segments, _ = model.transcribe(wav_path, language=None, beam_size=5)

        lines = [f"Lesson Transcript — {ts}", "=" * 50, ""]
        for seg in segments:
            m, s = divmod(int(seg.start), 60)
            lines.append(f"[{m:02d}:{s:02d}] {seg.text.strip()}")
        transcript_text = "\n".join(lines) + "\n"

        with open(txt_path, "w", encoding="utf-8") as f:
            f.write(transcript_text)

        # Auto-send for review, if signed in and a student is selected. Never
        # blocks or loses the local transcript if this fails for any reason.
        student_id = self._student_id() if self.access_token else None
        if self.access_token and student_id and HAVE_REQUESTS:
            self.root.after(0, self.status_var.set, "Transcript saved — sending for review…")
            try:
                student_label = self.student_var.get()
                ai_output = call_process_lesson(self.access_token, transcript_text, student_label, session_date)
                insert_draft(self.access_token, student_id, transcript_text, ai_output, session_date)
                self.root.after(0, self._done, txt_path, True)
                return
            except Exception as e:
                self.root.after(0, self._done, txt_path, False, str(e))
                return

        self.root.after(0, self._done, txt_path, False)

    def _done(self, path, sent_for_review, error=None):
        if sent_for_review:
            self.status_var.set("✓ Sent for review — open the Admin panel to approve it.")
        elif error:
            self.status_var.set(f"✓ Transcript saved locally. Auto-send failed ({error}) — paste it manually in the Admin panel.")
        elif self.access_token and not self._student_id():
            self.status_var.set("✓ Transcript saved locally. Pick a student next time to auto-send for review.")
        else:
            self.status_var.set("✓ Transcript saved — opening now")
        self.btn.config(state="normal", text="● START RECORDING", bg=ACCENT)
        os.startfile(path)

    # ── Timer ─────────────────────────────────────────────────────────────────

    def _tick(self):
        while self.recording:
            e = int(time.time() - self.start_time)
            self.root.after(0, self.timer_var.set,
                            f"{e // 3600:02d}:{(e % 3600) // 60:02d}:{e % 60:02d}")
            time.sleep(1)


if __name__ == "__main__":
    root = tk.Tk()
    LessonRecorder(root)
    root.mainloop()
