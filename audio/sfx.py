# Sound effects, each on the frame it belongs to: the times come from audio/build/events.json,
# which audio/events.mjs computes from the scenes' own code. Writes audio/build/sfx.wav (not
# normalised: the levels here are the balance against the music, mix.py sets the overall gain).
# The pitched sounds take their notes from the score they play over, so there is one stem per
# score: sfx.wav for the synth score (score.py, D minor) and sfx_cardinal.wav for the Cardinal one
# (audio/cardinal.py, centred on A; each note was checked against the bar it lands in).
# Run: node audio/events.mjs && .venv/Scripts/python.exe audio/sfx.py [synth|cardinal]
import json
import os
import sys
import numpy as np
from scipy.io import wavfile
from synth import (SR, TAU, Bus, midi, ns, tv, noise, pan2, ad, curve, sweep, butter, soft, make_ir, reverb,
                   kick, ks, chime)

DUR = 60.0
OUT = os.path.join(os.path.dirname(__file__), 'build')
PITCH = {  # midi notes of every pitched sound, per score
    'synth': dict(bloom=88, row=[81, 86, 89], sparkle=[77, 79, 82, 84, 86, 89, 91, 94, 96, 98, 101, 103],
                  hl=89, harp=[65, 67, 69, 72, 74, 77, 79, 81, 84, 86, 89, 91, 93, 96],
                  lit=[86, 89, 91, 93, 96, 98, 101], shimmer=[81, 85, 88, 91, 93], string=38, rise=74),
    'cardinal': dict(bloom=86, row=[81, 86, 88], sparkle=[76, 79, 81, 83, 86, 88, 91, 93, 95, 98, 100, 103],
                     hl=85, harp=[61, 64, 66, 69, 73, 76, 78, 81, 85, 88, 90, 93, 97, 100],
                     lit=[86, 88, 91, 93, 96, 98, 100], shimmer=[81, 86, 88, 93, 98], string=33, rise=69),
}
RNG = DRY = WET = K = None  # set per score in main()


def put(t, clip, g=1.0, pan=0.0, send=0.25):
    DRY.add(t, clip, g, pan)
    if send:
        WET.add(t, clip, g * send, pan)


def ioc(u):
    u = np.clip(u, 0, 1)
    return np.where(u < 0.5, 4 * u ** 3, 1 - (-2 * u + 2) ** 3 / 2)


def step2(t, f=2.2, z=0.45):
    w, r = TAU * f, np.sqrt(1 - z * z)
    y = 1 - np.exp(-z * w * t) * (np.cos(w * r * t) + z / r * np.sin(w * r * t))
    return np.where(t > 0, y, 0.0)


# ---------- the sounds ----------
def tick(f=2400.0, tau=0.012, click=0.5, seed=0, lp=None):
    """UI tick: a pinged sine and a 2 ms click of noise."""
    n = ns(max(0.05, 6 * tau))
    t = tv(n)
    x = np.sin(TAU * f * t) * np.exp(-t / tau)
    x += butter(noise(n, seed), 'bandpass', [2000, 9000]) * np.exp(-t / 0.0015) * click
    x *= np.minimum(1, t / 0.0004)
    return butter(x, 'lowpass', lp) if lp else x


def pop(f=700.0, tau=0.05, bend=0.6):
    """A dot appearing: a sine that drops onto its pitch."""
    n = ns(7 * tau)
    t = tv(n)
    fr = f * (1 + bend * np.exp(-t / 0.012))
    return np.sin(TAU * np.cumsum(fr) / SR) * np.exp(-t / tau) * np.minimum(1, t / 0.001)


def ping(f, tau=0.04, seed=0):
    """Glassy grain: a sine and a quickly dying inharmonic partial."""
    n = ns(6 * tau)
    t = tv(n)
    ph = np.random.default_rng(seed).random(2) * TAU
    x = np.sin(TAU * f * t + ph[0]) + 0.3 * np.sin(TAU * 2.76 * f * t + ph[1]) * np.exp(-t / (0.4 * tau))
    return x * np.exp(-t / tau) * np.minimum(1, t / 0.0015)


def pebble(f, seed=0):
    """A falling cell: a tiny tick whose pitch sags."""
    n = ns(0.06)
    t = tv(n)
    fr = f * (1 - 5 * t)
    return np.sin(TAU * np.cumsum(fr) / SR + seed) * np.exp(-t / 0.012) * np.minimum(1, t / 0.0005)


def whoosh(dur, fc, env, pan=0.0, q=1.0, seed=0, spread=False):
    """Band-passed noise. fc and env are (time, value) lists over the clip; pan is a scalar or
    a (time, pan) list. spread=True sends two decorrelated layers to mirrored pans."""
    n = ns(dur)
    f, e = curve(n, fc), curve(n, env)
    p = curve(n, pan) if isinstance(pan, list) else np.full(n, float(pan))
    a = sweep(noise(n, seed), f, 'bp', q) * e
    if not spread:
        return pan2(a, p)
    b = sweep(noise(n, seed + 1), f * 1.06, 'bp', q) * e
    return (pan2(a, -p) + pan2(b, p)) * np.sqrt(0.5)


def boom(f0=90.0, f1=34.0, tp=0.06, tau=0.6, dur=2.5):
    """Sub drop: a sine falling from f0 to f1."""
    n = ns(dur)
    t = tv(n)
    f = f1 + (f0 - f1) * np.exp(-t / tp)
    return soft(np.sin(TAU * np.cumsum(f) / SR) * np.exp(-t / tau) * np.minimum(1, t / 0.002), 1.5)


def crack(dur, lo, hi, tau, seed=0):
    """Band-limited noise with a sharp attack, a short decay and a longer tail (stereo)."""
    n = ns(dur)
    t = tv(n)
    e = (np.exp(-t / tau) + 0.15 * np.exp(-t / (5 * tau))) * np.minimum(1, t / 0.0005)
    return np.stack([butter(noise(n, seed + c), 'bandpass', [lo, hi]) * e for c in (0, 1)])


def thud(w, seed=0, root=38):
    """A character landing on the thread: felt thump, a dull pluck of the string it lands on,
    a little ink. w is its weight (1 normal, 3 for S1's 重, 0.25 for punctuation)."""
    dur = 1.0 + 0.5 * w
    n = ns(dur)
    t = tv(n)
    f = 46 + 80 * np.exp(-t / 0.025)
    body = np.sin(TAU * np.cumsum(f) / SR) * np.exp(-t / (0.08 + 0.04 * w))
    s = butter(ks(midi(root), dur, t60=0.5 + 0.4 * w, bright=0.3, seed=seed), 'lowpass', 700 + 250 * w)
    ink = butter(noise(n, seed + 50), 'bandpass', [250, 2200]) * np.exp(-t / 0.012)
    return (body + 0.4 * s + 0.3 * ink) * np.minimum(1, t / 0.0015)


def heft(w):
    """A thud's gain: lighter ones are quieter; heavier ones land longer but only a little
    louder (their peaks would just work the limiter)."""
    return 0.36 * w ** (0.6 if w < 1 else 0.3)


def harp(f, seed=0):
    return ks(f, 1.8, t60=1.4, bright=0.55, seed=seed) * ad(ns(1.8), 0.001, 0.9)


def glide(dur, f0, f1):
    """A soft sine sliding from f0 to f1 along the dot's ease, loudest mid-way."""
    n = ns(dur)
    u = tv(n) / dur
    f = f0 * (f1 / f0) ** ioc(u)
    return np.sin(TAU * np.cumsum(f) / SR) * np.sin(np.pi * np.clip(u, 0, 1)) ** 2


def riser(dur, seed=0):
    """Noise whose band climbs from 300 Hz to 7 kHz, and a tone climbing A3 to A4; stops dead."""
    n = ns(dur)
    u = tv(n) / dur
    e = u ** 2.5 * np.minimum(1, (dur - tv(n)) / 0.004)
    x = whoosh(dur, [(0, 300), (dur, 7000)], [(0, 1), (dur, 1)], 0.6, q=0.9, seed=seed, spread=True)
    f = midi(57) * 2 ** u
    tone = np.sin(TAU * np.cumsum(f) / SR) + 0.3 * np.sin(2 * TAU * np.cumsum(f) / SR)
    return (x + 0.25 * pan2(tone, 0.0)) * e


def reverse_shimmer(dur, notes, seed=0):
    """Chimes and hiss in a hall, played backwards: swells into the end and stops."""
    n = ns(dur + 2.5)
    x = np.zeros((2, n))
    for j, m in enumerate(notes):
        c = chime(midi(m), 2.0, seed=seed + j)
        i0 = ns(0.012 * j)
        x[:, i0:i0 + len(c)] += pan2(c, 0.5 * (j % 2 * 2 - 1))[:, :n - i0] * 0.4
    t = tv(n)
    x += np.stack([butter(noise(n, seed + 20 + c), 'bandpass', [2000, 9000]) for c in (0, 1)]) * np.exp(-t / 0.35) * 0.5
    x = x + 0.9 * reverb(x, make_ir(2.2, seed=seed + 30))
    y = x[:, :ns(dur)][:, ::-1].copy()
    return y * np.minimum(1, (dur - tv(y.shape[1])) / 0.003)


# ---------- the scenes ----------
def s1(e):
    # the ember wakes, the thread opens outward from it
    put(e['ember'], ping(midi(93), 0.12, seed=1), 0.05, 0.0, 0.5)
    a = e['open'][0]
    put(a - 0.02, whoosh(1.0, [(0, 5500), (0.2, 3500), (1.0, 1800)], [(0, 0), (0.03, 1), (0.25, 0.45), (1.0, 0)],
                         [(0, 0.0), (0.6, 1.0)], q=0.9, seed=3, spread=True), 0.22, send=0.4)
    # eight characters land on it; 很重 lands hardest
    for i, L in enumerate(e['land']):
        w = L['w']
        put(L['t'], thud(w, seed=10 + i, root=45 if w < 0.5 else 38), heft(w), 0.6 * L['pan'], 0.3)
    big = max(e['land'], key=lambda L: L['w'])
    put(big['t'] - 0.36, whoosh(0.4, [(0, 700), (0.36, 250)], [(0, 0), (0.3, 1), (0.36, 1), (0.4, 0)],
                                0.6 * big['pan'], q=1.2, seed=5), 0.2, send=0.2)
    put(big['t'], boom(85, 40, 0.05, 0.6, 2.5), 0.25, 0.0, 0.25)


def s2(e):
    # the code wall slams down
    put(4.0, boom(75, 42, 0.04, 0.3, 1.5), 0.4, 0.0, 0.2)
    put(4.0, butter(crack(0.8, 150, 1800, 0.03, seed=20), 'lowpass', 1500), 0.3, 0.0, 0.3)
    # code scrolling past, faster and faster: a soft teletype
    for j, L in enumerate(e['lines']):
        put(L['t'], tick(1100 + 500 * RNG.random(), 0.006, 0.8, seed=200 + j, lp=4000), 0.03, 0.7 * L['pan'], 0.1)
    # the counter rolling up to 680,000 and locking
    for j, tk in enumerate(e['count']):
        last = j == len(e['count']) - 1
        put(tk, tick(1800 if last else 2600, 0.03 if last else 0.008, 0.6, seed=300 + j), 0.11 if last else 0.06, -0.55, 0.15)
    # the wall squashes into the thread: a swell that stops dead ...
    a, b = e['squash']
    d = b - a
    put(a, whoosh(d, [(0, 400), (d, 4500)], [(0, 0), (0.6 * d, 0.25), (d - 0.01, 1), (d, 0)], [(0, 0.9), (d, 0.0)],
                  q=0.8, seed=21, spread=True), 0.3, send=0.2)
    # ... and after a breath the thread blooms (不到一天。)
    t = e['bloom']
    put(t, boom(70, 40, 0.05, 0.35, 1.8), 0.28, 0.0, 0.4)
    put(t, whoosh(1.6, [(0, 6000), (1.6, 1500)], [(0, 0), (0.02, 1), (1.6, 0)], 0.8, q=0.7, seed=22, spread=True), 0.1, send=0.6)
    put(t + 0.02, chime(midi(K['bloom']), 2.5, seed=2), 0.03, 0.2, 0.7)


def s3(e):
    # hour marks draw in, left to right
    for h, tk in enumerate(e['marks']):
        put(tk, tick(3200, 0.004, 0.4, seed=400 + h), 0.035, -0.85 + 1.7 * h / 18, 0.1)
    # the playhead passes each hour; every third a deeper tock
    for h, H in enumerate(e['hours']):
        mj = H['major']
        put(H['t'], tick(1500 if mj else 2100, 0.02 if mj else 0.008, 0.5, seed=420 + h, lp=6000),
            0.11 if mj else 0.045, 0.8 * H['pan'], 0.2)
    # the big 18
    put(e['n18'], boom(110, 60, 0.03, 0.12, 0.6), 0.2, -0.6, 0.3)
    put(e['n18'], chime(midi(86), 1.6, seed=3), 0.035, -0.6, 0.6)
    # it runs on off the right edge
    a, b = e['exit']
    d = b - a
    put(a, whoosh(d + 0.3, [(0, 1200), (d, 3800), (d + 0.3, 2500)], [(0, 0), (0.7 * d, 0.6), (d, 1), (d + 0.3, 0)],
                  [(0, 0.7), (d + 0.3, 1.0)], q=1.1, seed=31), 0.12, send=0.3)


def s4(e):
    # each benchmark row lands a step higher (K['row'])
    for i, R in enumerate(e['rows']):
        tb = R['tb']
        # the axis draws left to right, Opus 5 and Fable 5.1 pop up, the clay dot appears ...
        put(tb, whoosh(0.5, [(0, 1800), (0.45, 3000)], [(0, 0), (0.05, 1), (0.45, 0.3), (0.5, 0)], [(0, -0.42), (0.45, 0.85)],
                       q=2.0, seed=40 + i), 0.065, send=0.2)
        put(tb + 0.25, pop(520, 0.05), 0.11, R['o5'], 0.2)
        put(tb + 0.35, pop(640, 0.05), 0.11, R['f51'], 0.2)
        put(tb + 0.40, pop(820, 0.06), 0.14, R['o5'], 0.25)
        # ... glides out ahead of them and lands with a ping
        put(tb + 0.45, glide(0.65, midi(K['row'][i] - 12), midi(K['row'][i])), 0.045, (R['o5'] + R['o55']) / 2, 0.3)
        put(tb + 1.1, chime(midi(K['row'][i]), 2.0, seed=40 + i), 0.1, R['o55'], 0.5)
    # the headline (比肩 Claude Fable 5.1) and the three deltas
    put(e['head'] - 0.05, whoosh(1.2, [(0, 900), (1.15, 2800)], [(0, 0), (0.1, 0.6), (1.1, 0.4), (1.2, 0)],
                                 [(0, -0.85), (1.15, 0.2)], q=1.5, seed=45), 0.065, send=0.3)
    for i, tk in enumerate(e['delta']):
        put(tk, pop(900 + 120 * i, 0.04), 0.09, 0.3 + 0.1 * i, 0.3)


def s5(e):
    # 1,300 cells fill in left to right: a fizz of tiny ticks, higher at the top
    for j, c in enumerate(e['fill']):
        put(c['t'], tick(2600 + 180 * (9 - c['r']) + 300 * RNG.random(), 0.003, 0.9, seed=j % 97), 0.018, 0.8 * c['pan'], 0.1)
    # the right 40% trembles, cracks off and falls away
    tr = crack(0.6, 150, 1200, 10.0, seed=50) * curve(ns(0.6), [(0, 0), (0.1, 1), (0.35, 0.6), (0.6, 0)])
    put(28.43, tr * (1 + 0.8 * np.sin(TAU * 30 * tv(ns(0.6)))), 0.05, 0.5, 0.2)
    t = e['crack']
    put(t, crack(0.6, 900, 6000, 0.03, seed=51), 0.2, 0.5, 0.3)
    put(t, boom(120, 55, 0.02, 0.1, 0.5), 0.25, 0.5, 0.2)
    put(t, whoosh(0.9, [(0, 2500), (0.9, 500)], [(0, 0), (0.05, 1), (0.9, 0)], 0.55, q=0.8, seed=52), 0.08, send=0.3)
    for j, c in enumerate(e['fall']):
        put(c['t'], pebble(900 + 1600 * RNG.random(), seed=j), 0.03, 0.8 * c['pan'], 0.15)
    # what's left lights up, left to right: a sparkle up a pentatonic
    a, b = e['light']
    p0, p1 = e['light_pan']
    put(a, whoosh(b - a, [(0, 3500), (b - a, 9000)], [(0, 0), (0.1, 1), (b - a, 0)], [(0, p0), (0.35, p1)], q=2.5, seed=53), 0.07, send=0.5)
    for j, m in enumerate(K['sparkle']):
        put(a + 0.3 * (7 * j) / 78, ping(midi(m), 0.08, seed=500 + j), 0.04, p0 + (p1 - p0) * j / 11, 0.5)
    put(e['r40'], pop(430, 0.09, 0.3), 0.09, 0.75, 0.3)
    # the replies typing: Opus 5.5 bright and forward, Opus 5 dull and behind
    for j, c in enumerate(e['type']):
        if c['fast']:
            put(c['t'], tick(1900, 0.006, 0.9, seed=600 + j, lp=7000), 0.09, 0.7 * c['pan'], 0.1)
        else:
            put(c['t'], tick(1300, 0.006, 0.6, seed=600 + j, lp=3000), 0.055, 0.7 * c['pan'] - 0.1, 0.1)
    put(e['r30'], pop(480, 0.09, 0.3), 0.09, 0.7, 0.3)


def s6(e):
    # the characters that matter light up ...
    put(e['hl'], whoosh(0.6, [(0, 2500), (0.5, 4500)], [(0, 0), (0.08, 1), (0.6, 0)], [(0, -0.8), (0.5, 0.4)], q=1.5, seed=60), 0.06, send=0.4)
    put(e['hl'] + 0.05, chime(midi(K['hl']), 1.5, seed=6), 0.045, -0.3, 0.6)
    # ... fly to the top one after another (a harp run) and settle
    for j, m in enumerate(K['harp']):
        put(e['fly'] + 0.044 * j, harp(midi(m), seed=j), 0.085, -0.75 + 0.07 * j, 0.45)
    for j in range(e['n']):
        put(e['fly'] + e['stag'] * j + e['dur'], tick(1600, 0.005, 0.5, seed=700 + j, lp=3500), 0.032, -0.8 + (j % 14) / 13, 0.1)
    # the rest of the reply blows away
    a, b = e['gone']
    d = b - a + 0.3
    put(a, whoosh(d, [(0, 1500), (0.8, 3500), (d, 5000)], [(0, 0), (0.4, 0.8), (d, 0)], [(0, -0.3), (d, 0.6)], q=0.7, seed=61), 0.075, send=0.4)
    # the underline draws under the conclusion
    a, b = e['line']
    p0, p1 = e['line_pan']
    put(a, whoosh(0.6, [(0, 1600), (0.5, 4200)], [(0, 0), (0.05, 1), (0.5, 0.5), (0.6, 0)], [(0, p0), (0.5, p1)], q=2.2, seed=62), 0.09, send=0.3)


def s7(e):
    # a wave of review lights 2,000 dots: a rain of glassy grains, higher toward the top
    for j, d in enumerate(e['lit']):
        m = K['lit'][min(6, int((39 - d['j']) / 40 * 7))]
        put(d['t'], ping(midi(m) * (1 + 0.004 * (RNG.random() - 0.5)), 0.035, seed=j), 0.01, 0.9 * d['pan'], 0.35)
    # the thread closes the boundary: a pen stroke that follows its head
    L = np.array(e['loop'])
    t0, d = L[0, 0], L[-1, 0] - L[0, 0]
    n = ns(d)
    speed = np.sin(np.pi * tv(n) / d)
    x = sweep(noise(n, 71), 2400 + 900 * speed, 'bp', 1.8) * speed
    put(t0, pan2(x, np.interp(t0 + tv(n), L[:, 0], L[:, 1])), 0.08, send=0.3)
    # the build, and everything gathering into the ember (a shimmer, backwards) — then a breath
    a, b = e['gather']
    put(46.5, riser(b - 46.5, seed=72), 0.1, send=0.3)
    put(a, reverse_shimmer(b - a, K['shimmer'], seed=73), 0.25, send=0.1)


def s8(e):
    # impact: the thread snaps out to both edges
    t = e['hit']
    put(t, boom(95, 38, 0.07, 0.55, 3.0), 0.45, 0.0, 0.3)
    put(t, kick(f0=200, f1=55, tp=0.02, tau=0.15, dur=0.6, click=0.5), 0.34, 0.0, 0.2)
    put(t, crack(2.5, 700, 9000, 0.06, seed=81), 0.19, 0.0, 0.6)
    put(t, whoosh(0.5, [(0, 8000), (0.14, 3000), (0.5, 1500)], [(0, 0), (0.005, 1), (0.14, 0.5), (0.5, 0)], [(0, 0.0), (0.14, 1.0)],
                  q=0.8, seed=82, spread=True), 0.25, send=0.4)
    # 举重若轻 lands, a character per syllable; 重 falls hardest
    for i, (tl, w, p) in enumerate(zip(e['lands'], e['weights'], e['pans'])):
        put(tl, thud(w, seed=90 + i, root=K['string']), heft(w), 0.6 * p, 0.3)
    tl = e['lands'][1]
    put(tl - 0.36, whoosh(0.4, [(0, 700), (0.36, 250)], [(0, 0), (0.3, 1), (0.36, 1), (0.4, 0)], 0.6 * e['pans'][1], q=1.2, seed=94), 0.18, send=0.2)
    put(tl, boom(80, 40, 0.05, 0.5, 2.2), 0.18, 0.0, 0.25)
    # the load lets go and the string whips taut: its pitch rises with the tension
    t, pk = e['rel'], e['peak'] - e['rel']
    n = ns(3.0)
    tt = tv(n)
    rel = step2(tt, 1.4, 0.32)
    ph = TAU * np.cumsum(midi(K['string']) * 2 ** rel) / SR
    tone = (np.sin(ph) + 0.4 * np.sin(2 * ph) + 0.2 * np.sin(3 * ph)) * ad(n, 0.02, 0.8)
    air = sweep(noise(n, 85), 600 * 2 ** (2.5 * rel), 'bp', 1.0) * np.exp(-np.maximum(tt - pk, 0) / 0.3) * np.minimum(1, tt / 0.05)
    put(t, 0.6 * tone + 0.5 * air, 0.2, 0.0, 0.5)
    # the thread draws back into the ember ...
    a, b = e['ret']
    d = b - a
    put(a, whoosh(d + 0.05, [(0, 900), (d, 3500)], [(0, 0), (0.5 * d, 1), (d, 0.6), (d + 0.05, 0)], [(0, 1.0), (d, 0.0)],
                  q=1.4, seed=86, spread=True), 0.12, send=0.35)
    # ... which rises an octave ...
    a, b = e['rise']
    d = b - a
    n = ns(d + 0.05)
    u = tv(n) / d
    f = midi(K['rise']) * 2 ** ioc(u)
    x = np.sin(TAU * np.cumsum(f) / SR) * (0.3 + 0.7 * ioc(u)) * np.minimum(1, tv(n) / 0.05) * np.clip((d + 0.05 - tv(n)) / 0.05, 0, 1)
    put(a, x, 0.05, 0.0, 0.5)
    # ... and bursts into the spark: crackle, a soft thump, a breath of air
    t = e['burst']
    for j in range(36):
        put(t + 0.35 * (j / 36) ** 1.8 + 0.004 * RNG.random(), tick(3000 + 5000 * RNG.random(), 0.002, 1.0, seed=900 + j),
            0.05 * (1 - j / 40), RNG.uniform(-0.6, 0.6), 0.5)
    put(t, boom(110, 55, 0.02, 0.12, 0.8), 0.25, 0.0, 0.4)
    put(t, whoosh(1.2, [(0, 7000), (1.2, 2000)], [(0, 0), (0.01, 1), (1.2, 0)], 0.7, q=0.7, seed=91, spread=True), 0.1, send=0.6)


def cuts(e):
    """A whoosh into each hard cut between scenes (4 and 50 have their own hits)."""
    for i, tc in enumerate(c for c in e if c not in (4, 50)):
        put(tc - 0.55, whoosh(0.9, [(0, 600), (0.55, 3200), (0.9, 1500)], [(0, 0), (0.5, 1), (0.56, 0.8), (0.9, 0)],
                              [(0, -0.3), (0.9, 0.3)], q=0.9, seed=100 + i), 0.14, send=0.3)


def main():
    global RNG, DRY, WET, K
    ev = json.load(open(os.path.join(OUT, 'events.json'), encoding='utf-8'))
    for score in sys.argv[1:] or PITCH:
        RNG, DRY, WET, K = np.random.default_rng(2026), Bus(DUR), Bus(DUR), PITCH[score]
        for name, fn in (('s1', s1), ('s2', s2), ('s3', s3), ('s4', s4), ('s5', s5), ('s6', s6), ('s7', s7), ('s8', s8)):
            fn(ev[name])
        cuts(ev['cuts'])
        x = DRY.x + reverb(WET.x, make_ir(2.4, seed=21))
        x = butter(x, 'highpass', 32)
        x *= curve(x.shape[1], [(0, 1), (59.3, 1), (60, 0)])
        peak = np.abs(x).max()  # float32 keeps peaks over 1.0; mix.py limits the final mix
        path = os.path.join(OUT, 'sfx.wav' if score == 'synth' else f'sfx_{score}.wav')
        wavfile.write(path, SR, x.T.astype(np.float32))
        for a, b in ((0, 4), (4, 12), (12, 18), (18, 26), (26, 34), (34, 44), (44, 50), (50, 60)):
            s = x[:, ns(a):ns(b)]
            print(f'{a:2d}-{b:2d}s  rms {20 * np.log10(np.sqrt((s ** 2).mean()) + 1e-12):6.1f} dB  peak {20 * np.log10(np.abs(s).max() + 1e-12):6.1f} dB')
        print('written', path, f'peak {peak:.3f}')

if __name__ == '__main__':
    main()
