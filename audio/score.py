# The score: 120 BPM (a bar every 2 s) in D minor. Heavy through the film, it turns to D major
# when 举重若轻 lets go (52.2 s). Writes audio/build/music.wav — the bed that ducks under the voice.
# Run: .venv/Scripts/python.exe audio/score.py
import os
import numpy as np
from scipy.io import wavfile
from synth import (SR, Bus, midi, ns, tv, ad, gate, curve, saw, sine, supersaw, sweep, soft, duck, shelf, butter,
                   make_ir, reverb, kick, snare, clap, hat, shaker, fm_pluck, keys, chime, sub)

DUR = 60.0
OUT = os.path.join(os.path.dirname(__file__), 'build')

BARS = [  # (start, end, chord)
    (0, 4, 'D5th'),
    (4, 6, 'Dm'), (6, 8, 'Bb'), (8, 10, 'F'), (10, 12, 'C'),
    (12, 14, 'Dm'), (14, 16, 'Bb'), (16, 18, 'C'),
    (18, 20, 'Dm'), (20, 22, 'Bb'), (22, 24, 'F'), (24, 26, 'C'),
    (26, 28, 'Dm'), (28, 30, 'Bb'), (30, 32, 'F'), (32, 34, 'C'),
    (34, 36, 'Bbmaj7'), (36, 38, 'F'), (38, 40, 'Gm7'), (40, 42, 'Bb'), (42, 43, 'Csus4'), (43, 44, 'C'),
    (44, 46, 'Dm'), (46, 48, 'Bb'), (48, 50, 'A7'),
    (50, 52, 'Dm'), (52, 60, 'Dadd9'),
]
VOICE = {  # pad voicing (MIDI), bass root (MIDI)
    'D5th': ([50, 57], 38),
    'Dm': ([57, 62, 65], 38),
    'Bb': ([58, 62, 65], 34),
    'F': ([57, 60, 65], 41),
    'C': ([55, 60, 64], 36),
    'Bbmaj7': ([57, 62, 65, 69], 34),
    'Gm7': ([58, 62, 65], 43),
    'Csus4': ([55, 60, 65], 36),
    'A7': ([55, 61, 64], 33),
    'Dadd9': ([57, 62, 64, 66, 69], 38),
}


def chord_at(t):
    for t0, t1, ch in BARS:
        if t0 <= t < t1:
            return ch
    return BARS[-1][2]


def grid(t0, t1, step, offset=0.0):
    return list(np.arange(t0 + offset, t1 - 1e-9, step))


# ---------- pads ----------
def pads():
    b = Bus(DUR)
    for i, (t0, t1, ch) in enumerate(BARS):
        notes = VOICE[ch][0]
        if ch == 'Dm' and t0 == 50:  # the heavy chord under the impact, an octave lower and wider
            notes = [45, 50, 53, 57, 62]
        a = {0: 2.2, 10: 0.03, 50: 0.01, 52: 0.35}.get(t0, 0.12)
        n = ns(t1 - t0 + 0.5)
        g = gate(n, a, t1 - t0, 0.5)
        for j, m in enumerate(notes):
            b.add(t0, supersaw(midi(m), n, seed=100 * i + j) * g, 0.5)
    x = b.x
    fc = curve(x.shape[1], [
        (0, 200), (3.9, 700), (4.0, 800), (8.9, 1900), (9.9, 350), (10.04, 4200), (12, 1500),
        (12.01, 1300), (17.9, 1800), (18, 1500), (25.9, 2800), (26, 3600), (33.9, 3400),
        (34, 1500), (43.9, 2400), (44, 700), (49.9, 5200), (50, 3200), (51.9, 1100),
        (52.2, 6500), (56, 4500), (60, 2600)])
    x = sweep(x, fc * 1.3, 'lp', 0.9)
    x = butter(x, 'highpass', 110)
    vol = curve(x.shape[1], [
        (0, 0.55), (4, 0.5), (8.9, 0.6), (9.9, 0.08), (10.04, 0.8), (12, 0.5), (18, 0.45),
        (26, 0.55), (33.8, 0.55), (34, 0.3), (44, 0.3), (49.9, 0.62), (50, 0.9), (52, 0.8),
        (52.3, 0.5), (57, 0.45), (60, 0.0)])
    return x * vol


def air():
    """Soft sine choir an octave up, for the light sections (S6, and the finale's release)."""
    b = Bus(DUR)
    for i, (t0, t1, ch) in enumerate(BARS):
        if not (34 <= t0 < 44 or t0 >= 52):
            continue
        n = ns(t1 - t0 + 0.8)
        g = gate(n, 0.5 if t0 != 52 else 0.2, t1 - t0, 0.8)
        for j, m in enumerate(VOICE[ch][0]):
            f = midi(m + 12) * (1 + 0.0025 * np.sin(2 * np.pi * (0.21 + 0.03 * j) * tv(n) + j))
            b.add(t0, sine(f, n, (i * 0.37 + j * 0.61) % 1) * g, 0.12, pan=0.4 * (j % 2 * 2 - 1))
    return b.x * curve(b.x.shape[1], [(0, 1), (57, 1), (60, 0)])


# ---------- bass ----------
def pluck_bass(f, dur=0.24, cut=1800.0, seed=0):
    n = ns(dur)
    x = saw(f, n) + 0.6 * saw(f * 1.005, n, 0.37)
    x = sweep(x, 170 + cut * np.exp(-tv(n) / 0.05), 'lp', 1.1, block=64)
    return x * ad(n, 0.003, 0.1) * 0.6


def bass():
    b = Bus(DUR)
    # sustained sub under everything that isn't the muted-pluck sections
    for t0, t1, ch in BARS:
        root = VOICE[ch][1]
        if 9.0 <= t0 < 10:  # the wall collapses: the floor drops out
            continue
        a, r = (1.6, 0.4) if t0 == 0 else (0.02, 0.25)
        on0 = 10.04 if t0 == 10 else t0
        n = ns(t1 - on0 + r)
        level = {0: 0.4, 50: 0.6}.get(t0, 0.3)
        if 34 <= t0 < 44:
            level = 0.2
        if t0 >= 52:
            level = 0.22
        b.add(on0, sub(midi(root), n) * gate(n, a, t1 - on0, r), level)
    if True:  # low D1 under the heavy chord
        n = ns(2.6)
        b.add(50.0, sub(midi(26), n, 0.3, 0.1) * gate(n, 0.005, 2.1, 0.5), 0.32)
    # muted 8th plucks: S2 (tension), S4–S5 (drive), S7 (the build)
    for t0, t1, step, cut, g in ((4.0, 9.0, 0.25, 900, 0.45), (18, 26, 0.25, 1500, 0.55),
                                  (26, 34, 0.25, 2400, 0.62), (44, 48, 0.25, 1100, 0.5),
                                  (48, 49.5, 0.125, 1900, 0.5)):
        for k, tk in enumerate(grid(t0, t1, step)):
            root = VOICE[chord_at(tk)][1]
            m = root + 12 if (26 <= tk < 34 and k % 2) else root
            acc = 1.0 if k % 2 == 0 else 0.7
            b.add(tk, pluck_bass(midi(m), cut=cut, seed=k), 0.8 * g * acc)
    return b.x


# ---------- drums ----------
KICK = kick()
KICK_SOFT = kick(f0=120, f1=48, tau=0.25, click=0.1)
SNARE, CLAP, HAT, OHAT, SHAKER = snare(), clap(), hat(), hat(tau=0.18, seed=11), shaker()


def crash(seed=12, dur=3.5):
    n = ns(dur)
    t = tv(n)
    rng = np.random.default_rng(seed)
    x = rng.standard_normal((2, n))
    x = butter(x, 'highpass', 4000, order=2) * (np.exp(-t / 0.9) * 0.7 + 0.3 * np.exp(-t / 0.08))
    return x * np.minimum(1, t / 0.002) * 0.5


def drums():
    b = Bus(DUR)
    kicks = []

    def k(t, g=1.0, soft_=False):
        b.add(t, KICK_SOFT if soft_ else KICK, 0.8 * g)
        if not soft_:
            kicks.append(t)

    # S2: a heavy heartbeat on every other beat, clock-like 8th hats
    for tk in grid(5.0, 9.0, 1.0):
        k(tk, 0.55, soft_=True)
    for j, tk in enumerate(grid(4.0, 9.0, 0.25)):
        b.add(tk, HAT, 0.18 if j % 2 else 0.28, pan=0.25)
    # S3: half-time groove
    for t0 in (12, 14, 16):
        for o in (0.0, 0.75):
            k(t0 + o, 0.75)
        b.add(t0 + 1.0, CLAP, 0.36, pan=-0.05)
        for j, tk in enumerate(grid(t0, t0 + 2, 0.125)):
            b.add(tk, HAT, [0.18, 0.08, 0.13, 0.08][j % 4], pan=0.3)
    # S4: four on the floor
    for tk in grid(18, 26, 0.5):
        k(tk, 0.85)
    for tk in grid(18, 26, 0.5, 0.25):
        b.add(tk, OHAT if tk >= 22 else HAT, 0.22 if tk >= 22 else 0.25, pan=0.2)
    for tk in grid(20, 26, 1.0, 0.5):
        b.add(tk, CLAP, 0.4)
    # S5: the peak
    b.add(26.0, crash(), 0.5)
    for tk in grid(26, 34, 0.5):
        k(tk, 0.95)
    for j, tk in enumerate(grid(26, 34, 0.125)):
        b.add(tk, HAT, [0.22, 0.09, 0.17, 0.09][j % 4], pan=0.3 if j % 2 else -0.1)
    for tk in grid(26, 34, 0.5, 0.25):
        b.add(tk, OHAT, 0.17, pan=0.15)
    for tk in grid(26, 34, 1.0, 0.5):
        b.add(tk, CLAP, 0.44)
        b.add(tk, SNARE, 0.12)
    # S6: only a shaker, late in the scene
    for j, tk in enumerate(grid(38, 43.5, 0.25)):
        b.add(tk, SHAKER, (0.07 if j % 2 else 0.045) * min(1, (tk - 37.9) / 1.5), pan=0.35)
    # S7: the rebuild
    for tk in (44.0, 45.0, 45.75):
        k(tk, 0.7)
    for tk in grid(46, 49.5, 0.5):
        k(tk, 0.85)
    for j, tk in enumerate(grid(45, 49.5, 0.25)):
        b.add(tk, HAT, 0.18 if j % 2 else 0.11, pan=0.25)
    for tk in (46.5, 47.5):
        b.add(tk, CLAP, 0.4)
    # snare roll into the impact: 8ths, 16ths, 32nds, rising
    roll = grid(48.0, 49.0, 0.25) + grid(49.0, 49.5, 0.125) + grid(49.5, 49.94, 0.0625)
    for tk in roll:
        b.add(tk, SNARE, 0.08 + 0.3 * ((tk - 48) / 2) ** 1.6, pan=-0.05)
    # the impact itself is in sfx.py; the crash rides the release of the string
    b.add(50.0, crash(seed=13, dur=4.5), 0.55)
    return b.x, kicks


# ---------- arps, keys, chimes ----------
ARP = [0, 1, 2, 3, 4, 3, 2, 1]


def arp_notes(ch, octave):
    base = sorted(VOICE[ch][0])
    tones = [m + 12 * octave for m in base] + [m + 12 * (octave + 1) for m in base]
    return [tones[i % len(tones)] for i in ARP]


def arps():
    b = Bus(DUR)
    specs = [  # t0, t1, step, octave, index, tau, gain
        (12, 18, 0.125, 0, 1.1, 0.16, 0.11),
        (18, 26, 0.125, 0, 1.6, 0.18, 0.12),
        (26, 34, 0.125, 1, 2.4, 0.2, 0.1),
        (45, 49.9, 0.125, 0, None, 0.17, 0.1),
    ]
    for t0, t1, step, octv, index, tau, g in specs:
        for j, tk in enumerate(grid(t0, t1, step)):
            ch = chord_at(tk)
            m = arp_notes(ch, octv)[j % 8]
            idx = index if index is not None else 0.8 + 2.4 * (tk - t0) / (t1 - t0)
            gg = g * (1.0 if j % 2 == 0 else 0.75)
            if t0 == 45:
                gg *= 0.4 + 0.6 * (tk - t0) / (t1 - t0)
            pan = 0.35 * (1 if j % 2 else -1) if t0 >= 26 else 0.15 * np.sin(j * 0.7)
            b.add(tk, fm_pluck(midi(m), dur=0.5, index=idx, tau=tau), 2.2 * gg, pan)
    # the release: slow, bright plucks in D major, high and far
    light = [74, 78, 81, 86, 85, 81, 78, 76]
    for j, tk in enumerate(grid(52.3, 56.3, 0.25)):
        fade = 1 - (tk - 52.3) / 4.2
        b.add(tk, fm_pluck(midi(light[j % 8]), dur=0.9, ratio=3.0, index=0.9, tau=0.35), 0.15 * fade,
              pan=0.45 * np.sin(j * 1.3))
    return b.x


def keys_layer():
    b = Bus(DUR)

    def play(t, m, vel=0.55, g=0.3, pan=None, dur=3.0):
        b.add(t, keys(midi(m), dur=dur, vel=vel, seed=int(m * 7 + t * 13)), g,
              (m - 62) / 40 if pan is None else pan)

    # S1: the heavy word lands on a low octave
    play(2.24, 26, 0.95, 0.55, 0.0, 4.0)
    play(2.24, 38, 0.85, 0.4, 0.0, 4.0)
    # S6: broken chords in 8ths
    patt = {
        'Bbmaj7': [46, 53, 57, 62, 65, 62, 57, 53],
        'F': [41, 48, 57, 60, 65, 60, 57, 48],
        'Gm7': [43, 50, 58, 62, 65, 62, 58, 50],
        'Bb': [46, 53, 58, 62, 65, 62, 58, 53],
        'Csus4': [48, 55, 60, 65],
        'C': [48, 55, 60, 64],
    }
    for t0, t1, ch in BARS:
        if 34 <= t0 < 44:
            for j, m in enumerate(patt[ch]):
                play(t0 + 0.25 * j, m, 0.45 if j else 0.6, 0.26 if j else 0.32)
    # the motif in minor, in the gap between the two lines, and a lift into S7
    for tk, m in ((37.95, 74), (38.2, 76), (38.45, 77), (38.75, 81)):
        play(tk, m, 0.5, 0.2)
    for tk, m in ((43.1, 72), (43.35, 74), (43.6, 76), (43.85, 79)):
        play(tk, m, 0.45, 0.17)
    # the release: D major add9 spread upward like a harp, then the motif in major
    for j, m in enumerate([38, 45, 52, 57, 62, 64, 66, 69, 74]):
        play(52.2 + 0.06 * j, m, 0.55, 0.26, dur=5.0)
    for tk, m in ((53.45, 74), (53.7, 76), (53.95, 78), (54.2, 81)):
        play(tk, m, 0.5, 0.2)
    # a last chord once the name has been said
    for j, m in enumerate([38, 50, 57, 64, 66, 74]):
        play(57.1 + 0.05 * j, m, 0.45, 0.22, dur=3.5)
    return b.x


def chimes():
    b = Bus(DUR)
    for j, m in enumerate([86, 93, 90, 98]):  # the spark: D6 A6 F#6 D7
        b.add(54.9 + 0.035 * j, chime(midi(m), 3.0, seed=j), 0.1, pan=0.3 * (j % 2 * 2 - 1))
    b.add(57.1, chime(midi(86), 3.0, seed=9), 0.06, pan=0.1)
    return b.x


# ---------- mixdown ----------
def main():
    os.makedirs(OUT, exist_ok=True)
    n = ns(DUR)
    dr, kicks = drums()
    pad, ai, bs, ar, ky, ch = pads(), air(), bass(), arps(), keys_layer(), chimes()
    pump = duck(n, [t for t in kicks if t >= 18], depth=0.4, release=0.17)
    pump2 = duck(n, [t for t in kicks if t >= 18], depth=0.25, release=0.14)
    hall, room = make_ir(3.0, seed=7), make_ir(1.2, seed=8, dark=2500)
    dry = pad * pump + ai + bs * pump2 + ar * pump2 + ky + ch + dr
    wet = reverb(0.3 * pad + 0.5 * ai + 0.35 * ar + 0.45 * ky + 0.6 * ch, hall) + reverb(0.12 * dr, room)
    mix = dry + wet
    mix = shelf(shelf(mix, 'low', 120, -2.0), 'high', 5000, 4.0)
    mix -= mix.mean(axis=1, keepdims=True)
    mix = soft(mix / np.abs(mix).max() * 1.1, 1.0)
    mix *= curve(n, [(0, 1), (58.2, 1), (60, 0)])
    mix *= 0.89 / np.abs(mix).max()
    wavfile.write(os.path.join(OUT, 'music.wav'), SR, mix.T.astype(np.float32))
    for name, x in (('pad', pad), ('bass', bs), ('drums', dr), ('arps', ar), ('keys', ky)):
        print(f'{name:6s} rms {20 * np.log10(np.sqrt((x ** 2).mean()) + 1e-12):6.1f} dB')
    print('written', os.path.join(OUT, 'music.wav'))


if __name__ == '__main__':
    main()
