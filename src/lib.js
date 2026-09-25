// Shared constants and pure helpers for the film. Nothing here keeps state between frames
// except SEEN, which only records which glyphs were drawn so the fonts can be preloaded.

export const W = 1920, H = 1080, M = 144, TY = 640;

export const C = {
  ink: '#141413', paper: '#FAF9F5', mist: '#E8E6DC', graphite: '#B0AEA5',
  slate: '#5E5D59', clay: '#D97757', sage: '#788C5D',
};

export const ZH = "'Noto Serif SC Variable', serif";
export const EN = "'Source Serif 4 Variable', 'Noto Serif SC Variable', serif";
export const MONO = "'JetBrains Mono Variable', monospace";
export const FAMILIES = ['Noto Serif SC Variable', 'Source Serif 4 Variable', 'JetBrains Mono Variable'];

// ---------- math & easing ----------
export const clamp = (x, a = 0, b = 1) => Math.min(b, Math.max(a, x));
export const lerp = (a, b, t) => a + (b - a) * t;
export const prog = (t, a, b) => clamp((t - a) / (b - a));
export const E = {
  lin: x => x,
  inQ: x => x * x,
  outQ: x => 1 - (1 - x) * (1 - x),
  inC: x => x * x * x,
  outC: x => 1 - (1 - x) ** 3,
  ioC: x => (x < 0.5 ? 4 * x * x * x : 1 - (-2 * x + 2) ** 3 / 2),
  outQuart: x => 1 - (1 - x) ** 4,
  outExpo: x => (x >= 1 ? 1 : 1 - 2 ** (-10 * x)),
  ioS: x => -(Math.cos(Math.PI * x) - 1) / 2,
  outBack: x => 1 + 2.70158 * (x - 1) ** 3 + 1.70158 * (x - 1) ** 2,
};
export const ep = (t, a, b, f = E.outC) => f(prog(t, a, b));
// rises over [a, a+fi], holds, falls over [b-fo, b]
export const env = (t, a, b, fi = 0.3, fo = 0.3) => Math.min(ep(t, a, a + fi, E.ioS), 1 - ep(t, b - fo, b, E.ioS));

// Underdamped step response (0 -> 1 with overshoot) and its decaying ring, t in seconds.
export function step2(t, f = 2.2, z = 0.45) {
  if (t <= 0) return 0;
  const w = 2 * Math.PI * f, wd = w * Math.sqrt(1 - z * z);
  return 1 - Math.exp(-z * w * t) * (Math.cos(wd * t) + (z / Math.sqrt(1 - z * z)) * Math.sin(wd * t));
}
export function ring(t, f = 2.2, z = 0.45) {
  if (t <= 0) return 0;
  const w = 2 * Math.PI * f, wd = w * Math.sqrt(1 - z * z);
  return Math.exp(-z * w * t) * Math.sin(wd * t);
}

// ---------- deterministic randomness ----------
export function hash(a, b = 0, c = 0) {
  let h = Math.imul(a | 0, 0x27d4eb2d) ^ Math.imul((b | 0) + 0x632be5ab, 0x165667b1) ^ Math.imul((c | 0) + 0x5bd1e995, 0x9e3779b1);
  h = Math.imul(h ^ (h >>> 15), 0x85ebca6b);
  h = Math.imul(h ^ (h >>> 13), 0xc2b2ae35);
  return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
}
export function rng(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
export function vnoise(x, seed = 0) {
  const i = Math.floor(x), f = x - i, u = f * f * (3 - 2 * f);
  return lerp(hash(i, seed), hash(i + 1, seed), u);
}

// ---------- colour ----------
const hexCache = new Map();
export function rgb(hex) {
  let v = hexCache.get(hex);
  if (!v) { const n = parseInt(hex.slice(1), 16); v = [(n >> 16) & 255, (n >> 8) & 255, n & 255]; hexCache.set(hex, v); }
  return v;
}
export const rgba = (hex, a = 1) => { const [r, g, b] = rgb(hex); return `rgba(${r},${g},${b},${a})`; };
export function mix(h1, h2, t, a = 1) {
  const p = rgb(h1), q = rgb(h2);
  return `rgba(${Math.round(lerp(p[0], q[0], t))},${Math.round(lerp(p[1], q[1], t))},${Math.round(lerp(p[2], q[2], t))},${a})`;
}

// ---------- text ----------
export const SEEN = new Set();
export function setText(ctx, o) {
  // Chrome keys its font cache by size × 100, and a size that isn't a whole number of 0.01 px
  // doesn't always draw the same from one render to the next, so animated sizes go on that grid
  ctx.font = `${Math.round(o.weight ?? 400)} ${Math.round((o.size ?? 48) * 100) / 100}px ${o.fam ?? ZH}`;
  ctx.textAlign = o.align ?? 'left';
  ctx.textBaseline = o.base ?? 'alphabetic';
  ctx.letterSpacing = `${o.ls ?? 0}px`;
}
export function measure(ctx, s, o) { setText(ctx, o); return ctx.measureText(s).width; }
export function text(ctx, s, x, y, o = {}) {
  for (const ch of s) SEEN.add(ch);
  const a = o.alpha ?? 1;
  if (a <= 0.002) return;
  setText(ctx, o);
  ctx.globalAlpha = a;
  ctx.fillStyle = o.color ?? C.paper;
  ctx.fillText(s, x, y);
  ctx.globalAlpha = 1;
}
// Soft left-to-right reveal of left-aligned text; p in [0, 1].
export function wipeText(ctx, s, x, y, p, o = {}) {
  for (const ch of s) SEEN.add(ch);
  if (p <= 0) return;
  setText(ctx, { ...o, align: 'left' });
  const w = ctx.measureText(s).width, soft = o.soft ?? 160, a = o.alpha ?? 1;
  if (p >= 1) { ctx.globalAlpha = a; ctx.fillStyle = o.color ?? C.paper; ctx.fillText(s, x, y); ctx.globalAlpha = 1; return; }
  const edge = x + p * (w + soft);
  const g = ctx.createLinearGradient(edge - soft, 0, edge, 0);
  g.addColorStop(0, rgba(o.color ?? C.paper, a));
  g.addColorStop(1, rgba(o.color ?? C.paper, 0));
  ctx.fillStyle = g;
  ctx.fillText(s, x, y);
}
// Big numbers: fixed-width digit slots (canvas has no tabular figures), right-aligned at xr.
export function slotNumber(ctx, s, xr, y, o = {}) {
  for (const ch of s) SEEN.add(ch);
  setText(ctx, { ...o, align: 'center' });
  const slot = ctx.measureText('0').width;
  const widths = [...s].map(ch => (/[0-9]/.test(ch) ? slot : ctx.measureText(ch).width));
  let x = xr - widths.reduce((a, b) => a + b, 0);
  ctx.globalAlpha = o.alpha ?? 1;
  ctx.fillStyle = o.color ?? C.paper;
  [...s].forEach((ch, i) => { ctx.fillText(ch, x + widths[i] / 2, y); x += widths[i]; });
  ctx.globalAlpha = 1;
  return widths.reduce((a, b) => a + b, 0);
}
export function slotWidth(ctx, s, o) {
  setText(ctx, { ...o, align: 'center' });
  const slot = ctx.measureText('0').width;
  return [...s].reduce((a, ch) => a + (/[0-9]/.test(ch) ? slot : ctx.measureText(ch).width), 0);
}

// ---------- the thread ----------
// A taut string pinned beyond both screen edges. Point loads deflect it with the static
// Green's function of a string; callers make the loads time-varying (step2/ring) for bounce.
export const XA = -200, XB = 2120, SL = XB - XA;
export function sagAt(x, loads) {
  const s = x - XA;
  let y = 0;
  for (const { u, p } of loads) {
    const v = u - XA;
    y += p * (s < v ? s * (SL - v) : v * (SL - s)) / SL;
  }
  return y;
}
export function slopeAt(x, loads) { return (sagAt(x + 1, loads) - sagAt(x - 1, loads)) / 2; }
export function drawThread(ctx, x0, x1, yf, o = {}) {
  const n = o.n ?? 160;
  ctx.beginPath();
  for (let i = 0; i <= n; i++) {
    const x = lerp(x0, x1, i / n), y = yf(x);
    i ? ctx.lineTo(x, y) : ctx.moveTo(x, y);
  }
  ctx.lineWidth = o.width ?? 3;
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';
  ctx.strokeStyle = rgba(o.color ?? C.clay, o.alpha ?? 1);
  if (o.glow) { ctx.shadowColor = rgba(o.color ?? C.clay, 0.6 * o.glow); ctx.shadowBlur = 18 * o.glow; }
  ctx.stroke();
  ctx.shadowBlur = 0;
  ctx.shadowColor = 'transparent';
}
export function ember(ctx, x, y, r, a = 1, halo = 1) {
  if (a <= 0 || r <= 0) return;
  const R = r * (2 + 4 * halo);
  const g = ctx.createRadialGradient(x, y, 0, x, y, R);
  g.addColorStop(0, rgba(C.clay, 0.55 * a * halo));
  g.addColorStop(1, rgba(C.clay, 0));
  ctx.fillStyle = g;
  ctx.fillRect(x - R, y - R, R * 2, R * 2);
  ctx.beginPath();
  ctx.arc(x, y, r, 0, Math.PI * 2);
  ctx.fillStyle = mix(C.clay, '#FFE8D6', 0.35, a);
  ctx.fill();
}

// ---------- frame helpers ----------
export function clear(ctx, color) {
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  ctx.globalAlpha = 1;
  ctx.globalCompositeOperation = 'source-over';
  ctx.filter = 'none';
  ctx.fillStyle = color;
  ctx.fillRect(0, 0, W, H);
}
// Slow push-in around the frame centre, with an optional jolt offset.
export function camera(ctx, t, t0, t1, amount = 0.02, jx = 0, jy = 0) {
  const s = 1 + amount * E.ioS(prog(t, t0, t1));
  ctx.setTransform(s, 0, 0, s, (W / 2) * (1 - s) + jx, (H / 2) * (1 - s) + jy);
}
let vig;
export function vignette(ctx, a = 1) {
  if (!vig) {
    vig = document.createElement('canvas');
    vig.width = W; vig.height = H;
    const v = vig.getContext('2d', { colorType: 'float16' });
    const g = v.createRadialGradient(W / 2, H / 2, H * 0.35, W / 2, H / 2, H * 1.05);
    g.addColorStop(0, 'rgba(0,0,0,0)');
    g.addColorStop(1, 'rgba(0,0,0,0.55)');
    v.fillStyle = g;
    v.fillRect(0, 0, W, H);
  }
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  ctx.globalAlpha = a;
  ctx.drawImage(vig, 0, 0);
  ctx.globalAlpha = 1;
}
// Footnotes and attributions share one position: bottom-left, 24px.
export function footnote(ctx, s, t, t0, onInk = true, o = {}) {
  text(ctx, s, M, 960, { size: 24, weight: 400, color: onInk ? C.graphite : C.slate, ...o, alpha: ep(t, t0, t0 + 0.5, E.ioS) * (o.alpha ?? 1) });
}
