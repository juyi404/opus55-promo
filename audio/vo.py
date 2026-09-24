"""Generate the voiceover with edge-tts: one clip per cue line, per voice.

Writes audio/vo/<voice>/<id>.wav (48 kHz mono) and audio/vo/<voice>/timing.json
with the speech onset/duration and word boundaries (relative to speech onset),
so the mixer can place each line so that speech starts exactly on its cue.
"""
import asyncio, json, subprocess, sys, wave
from pathlib import Path

import numpy as np
import edge_tts

ROOT = Path(__file__).resolve().parents[1]
CUES = json.loads((ROOT / "src" / "cues.json").read_text(encoding="utf-8"))

VOICES = {
    "xiaoxiao": dict(voice="zh-CN-XiaoxiaoNeural", rate="-6%", pitch="+0Hz"),
    "yunjian":  dict(voice="zh-CN-YunjianNeural",  rate="-8%", pitch="-2Hz"),
}
SR = 48000


async def synth(text, out_mp3, voice, rate, pitch):
    comm = edge_tts.Communicate(text, voice, rate=rate, pitch=pitch, boundary="WordBoundary")
    words = []
    with open(out_mp3, "wb") as f:
        async for chunk in comm.stream():
            if chunk["type"] == "audio":
                f.write(chunk["data"])
            elif chunk["type"] == "WordBoundary":
                words.append(dict(text=chunk["text"], t=chunk["offset"] / 1e7, d=chunk["duration"] / 1e7))
    return words


def to_wav(src, dst):
    subprocess.run(["ffmpeg", "-y", "-v", "error", "-i", str(src), "-ar", str(SR), "-ac", "1",
                    "-c:a", "pcm_s16le", str(dst)], check=True)


def read_wav(path):
    with wave.open(str(path)) as w:
        x = np.frombuffer(w.readframes(w.getnframes()), dtype=np.int16).astype(np.float32) / 32768
    return x


def speech_bounds(x, thresh_db=-42.0):
    win = int(0.01 * SR)
    n = len(x) // win
    rms = np.sqrt(np.mean(x[: n * win].reshape(n, win) ** 2, axis=1) + 1e-12)
    loud = np.where(20 * np.log10(rms) > thresh_db)[0]
    return loud[0] * win / SR, (loud[-1] + 1) * win / SR


async def main(names):
    for name in names:
        cfg = VOICES[name]
        d = ROOT / "audio" / "vo" / name
        d.mkdir(parents=True, exist_ok=True)
        timing = {}
        for line in CUES["vo"]:
            mp3 = d / f"{line['id']}.mp3"
            wav = d / f"{line['id']}.wav"
            words = await synth(line["text"], mp3, **cfg)
            to_wav(mp3, wav)
            mp3.unlink()
            x = read_wav(wav)
            on, off = speech_bounds(x)
            timing[line["id"]] = dict(
                cue=line["t"], text=line["text"], onset=round(on, 3), speech=round(off - on, 3),
                words=[dict(text=w["text"], t=round(w["t"] - on, 3), d=round(w["d"], 3)) for w in words],
            )
            print(f"{name} {line['id']:4s} cue {line['t']:5.2f}  speech {off - on:4.2f}s  "
                  f"-> ends {line['t'] + off - on:5.2f}   {' '.join(w['text'] for w in words)}")
        (d / "timing.json").write_text(json.dumps(timing, ensure_ascii=False, indent=1), encoding="utf-8")


if __name__ == "__main__":
    asyncio.run(main(sys.argv[1:] or list(VOICES)))
