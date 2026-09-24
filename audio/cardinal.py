# Fits the Cardinal AIGC audio in audio/cardinal/ to the film: a 60 s score (music.mp3) and the
# whole script read in one take (voice.wav); the requests that made them are the .json files next
# to them. Writes
#   audio/vo/cardinal/<id>.wav, timing.json  the take cut into the cues.json lines, as vo.py writes them
#   audio/build/music_cardinal.wav           the score placed so its sections land on the picture
# Run after score.py and events.mjs: .venv/Scripts/python.exe audio/cardinal.py
import json
import os
import re
import subprocess
import numpy as np
from scipy import signal
from scipy.io import wavfile
from synth import SR, ns, tv
from mix import load, loudness

HERE = os.path.dirname(__file__)
ROOT = os.path.dirname(HERE)
SRC = os.path.join(HERE, 'cardinal')
OUT = os.path.join(HERE, 'build')
DUR = 60.0

# In the score's own time (s): the downbeat of its second section, the downbeat of the last one
# (where it opens up), and a quiet spot between two notes shortly before that, where it is cut.
B_SRC, C_SRC, CUT = 21.625, 46.84, 45.96
DRONE = (3.8, 4.1)   # the synth score's opening drone plays S1, and fades out under the slam at 4 s
FADE = (56.5, 60.0)  # the score is trimmed, not ended: it fades out under the end card
PRE, POST = 0.08, 0.25  # s of the take kept before and after each line's speech
LATIN = 1.5  # a Latin syllable, read by a Chinese voice, takes about this many hanzi's time
ROTATE = (300, 0.5, 4)  # all-pass sections for the voice: centre (Hz), Q, how many
SHELF = (200, -3.0)     # low shelf for the voice: corner (Hz), gain (dB)


def decode(path, ch):
    """Any file ffmpeg reads, as float at SR, channels first."""
    raw = subprocess.run(['ffmpeg', '-v', 'error', '-i', path, '-af', f'aresample={SR}:resampler=soxr:precision=28',
                          '-ac', str(ch), '-f', 'f32le', '-'], check=True, capture_output=True).stdout
    return np.frombuffer(raw, np.float32).astype(np.float64).reshape(-1, ch).T


def ramp(n, t0, t1):
    """0 before t0, 1 after t1, a raised cosine between."""
    u = np.clip((tv(n) - t0) / (t1 - t0), 0, 1)
    return 0.5 - 0.5 * np.cos(np.pi * u)


# ---------- the voice ----------
def treat(x):
    """The take as it goes into the mix. Its waveform is lopsided, as a low male voice's often is
    (the positive peaks stand about 6 dB over the negative ones), so its peaks sit far over its
    loudness, 16 dB against 11 for xiaoxiao, and would work the limiters on every syllable. A few
    all-pass sections turn the phase and even it out, which the ear doesn't hear. It is also a
    little boomy next to the other voices, so a gentle shelf takes some of the low end off."""
    f0, q, n = ROTATE
    w = 2 * np.pi * f0 / SR
    al, c = np.sin(w) / (2 * q), np.cos(w)
    for _ in range(n):
        x = signal.lfilter([1 - al, -2 * c, 1 + al], [1 + al, -2 * c, 1 - al], x)
    f0, db = SHELF  # RBJ cookbook low shelf, slope 1
    A, w = 10 ** (db / 40), 2 * np.pi * f0 / SR
    c, r = np.cos(w), np.sqrt(A) * np.sin(w) * np.sqrt(2)
    b = [A * ((A + 1) - (A - 1) * c + r), 2 * A * ((A - 1) - (A + 1) * c), A * ((A + 1) - (A - 1) * c - r)]
    a = [(A + 1) + (A - 1) * c + r, -2 * ((A - 1) + (A + 1) * c), (A + 1) + (A - 1) * c - r]
    return signal.lfilter(b, a, x)


def phrases(lines):
    """The script as (line index, phrase): each line split where a reader pauses, at its commas,
    enumeration commas and colons."""
    return [(k, p) for k, v in enumerate(lines) for p in re.split(r'[，、：；！？]', v['text'].rstrip('，。！？')) if p.strip()]


def syllables(text):
    """Roughly how long text takes to say, in hanzi: one per hanzi, digit and decimal point, and
    LATIN per vowel group of a Latin word (a final e silent, but not in -le)."""
    n = 0
    for w in re.findall(r'[A-Za-z]+|[0-9]|\.(?=[0-9])|[一-鿿]', text):
        if w.isascii() and w.isalpha():
            w = re.sub(r'(?<![b-df-hj-np-tv-z]l)e$', '', w.lower())
            n += LATIN * max(1, len(re.findall(r'[aeiouy]+', w)))
        else:
            n += 1
    return n


def runs(x):
    """Stretches of speech (start, end), s: 10 ms frames above the take's 95th percentile less
    38 dB, split wherever it is quiet for 80 ms or more."""
    w = ns(0.01)
    n = len(x) // w
    db = 10 * np.log10((x[:n * w].reshape(n, w) ** 2).mean(axis=1) + 1e-20)
    on = np.flatnonzero(db > np.percentile(db, 95) - 38)
    br = np.flatnonzero(np.diff(on) > 8)
    return [(a * 0.01, (b + 1) * 0.01) for a, b in zip(on[np.r_[0, br + 1]], on[np.r_[br, len(on) - 1]])]


def align(rs, syl):
    """The stretches split into len(syl) consecutive phrases, each as long as its syllables at one
    common pace. A pause can fall inside a phrase too, so this is solved exactly for the least
    total absolute log error — absolute, so that one phrase read slowly (the closing name) can't
    pull the rest out of place — and redone once with the pace refitted."""
    R, N = len(rs), len(syl)
    pace = (rs[-1][1] - rs[0][0]) / sum(syl)
    for _ in range(2):
        cost = np.full((N + 1, R + 1), np.inf)
        cost[0, 0] = 0.0
        back = np.zeros((N + 1, R + 1), int)
        for n in range(1, N + 1):
            for j in range(n, R + 1):
                for i in range(n - 1, j):
                    c = cost[n - 1, i] + abs(np.log((rs[j - 1][1] - rs[i][0]) / (pace * syl[n - 1])))
                    if c < cost[n, j]:
                        cost[n, j], back[n, j] = c, i
        spans, j = [], R
        for n in range(N, 0, -1):
            i = back[n, j]
            spans.append((rs[i][0], rs[j - 1][1]))
            j = i
        spans = spans[::-1]
        pace = float(np.median([(b - a) / s for (a, b), s in zip(spans, syl)]))
    return spans, pace


def cut_voice(cues):
    x = treat(decode(os.path.join(SRC, 'voice.wav'), 1)[0])
    lines, ph = cues['vo'], phrases(cues['vo'])
    syl = [syllables(p) for _, p in ph]
    parts, pace = align(runs(x), syl)
    spans = [(min(a for (a, _), (j, _) in zip(parts, ph) if j == k), max(b for (_, b), (j, _) in zip(parts, ph) if j == k))
             for k in range(len(lines))]
    d = os.path.join(HERE, 'vo', 'cardinal')
    os.makedirs(d, exist_ok=True)
    timing = {}
    print(f'voice: {len(x) / SR:.2f} s take, {pace:.3f} s per syllable; each line, and its phrases\' pace against that')
    for k, (v, (a, b)) in enumerate(zip(lines, spans)):
        lo = max(a - PRE, spans[k - 1][1] + 0.04 if k else 0.0)  # never into the neighbouring lines
        hi = min(b + POST, spans[k + 1][0] - 0.04 if k + 1 < len(spans) else len(x) / SR)
        c = x[ns(lo):ns(hi)].copy()
        n = len(c)
        c *= ramp(n, 0, 0.01) * ramp(n, n / SR, n / SR - 0.03)
        wavfile.write(os.path.join(d, v['id'] + '.wav'), SR, c.astype(np.float32))
        timing[v['id']] = dict(cue=v['t'], text=v['text'], onset=round(a - lo, 4), speech=round(b - a, 4))
        rel = ' '.join(f'{(q - p) / (pace * s):.2f}' for (p, q), (j, _), s in zip(parts, ph, syl) if j == k)
        print(f'  {v["id"]:4s} {a:6.2f}-{b:6.2f}  {b - a:4.2f} s  [{rel}]  {v["text"]}')
    with open(os.path.join(d, 'timing.json'), 'w', encoding='utf-8') as f:
        json.dump(timing, f, ensure_ascii=False, indent=1)


# ---------- the score ----------
def place_music(cues, ev):
    """Two pieces of the score, each on its own offset: up to CUT, so that the second section's
    downbeat is the cut into S5; after it, so that the last section opens as 举重若轻 lets go. The
    second offset is the later one, so the join is a moment's rest under S8's impact. Level:
    the same loudness as the synth score over the same stretch, so the effects' balance holds."""
    c = decode(os.path.join(SRC, 'music.mp3'), 2)
    synth = load(os.path.join(OUT, 'music.wav'))
    s5 = next(s['t0'] for s in cues['scenes'] if s['id'] == 'S5')
    d1, d2 = s5 - B_SRC, ev['s8']['rel'] - C_SRC
    assert d2 >= d1, (d1, d2)
    y = np.zeros((2, ns(DUR)))
    for a, b, d in ((0.0, CUT, d1), (CUT, c.shape[1] / SR, d2)):
        seg = c[:, ns(a):ns(b)]
        n = seg.shape[1]
        seg = seg * ramp(n, 0, 0.015) * ramp(n, n / SR, n / SR - 0.015)
        i0 = ns(a + d)
        m = min(n, y.shape[1] - i0)
        y[:, i0:i0 + m] += seg[:, :m]
    gain = loudness(synth[:, ns(d1):]) - loudness(y[:, ns(d1):])
    y *= 10 ** (gain / 20)
    y *= 1 - ramp(y.shape[1], *FADE)
    y += synth * (1 - ramp(synth.shape[1], *DRONE))
    wavfile.write(os.path.join(OUT, 'music_cardinal.wav'), SR, y.T.astype(np.float32))
    print(f'music: second section at {B_SRC + d1:.2f} s, last at {C_SRC + d2:.2f} s, rest {CUT + d1:.2f}-{CUT + d2:.2f} s, '
          f'gain {gain:+.2f} dB; {loudness(y):.2f} LUFS (synth score {loudness(synth):.2f})')
    print('  by scene (LUFS):', ' '.join(f'{s["t0"]}-{s["t1"]}: {loudness(y[:, ns(s["t0"]):ns(s["t1"])]):.1f}' for s in cues['scenes']))


def main():
    cues = json.load(open(os.path.join(ROOT, 'src', 'cues.json'), encoding='utf-8'))
    ev = json.load(open(os.path.join(OUT, 'events.json'), encoding='utf-8'))
    cut_voice(cues)
    place_music(cues, ev)


if __name__ == '__main__':
    main()
