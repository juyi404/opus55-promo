# Synthesis toolkit for the score: oscillators, envelopes, filters, a synthetic reverb and
# the instruments. numpy/scipy only, 48 kHz float64, deterministic (all noise is seeded).
import numpy as np
from scipy import signal

SR = 48000
TAU = 2 * np.pi


def midi(m):
    return 440.0 * 2 ** ((np.asarray(m, float) - 69) / 12)


def ns(sec):
    return int(round(sec * SR))


def tv(n):
    return np.arange(n) / SR


def noise(n, seed):
    return np.random.default_rng(seed).standard_normal(n)


# ---------- stereo buses ----------
def pan2(x, pan):
    """Mono -> stereo, constant power, unity at centre. pan may be a scalar or an array."""
    a = (np.asarray(pan, float) + 1) * np.pi / 4
    return np.stack([x * np.cos(a), x * np.sin(a)]) * np.sqrt(2)


class Bus:
    def __init__(self, dur):
        self.x = np.zeros((2, ns(dur)))

    def add(self, t, clip, gain=1.0, pan=0.0):
        clip = np.asarray(clip, float)
        if clip.ndim == 1:
            clip = pan2(clip, pan)
        i0 = ns(t)
        a, b = max(i0, 0), min(i0 + clip.shape[1], self.x.shape[1])
        if b > a:
            self.x[:, a:b] += gain * clip[:, a - i0:b - i0]


# ---------- envelopes ----------
def ad(n, a, tau, hold=0.0):
    """Raised-cosine attack over a, optional hold, then exponential decay with time constant tau."""
    t = tv(n)
    e = np.exp(-np.maximum(t - a - hold, 0) / tau)
    if a > 0:
        e = e * np.where(t < a, 0.5 - 0.5 * np.cos(np.pi * np.clip(t / a, 0, 1)), 1.0)
    return e


def gate(n, a, on, r):
    """Rises over a, holds until on, falls over r (sin²/cos² shapes, so overlaps sum smoothly)."""
    t = tv(n)
    up = np.clip(t / a, 0, 1) if a > 0 else np.ones(n)
    dn = np.clip((t - on) / r, 0, 1) if r > 0 else (t >= on).astype(float)
    return np.sin(up * np.pi / 2) ** 2 * np.cos(dn * np.pi / 2) ** 2


def curve(n, pts, t0=0.0):
    """Piecewise-linear curve through (time, value) points; times are absolute, t0 is sample 0."""
    ts, vs = zip(*pts)
    return np.interp(t0 + tv(n), ts, vs)


# ---------- oscillators ----------
def phase(f, n, ph=0.0):
    f = np.broadcast_to(np.asarray(f, float), (n,))
    dt = f / SR
    return (ph + np.concatenate([[0.0], np.cumsum(dt[:-1])])) % 1.0, dt


def _blep(p, dt):
    y = np.zeros_like(p)
    m = p < dt
    x = p[m] / dt[m]
    y[m] = x + x - x * x - 1
    m = p > 1 - dt
    x = (p[m] - 1) / dt[m]
    y[m] = x * x + x + x + 1
    return y


def saw(f, n, ph=0.0):
    p, dt = phase(f, n, ph)
    return 2 * p - 1 - _blep(p, dt)


def sine(f, n, ph=0.0):
    return np.sin(TAU * phase(f, n, ph)[0])


DETUNE = [-0.12, -0.07, -0.025, 0.0, 0.024, 0.068, 0.115]  # semitones


def supersaw(f, n, seed, spread=1.0, width=0.85):
    """Seven detuned saws spread across the stereo field."""
    rng = np.random.default_rng(seed)
    out = np.zeros((2, n))
    for j, d in enumerate(DETUNE):
        x = saw(f * 2 ** (d * spread / 12), n, rng.random())
        out += pan2(x, width * (2 * j / (len(DETUNE) - 1) - 1))
    return out / np.sqrt(len(DETUNE))


# ---------- filters ----------
def butter(x, kind, fc, order=2):
    sos = signal.butter(order, fc, kind, fs=SR, output='sos')
    return signal.sosfilt(sos, x, axis=-1)


def biquad(kind, fc, q):
    w = TAU * min(fc, 0.45 * SR) / SR
    c, al = np.cos(w), np.sin(w) / (2 * q)
    if kind == 'lp':
        b = [(1 - c) / 2, 1 - c, (1 - c) / 2]
    elif kind == 'hp':
        b = [(1 + c) / 2, -(1 + c), (1 + c) / 2]
    else:  # band-pass, 0 dB at the centre
        b = [al, 0.0, -al]
    a0 = 1 + al
    return np.array([[b[0] / a0, b[1] / a0, b[2] / a0, 1.0, -2 * c / a0, (1 - al) / a0]])


def sweep(x, fc, kind='lp', q=0.707, block=128):
    """Biquad whose cutoff follows fc (one value per sample, or a scalar), updated per block."""
    n = x.shape[-1]
    fc = np.broadcast_to(np.asarray(fc, float), (n,))
    y = np.empty_like(x)
    zi = np.zeros((1,) + x.shape[:-1] + (2,))
    for i in range(0, n, block):
        j = min(i + block, n)
        y[..., i:j], zi = signal.sosfilt(biquad(kind, fc[(i + j) // 2], q), x[..., i:j], axis=-1, zi=zi)
    return y


# ---------- dynamics & space ----------
def soft(x, drive=1.0):
    return np.tanh(drive * x) / np.tanh(drive)


def duck(n, times, depth=0.5, attack=0.004, release=0.18):
    """Gain curve that dips at each trigger time (sidechain pumping)."""
    g = np.ones(n)
    for tk in times:
        a, b = max(ns(tk - attack), 0), min(ns(tk + 6 * release), n)
        if b <= a:
            continue
        u = tv(b - a) + a / SR - tk
        d = np.where(u < 0, 1 + u / attack, np.exp(-np.maximum(u, 0) / release))
        g[a:b] = np.minimum(g[a:b], 1 - depth * np.clip(d, 0, 1))
    return g


def make_ir(rt=2.6, pre=0.02, seed=7, bright=9000.0, dark=1500.0):
    """Stereo reverb impulse: decorrelated noise tails that darken as they decay, plus a few
    early reflections. Unit energy per channel."""
    n = ns(rt * 1.1)
    t = tv(n)
    rng = np.random.default_rng(seed)
    x = rng.standard_normal((2, n)) * 10 ** (-3 * t / rt)
    x = sweep(x, bright * (dark / bright) ** (t / t[-1]), 'lp', 0.6, block=256)
    x *= np.minimum(1, t / 0.012)  # the dense tail fades in behind the early reflections
    for _ in range(12):
        d = rng.uniform(0.003, 0.075)
        x[:, ns(d)] += rng.uniform(0.3, 1.0, 2) * rng.choice([-1, 1], 2) * (1 - d / 0.09) * 6
    x = np.concatenate([np.zeros((2, ns(pre))), x], axis=1)
    return x / np.sqrt((x ** 2).sum(axis=1, keepdims=True))


def reverb(x, ir):
    n = x.shape[1]
    return np.stack([signal.fftconvolve(x[c], ir[c])[:n] for c in (0, 1)])


# ---------- instruments ----------
def kick(f0=160.0, f1=46.0, tp=0.03, tau=0.3, dur=0.8, click=0.25, seed=1):
    n = ns(dur)
    t = tv(n)
    f = f1 + (f0 - f1) * np.exp(-t / tp)
    body = np.sin(TAU * np.cumsum(f) / SR) * np.exp(-t / tau) * np.minimum(1, t / 0.0015)
    cl = butter(noise(n, seed), 'highpass', 2500) * np.exp(-t / 0.004) * click
    return soft(body + cl, 1.6)


def snare(seed=2, tone=0.5, tau=0.13):
    n = ns(0.5)
    t = tv(n)
    body = (np.sin(TAU * 185 * t) + 0.5 * np.sin(TAU * 330 * t)) * np.exp(-t / 0.05) * tone
    rattle = butter(noise(n, seed), 'bandpass', [1200, 8000]) * np.exp(-t / tau)
    x = (body + rattle) * np.minimum(1, t / 0.001)
    return x / np.abs(x).max()


def clap(seed=3):
    n = ns(0.5)
    t = tv(n)
    e = np.zeros(n)
    for d in (0.0, 0.011, 0.022, 0.034):
        u = t - d
        e += np.where(u >= 0, np.exp(-np.maximum(u, 0) / 0.0045), 0)
    u = t - 0.034
    e += np.where(u >= 0, 0.55 * np.exp(-np.maximum(u, 0) / 0.1), 0)
    x = butter(noise(n, seed), 'bandpass', [900, 5500]) * e
    return x / np.abs(x).max()


HAT_F = [205.3, 304.4, 369.6, 522.7, 540.0, 800.0]


def hat(tau=0.035, seed=4):
    n = ns(max(0.12, tau * 7))
    t = tv(n)
    metal = sum(np.sign(np.sin(TAU * f * t + k)) for k, f in enumerate(HAT_F))
    x = butter(0.5 * metal + noise(n, seed), 'highpass', 7000, order=4) * np.exp(-t / tau)
    x *= np.minimum(1, t / 0.0005)
    return x / np.abs(x).max()


def shaker(seed=5):
    n = ns(0.16)
    x = butter(noise(n, seed), 'bandpass', [4500, 11000]) * ad(n, 0.014, 0.035)
    return x / np.abs(x).max()


def fm_pluck(f, dur=0.6, ratio=2.0, index=2.2, tau=0.22, tau_i=0.06):
    n = ns(dur)
    t = tv(n)
    x = np.sin(TAU * f * t + index * np.exp(-t / tau_i) * np.sin(TAU * f * ratio * t))
    return x * ad(n, 0.002, tau)


def ks(f, dur, t60=1.5, bright=0.6, seed=6):
    """Karplus-Strong plucked string, computed a period at a time."""
    n = ns(dur)
    P = max(2, int(round(SR / f - 0.5)))
    rho = 10 ** (-3 / (t60 * f))
    exc = np.random.default_rng(seed).uniform(-1, 1, P)
    exc = signal.lfilter([bright], [1, bright - 1], exc)
    exc -= exc.mean()
    y = np.zeros(n + P + 1)
    y[1:P + 1] = exc
    k = P + 1
    while k < len(y):
        m = min(P, len(y) - k)
        y[k:k + m] = rho * 0.5 * (y[k - P:k - P + m] + y[k - P - 1:k - P - 1 + m])
        k += m
    y = y[1:n + 1]
    return y / (np.abs(y).max() + 1e-9)


def keys(f, dur=3.0, vel=0.7, seed=8):
    """Soft felt piano: stretched partials on two slightly detuned strings, upper partials
    dying faster, a little hammer thump."""
    n = ns(dur)
    t = tv(n)
    rng = np.random.default_rng(seed)
    out = np.zeros(n)
    tau0 = 2.4 * (262 / f) ** 0.4
    for k in range(1, int(min(16, 15000 / f)) + 1):
        fk = k * f * np.sqrt(1 + 0.0004 * k * k)
        amp = k ** -1.3 * np.exp(-(k - 1) * (0.45 - 0.3 * vel))
        tau = tau0 / (1 + 0.5 * (k - 1))
        for d in (-0.4, 0.4):  # cents
            out += 0.5 * amp * np.sin(TAU * fk * 2 ** (d / 1200) * t + TAU * rng.random()) * np.exp(-t / tau)
    thump = butter(noise(n, seed), 'lowpass', 700) * np.exp(-t / 0.01) * 0.12
    return (out + thump) * np.minimum(1, t / 0.003) * vel


def chime(f, dur=2.5, seed=9):
    """Struck bar (glockenspiel-like) partials."""
    n = ns(dur)
    t = tv(n)
    rng = np.random.default_rng(seed)
    out = np.zeros(n)
    for r, a, d in ((1.0, 1.0, 0.45), (2.76, 0.45, 0.2), (5.4, 0.2, 0.1), (8.93, 0.08, 0.05)):
        if r * f < 18000:
            out += a * np.sin(TAU * r * f * t + TAU * rng.random()) * np.exp(-t / (dur * d))
    return out * np.minimum(1, t / 0.0015)


def sub(f, n, h2=0.22, h3=0.08):
    """Sine bass with a touch of 2nd/3rd harmonic so it survives small speakers."""
    p = TAU * phase(f, n)[0]
    return soft(np.sin(p) + h2 * np.sin(2 * p) + h3 * np.sin(3 * p), 1.2)


def shelf(x, kind, fc, db, q=0.707):
    """RBJ shelving EQ ('low' or 'high'), gain in dB."""
    A, w = 10 ** (db / 40), TAU * fc / SR
    c, al = np.cos(w), np.sin(w) / (2 * q)
    s = 2 * np.sqrt(A) * al
    if kind == 'low':
        b = [A * ((A + 1) - (A - 1) * c + s), 2 * A * ((A - 1) - (A + 1) * c), A * ((A + 1) - (A - 1) * c - s)]
        a = [(A + 1) + (A - 1) * c + s, -2 * ((A - 1) + (A + 1) * c), (A + 1) + (A - 1) * c - s]
    else:
        b = [A * ((A + 1) + (A - 1) * c + s), -2 * A * ((A - 1) + (A + 1) * c), A * ((A + 1) + (A - 1) * c - s)]
        a = [(A + 1) - (A - 1) * c + s, 2 * ((A - 1) - (A + 1) * c), (A + 1) - (A - 1) * c - s]
    return signal.lfilter(np.array(b) / a[0], np.array(a) / a[0], x, axis=-1)
