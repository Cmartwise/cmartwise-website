#!/usr/bin/env python3
"""
cmartwise Lesson Recorder
Records Google Meet lessons (both voices) and transcribes with Whisper.
Auto-detects Portuguese/English — no language switching needed.
"""

import tkinter as tk
import threading
import numpy as np
import wave
import os
import time
from datetime import datetime

CHUNK       = 1024
MIC_RATE    = 44100
TOOLS_DIR   = os.path.dirname(os.path.abspath(__file__))
TRANSCRIPT_DIR = os.path.join(TOOLS_DIR, "transcripts")

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

        os.makedirs(TRANSCRIPT_DIR, exist_ok=True)
        self._build_ui()
        threading.Thread(target=self._detect, daemon=True).start()

    # ── UI ────────────────────────────────────────────────────────────────────

    def _build_ui(self):
        self.root.title("cmartwise · Lesson Recorder")
        self.root.geometry("360x280")
        self.root.resizable(False, False)
        self.root.configure(bg=BG)

        tk.Label(self.root, text="Lesson Recorder",
                 font=("Georgia", 20, "bold"), bg=BG, fg=SAND).pack(pady=(26, 2))

        tk.Label(self.root, text="cmartwise coaching",
                 font=("Arial", 9), bg=BG, fg=MUTED).pack()

        self.timer_var = tk.StringVar(value="00:00:00")
        tk.Label(self.root, textvariable=self.timer_var,
                 font=("Courier New", 30, "bold"), bg=BG, fg=IVORY).pack(pady=12)

        self.status_var = tk.StringVar(value="Detecting audio devices…")
        tk.Label(self.root, textvariable=self.status_var,
                 font=("Arial", 9), bg=BG, fg=MUTED, wraplength=320).pack()

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

        with open(txt_path, "w", encoding="utf-8") as f:
            f.write(f"Lesson Transcript — {ts}\n{'=' * 50}\n\n")
            for seg in segments:
                m, s = divmod(int(seg.start), 60)
                f.write(f"[{m:02d}:{s:02d}] {seg.text.strip()}\n")

        self.root.after(0, self._done, txt_path)

    def _done(self, path):
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
