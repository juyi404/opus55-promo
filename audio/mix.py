# The final mixes, one for each of MIXES: a score with its effects, and a voice or none. The
# voice goes on its cues, lightly levelled; the music ducks under it — mostly in the voice's band,
# and deeper where the music is loud; the effects sit on top and don't duck. Each mix then goes
# to -14 LUFS (BS.1770) under a -1.5 dBTP true-peak ceiling. Writes audio/build/mix_<name>.wav.
# Run: .venv/Scripts/python.exe audio/mix.py [name ...]
import json
import os
import sys
from functools import cache
import numpy as np
from scipy import signal
from scipy.io import wavfile
from scipy.ndimage import minimum_filter1d
from synth import SR, ns, tv, butter

DUR = 60.0
HERE = os.path.dirname(__file__)
OUT = os.path.join(HERE, 'build')
MIXES = {  # name: score, its effects (both in audio/build), voice (audio/vo/<voice>)
    'cardinal': ('music_cardinal.wav', 'sfx_cardinal.wav', 'cardinal'),
    'xiaoxiao': ('music_cardinal.wav', 'sfx_cardinal.wav', 'xiaoxiao'),
    'music': ('music_cardinal.wav', 'sfx_cardinal.wav', None),
    'synth_xiaoxiao': ('music.wav', 'sfx.wav', 'xiaoxiao'),  # the first cut, on the synth score
    'synth_yunjian': ('music.wav', 'sfx.wav', 'yunjian'),
    'synth_music': ('music.wav', 'sfx.wav', None),
}

LEVEL = 0.5              # each line moves this far toward its voice's median loudness
VO_OVER = 3.5            # LU: the voice over the music under it, before the duck ...
RATIO = 9.0              # LU: ... and over the ducked music at least this much
DEPTH = (7.0, 12.0)      # dB: range of the duck in the voice's band
VO_PLR = 10.0            # dB: the voice's peaks held this far over its loudness, so they don't work the master limiter
SHARE = (0.5, 1.0, 0.6)  # how much of the duck the low (<250 Hz), mid and high (>5 kHz) bands take
EASE_IN, EASE_OUT, BRIDGE = 0.15, 0.4, 0.7  # s: down ahead of speech, back up after; shorter gaps stay down
TARGET, CEILING = -14.0, -1.5  # LUFS, dBTP
SECTIONS = ((0, 4), (4, 12), (12, 18), (18, 26), (26, 34), (34, 44), (44, 50), (50, 60))


def load(path):
    sr, x = wavfile.read(path)
    assert sr == SR, (path, sr)
    x = x.astype(np.float64) / (32768.0 if x.dtype == np.int16 else 1.0)
    return x.T if x.ndim == 2 else x


@cache
def stem(name):
    return load(os.path.join(OUT, name))


# ---------- loudness (ITU-R BS.1770) ----------
# K-weighting at 48 kHz: a high shelf for the head, then the RLB high-pass
K1 = ([1.53512485958697, -2.69169618940638, 1.19839281085285], [1.0, -1.69065929318241, 0.73248077421585])
K2 = ([1.0, -2.0, 1.0], [1.0, -1.99004745483398, 0.99007225036621])


def power(x):
    """K-weighted power summed over the channels (a mono signal plays on both)."""
    x = np.atleast_2d(x)
    z = signal.lfilter(*K2, signal.lfilter(*K1, x, axis=-1), axis=-1) ** 2
    return z.sum(axis=0) * (2 if len(x) == 1 else 1)


def lufs(p):
    return -0.691 + 10 * np.log10(np.maximum(p, 1e-20))


def loudness(x):
    """Integrated loudness: 400 ms blocks every 100 ms, gated at -70 LUFS and 10 LU under their mean."""
    p = power(x)
    n, h = ns(0.4), ns(0.1)
    if len(p) < n:
        return float(lufs(p.mean()))
    c = np.concatenate([[0.0], np.cumsum(p)])
    i = np.arange(0, len(p) - n + 1, h)
    z = (c[i + n] - c[i]) / n
    z = z[lufs(z) > -70]
    z = z[lufs(z) > lufs(z.mean()) - 10]
    return float(lufs(z.mean()))


def true_peak(x):
    return float(np.abs(signal.resample_poly(x, 4, 1, axis=-1)).max())


# ---------- voice ----------
def voice(name):
    """The voice on its cues: each line placed so its first syllable lands on the cue, and pulled
    part of the way toward the voice's median loudness. Returns the track, the speech spans
    (start, end, id) and the median loudness."""
    d = os.path.join(HERE, 'vo', name)
    lines = json.load(open(os.path.join(d, 'timing.json'), encoding='utf-8'))
    clips = {lid: butter(load(os.path.join(d, lid + '.wav')), 'highpass', 70) for lid in lines}
    loud = {lid: loudness(clips[lid][ns(e['onset']):ns(e['onset'] + e['speech'])]) for lid, e in lines.items()}
    med = float(np.median(list(loud.values())))
    x = np.zeros(ns(DUR))
    spans = []
    for lid, e in lines.items():
        i0 = ns(e['cue'] - e['onset'])
        c = clips[lid][:len(x) - i0]
        x[i0:i0 + len(c)] += c * 10 ** (LEVEL * (med - loud[lid]) / 20)
        spans.append((e['cue'], e['cue'] + e['speech'], lid))
    return x, sorted(spans), med


# ---------- ducking ----------
def bands(x):
    """Zero-phase split at 250 Hz and 5 kHz; the three parts sum back to x exactly."""
    lo = signal.sosfiltfilt(signal.butter(2, 250, 'lowpass', fs=SR, output='sos'), x, axis=-1)
    hi = signal.sosfiltfilt(signal.butter(2, 5000, 'highpass', fs=SR, output='sos'), x, axis=-1)
    return lo, x - lo - hi, hi


def duck(music, vo, spans):
    """The music with room cut for the voice. Returns the ducked music and the duck (dB, mid band)."""
    lo, mid, hi = bands(music)

    def under(dep, s):
        g = [10 ** (-dep * k / 20) for k in SHARE]
        return loudness(g[0] * lo[:, s] + g[1] * mid[:, s] + g[2] * hi[:, s])

    # each line gets the least duck (within DEPTH) that leaves the voice RATIO over the music
    groups = []
    for a, b, _ in spans:
        s = slice(ns(a), ns(b))
        v = loudness(vo[s])
        d0, d1 = DEPTH
        if v - under(d0, s) >= RATIO:
            dep = d0
        else:
            for _ in range(14):
                m = (d0 + d1) / 2
                d0, d1 = (d0, m) if v - under(m, s) >= RATIO else (m, d1)
            dep = d1
        # lines closer than BRIDGE share one duck, as deep as the deepest of them
        if groups and a - groups[-1][1] < BRIDGE:
            groups[-1][1], groups[-1][2] = b, max(groups[-1][2], dep)
        else:
            groups.append([a, b, dep])
    t = tv(ns(DUR))
    d = np.zeros(len(t))
    for a, b, dep in groups:
        u = np.clip(np.minimum((t - a) / EASE_IN + 1, (b - t) / EASE_OUT + 1), 0, 1)
        d = np.maximum(d, dep * (0.5 - 0.5 * np.cos(np.pi * u)))
    g = [10 ** (-d * k / 20) for k in SHARE]
    return g[0] * lo + g[1] * mid + g[2] * hi, d


# ---------- master ----------
def limit(x, ceiling, look=0.004, release=0.15):
    """Look-ahead limiter on the true peak (read 4x oversampled): the gain eases down over `look`
    ahead of anything that would cross the ceiling, holds through it, then recovers with time
    constant `release`. Returns the limited signal and the gain."""
    up = np.abs(signal.resample_poly(x, 4, 1, axis=-1)).max(axis=0)
    pk = up[:4 * x.shape[1]].reshape(-1, 4).max(axis=1)
    L = ns(look)
    want = minimum_filter1d(np.minimum(1.0, ceiling / np.maximum(pk, 1e-12)), 2 * L + 1)
    a = np.exp(-1 / (release * SR))
    g, prev = [], 1.0
    for v in want.tolist():
        prev = v if v < prev else v - (v - prev) * a
        g.append(prev)
    g = np.convolve(np.concatenate([np.ones(L), g]), np.ones(L + 1) / (L + 1), 'valid')
    return x * g, g


def master(x):
    """Gain to the target loudness and limit to the ceiling, repeated until the loudness after
    limiting is on target."""
    c = 10 ** (CEILING / 20) * 0.99  # a hair under, for what the 4x reading misses
    g = 10 ** ((TARGET - loudness(x)) / 20)
    for _ in range(6):
        y, gr = limit(x * g, c)
        err = TARGET - loudness(y)
        if abs(err) < 0.03:
            break
        g *= 10 ** (err / 20)
    return y, gr


def write(name, x):
    rng = np.random.default_rng(7)
    q = np.round(x * 32767 + rng.random(x.shape) - rng.random(x.shape))  # TPDF dither
    wavfile.write(os.path.join(OUT, name), SR, np.ascontiguousarray(np.clip(q, -32768, 32767).astype(np.int16).T))


# ---------- reports ----------
def frames(x, lo, hi, w=0.05):
    """Power per 50 ms frame in a band, dB, summed over the channels (mono plays on both)."""
    x = np.atleast_2d(butter(x, 'bandpass', [lo, hi]))
    n = ns(w)
    m = x.shape[1] // n
    p = (x[:, :m * n].reshape(len(x), m, n) ** 2).mean(axis=2).sum(axis=0) * (2 if len(x) == 1 else 1)
    return 10 * np.log10(p + 1e-20)


def stats(name, y, g):
    gr = -20 * np.log10(g)
    on = np.flatnonzero(np.diff(np.concatenate([[0], (gr > 1).astype(int), [0]])))  # where GR crosses 1 dB
    runs = ' '.join(f'{a / SR:.2f}-{b / SR:.2f}({gr[a:b].max():.1f})' for a, b in zip(on[::2], on[1::2]) if b - a > ns(0.02))
    print(f'{name:14s} {loudness(y):6.2f} LUFS  true peak {20 * np.log10(true_peak(y)):5.2f} dBTP  '
          f'limiter >1 dB for {(gr > 1).sum() / SR:4.2f}s: {runs}')


def report(vo, music, sfx, spans, d):
    """Voice over everything else in the speech band (300 Hz-4 kHz), over its voiced 50 ms frames;
    and each section's effects (their loud 5%) over the rest of the mix (its median)."""
    fv, fb = frames(vo, 300, 4000), frames(music + sfx, 300, 4000)
    row = []
    for a, b, lid in spans:
        i = slice(int(a / 0.05), int(b / 0.05))
        v, s = fv[i], fv[i] - fb[i]
        s = s[v > v.max() - 20]
        row.append(f'{lid} {np.median(s):4.1f}/{np.percentile(s, 10):4.1f} ({d[ns((a + b) / 2)]:4.1f})')
    print('  voice SNR median/p10 (duck dB):', '  '.join(row))
    rest = music + vo
    row = []
    for lo, hi in ((150, 2000), (2000, 12000)):
        fs, fr = frames(sfx, lo, hi), frames(rest, lo, hi)
        row.append(f'{lo}-{hi}: ' + ' '.join(f'{np.percentile(fs[int(a / 0.05):int(b / 0.05)], 95) - np.median(fr[int(a / 0.05):int(b / 0.05)]):5.1f}'
                                             for a, b in SECTIONS))
    print('  sfx over the rest by section:', ' | '.join(row))


def main():
    for name in sys.argv[1:] or MIXES:
        score, fx, who = MIXES[name]
        music, sfx = stem(score), stem(fx)
        if who is None:
            y, g = master(music + sfx)
            write(f'mix_{name}.wav', y)
            stats(name, y, g)
            continue
        vo, spans, med = voice(who)
        under = loudness(np.concatenate([music[:, ns(a):ns(b)] for a, b, _ in spans], axis=1))
        vo *= 10 ** ((under + VO_OVER - med) / 20)
        vo = limit(vo[None], 10 ** ((under + VO_OVER + VO_PLR) / 20), look=0.002, release=0.05)[0][0]
        m, d = duck(music, vo, spans)
        y, g = master(m + sfx + vo)
        write(f'mix_{name}.wav', y)
        stats(name, y, g)
        report(vo, m, sfx, spans, d)
    print('written', ', '.join(f'mix_{n}.wav' for n in sys.argv[1:] or MIXES))


if __name__ == '__main__':
    main()
