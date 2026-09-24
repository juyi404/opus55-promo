// Every sound-effect trigger, computed from the same functions and constants the scenes draw
// with, so each effect lands on its frame. Writes audio/build/events.json for sfx.py.
// Run: node audio/events.mjs
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { M, W, E, hash, vnoise, lerp } from '../src/lib.js';

const cues = JSON.parse(readFileSync(new URL('../src/cues.json', import.meta.url)));
const k = Object.fromEntries(cues.vo.map(l => [l.id, l.t]));
const pan = x => Math.max(-1, Math.min(1, (x / W) * 2 - 1));
const ev = { cuts: [4, 12, 18, 26, 34, 44, 50] };

// S1 · the thread opens from the centre; eight characters land on it (有些工作，很重。)
const BEAT = [['L1a', 0], ['L1a', 0.15], ['L1a', 0.38], ['L1a', 0.53], ['L1a', 0.65], ['L1b', 0], ['L1b', 0.29], ['L1b', 0.45]];
const W1 = [1, 1, 1, 1, 0.25, 1, 3, 0.25];
ev.s1 = { ember: 0.1, open: [0.25, 0.85], land: BEAT.map(([id, o], i) => ({ t: k[id] + o, w: W1[i], pan: pan(M + 150 * i + 75) })) };

// S2 · the counter rolls to 680,000 (outC: equal steps of the count), code scrolls past at
// 40u + 64u² px (a tick per line of the first column), the wall squashes into the thread
const N = 26;
const count = Array.from({ length: N }, (_, i) => k.L2 - 0.1 + 1.4 * (1 - Math.cbrt(1 - (i + 1) / N)));
const lines = [];
for (let n = 1; ; n++) {
  const u = (-40 + Math.sqrt(1600 + 256 * 22 * n)) / 128;
  if (u > 5) break;
  lines.push({ t: 4 + u, pan: pan([72, 712, 1352][n % 3] + 280) });
}
ev.s2 = { count, lines, squash: [9.0, 9.9], bloom: 10.04 };

// S3 · hour marks draw in, then the playhead passes each hour and runs off the right edge
const ta = k.L4 + 0.05, tb = k.L4 + 3.4;
const f3 = p => 0.15 * E.ioS(p) + 0.85 * p;
const hours = [];
for (let h = 0; h <= 18; h++) {
  let lo = 0, hi = 1;
  for (let it = 0; it < 40; it++) { const m = (lo + hi) / 2; if (f3(m) < h / 18) lo = m; else hi = m; }
  hours.push({ t: ta + (tb - ta) * lo, major: h % 3 === 0, pan: pan(M + ((W - 2 * M) * h) / 18) });
}
ev.s3 = { marks: Array.from({ length: 19 }, (_, h) => 12.05 + 0.02 * h), hours, n18: k.L4 + 0.88, exit: [tb, tb + 0.9] };

// S4 · three benchmark rows: axis draws, Opus 5 and Fable 5.1 dots pop, the clay dot glides
const L0 = 560, L1 = W - M;
const ROWS4 = [[40, 90, 52.3, 55.8, 66.4, 0], [40, 90, 74.0, 80.7, 81.8, 0.81], [1500, 2000, 1708, 1735, 1846, 1.92]];
ev.s4 = {
  rows: ROWS4.map(([lo, hi, o5, f51, o55, off]) => {
    const X = v => lerp(L0, L1, (v - lo) / (hi - lo));
    return { tb: k.L5 + off, o5: pan(X(o5)), f51: pan(X(f51)), o55: pan(X(o55)) };
  }),
  head: k.L5 + 3.02,
  delta: [0, 1, 2].map(i => k.L5 + 4.42 + 0.12 * i),
};

// S5 · 1,300 cells fill in; the right 40% shakes and falls away, the rest lights up; two
// replies type out at 11 and 11/1.3 characters per second
const fill = [], fall = [];
for (let c = 0; c < 130; c++) {
  for (let r = 0; r < 10; r++) {
    const p = pan(M + 8 * c);
    fill.push({ t: 26.15 + 0.75 * (c / 130) + 0.08 * hash(c, r, 2), pan: p, r });
    if (c >= 78) fall.push({ t: 28.53 + 0.32 * ((129 - c) / 51) + 0.13 * hash(c, r, 3), pan: p, r });
  }
}
const type = [];
for (let i = 0; i < 20; i++) {
  type.push({ t: 29.75 + i / 11, fast: true, pan: pan(320 + 40 * i) });
  type.push({ t: 29.75 + (i * 1.3) / 11, fast: false, pan: pan(320 + 40 * i) });
}
ev.s5 = { fill, fall, crack: 28.53, light: [28.6, 29.25], light_pan: [pan(M), pan(M + 8 * 77)], r40: 28.7, type, r30: 30.62 };

// S6 · the key characters light up and fly to the top, one after another; the underline draws
ev.s6 = { hl: 35.45, fly: 36.05, stag: 0.022, dur: 0.75, n: 27, gone: [36.2, 37.0], line: [37.4, 37.9], line_pan: [pan(M), pan(M + 13 * 64)] };

// S7 · a wave of review lights 2,000 dots; the thread closes a box around them; all gathers in
const lit = [];
for (let j = 0; j < 40; j++) {
  for (let i = 0; i < 50; i++) {
    lit.push({ t: 44.6 + 2.8 * (0.62 * (i / 49) + 0.38 * (j / 39)) + 0.4 * (vnoise(i * 0.37 + j * 0.23, 7) - 0.5), pan: pan(1000 + 15 * i), j });
  }
}
// head of the boundary (a rectangle, clockwise from mid-left) sampled every 10 ms, for panning
const BX0 = 966, BY0 = 214, BX1 = 1769, BY1 = 867, CY = (BY0 + BY1) / 2;
const seg = [[BX0, CY], [BX0, BY0], [BX1, BY0], [BX1, BY1], [BX0, BY1], [BX0, CY]];
const len = [0];
for (let i = 1; i < seg.length; i++) len.push(len[i - 1] + Math.hypot(seg[i][0] - seg[i - 1][0], seg[i][1] - seg[i - 1][1]));
const headX = p => {
  const want = len[len.length - 1] * p;
  for (let i = 1; i < seg.length; i++) if (len[i] >= want) return lerp(seg[i - 1][0], seg[i][0], (want - len[i - 1]) / (len[i] - len[i - 1] || 1));
  return seg[0][0];
};
const loop = [];
for (let t = 46.3; t <= 47.6 + 1e-9; t += 0.01) loop.push([t, pan(headX(E.ioS((t - 46.3) / 1.3)))]);
ev.s7 = { lit, loop, gather: [49.05, 49.95] };

// S8 · impact; 举重若轻 lands (one per syllable); the load lets go and the string whips up;
// the thread draws back into the ember, which rises and bursts
ev.s8 = {
  hit: 50.0,
  lands: [0, 0.22, 0.45, 0.67].map(o => k.L9 + o),
  weights: [1.2, 2.6, 1, 0.6],
  pans: [660, 860, 1060, 1260].map(pan),
  rel: 52.2,
  peak: 52.2 + 1 / (2 * 1.4 * Math.sqrt(1 - 0.32 * 0.32)),
  ret: [53.45, 54.15],
  rise: [54.15, 54.85],
  tag: [54.25, 55.15],
  burst: 54.9,
  name: k.L10 - 0.1,
};

mkdirSync(new URL('./build/', import.meta.url), { recursive: true });
const round = (_, v) => (typeof v === 'number' ? Math.round(v * 1e4) / 1e4 : v);
writeFileSync(new URL('./build/events.json', import.meta.url), JSON.stringify(ev, round));
console.log('events:', Object.entries(ev).map(([key, v]) => key).join(' '));
