// S8 · 50–60s · ink. The thread snaps back across the frame; 举重若轻 drops onto it in the
// heaviest weight and bends it deep. Then the strokes thin, the load lets go and the string
// whips taut, tossing the characters up. The thread draws back into the ember, which rises
// and opens into a spark; the characters settle beneath the name as its tagline.
import { C, ZH, EN, MONO, TY, W, E, ep, prog, lerp, hash, step2, ring, sagAt, XA, SL, drawThread, ember, setText, text, camera, rgba } from '../lib.js';

const LINE = [...'举重若轻'];
const SIZE = 200, X0 = 560; // character centres at 660, 860, 1060, 1260
const WEIGHT = [1.2, 2.6, 1, 0.6];
const LAND = [0, 0.22, 0.45, 0.67]; // after the L9 cue, one per spoken syllable
const FALL = 0.36, DROP = 560, SAG = 120, HOVER = TY - 3 - 48;
const REL_F = 1.4, REL_Z = 0.32;
const T_HIT = 50.0, T_REL = 52.2, T_RET = 53.45, T_RISE = 54.15, T_TAG = 54.25, T_BURST = 54.9;
const T_PEAK = T_REL + 1 / (2 * REL_F * Math.sqrt(1 - REL_Z * REL_Z)); // top of the whip
const CX = W / 2, SPY = 350, NAME_Y = 590, TAG_Y = 700, TAG_SIZE = 60, TAG_ADV = 88;

function charLoads(i, p, out) {
  const x0 = X0 + SIZE * i;
  for (let j = 0; j < 5; j++) out.push({ u: x0 + (SIZE * (j + 0.5)) / 5, p: p / 5 });
}
const K = (() => {
  const loads = [];
  WEIGHT.forEach((w, i) => charLoads(i, w, loads));
  let peak = 0;
  for (let x = 0; x <= W; x += 4) peak = Math.max(peak, sagAt(x, loads));
  return SAG / peak;
})();

// The string at time t: the impact's standing wave plus the sag under the characters, which
// the release (an underdamped spring) lets go of with an overshoot.
function loadsAt(t, lands) {
  const rel = step2(t - T_REL, REL_F, REL_Z);
  const loads = [];
  lands.forEach((tl, i) => {
    if (t > tl) charLoads(i, K * WEIGHT[i] * (step2(t - tl) + 0.5 * ring(t - tl)) * (1 - rel), loads);
  });
  return loads;
}
function stringY(x, t, loads) {
  const u = t - T_HIT, s = (x - XA) / SL;
  return TY + 30 * ring(u, 5.5, 0.12) * Math.sin(Math.PI * s) + 9 * ring(u, 11, 0.15) * Math.sin(2 * Math.PI * s) + sagAt(x, loads);
}

const descCache = new Map();
function inkDescent(ctx, ch) {
  const key = ch + ctx.font;
  let d = descCache.get(key);
  if (d === undefined) { d = ctx.measureText(ch).actualBoundingBoxDescent; descCache.set(key, d); }
  return d;
}

function glow(ctx, x, y, r, a) {
  if (a <= 0.002) return;
  const g = ctx.createRadialGradient(x, y, 0, x, y, r);
  g.addColorStop(0, rgba(C.clay, a));
  g.addColorStop(1, rgba(C.clay, 0));
  ctx.fillStyle = g;
  ctx.fillRect(x - r, y - r, r * 2, r * 2);
}

// Motion streak behind the rising ember, from its position now (y0) to a moment ago (y1).
function trail(ctx, x, y0, y1, r, a) {
  if (y1 - y0 < 2 || a <= 0) return;
  const g = ctx.createLinearGradient(0, y0, 0, y1);
  g.addColorStop(0, rgba(C.clay, 0.7 * a));
  g.addColorStop(1, rgba(C.clay, 0));
  ctx.fillStyle = g;
  ctx.beginPath();
  ctx.moveTo(x - r, y0);
  ctx.lineTo(x + r, y0);
  ctx.lineTo(x, y1);
  ctx.closePath();
  ctx.fill();
}

// Twelve tapered rays, long and short alternating, opening one after another.
function spark(ctx, x, y, t) {
  const u = t - T_BURST;
  if (u <= 0) return;
  const rot = -Math.PI / 2 + 0.08 * u;
  ctx.fillStyle = C.clay;
  ctx.strokeStyle = C.clay;
  ctx.lineWidth = 3;
  ctx.lineJoin = 'round';
  for (let j = 0; j < 12; j++) {
    const g = ep(t, T_BURST + 0.018 * j, T_BURST + 0.018 * j + 0.45, E.outBack);
    if (g <= 0) continue;
    const R = (j % 2 ? 50 : 72) * (0.94 + 0.12 * hash(j, 41)) * g;
    const a = rot + (j / 12) * Math.PI * 2 + 0.05 * (hash(j, 43) - 0.5);
    const b = (j % 2 ? 6 : 8) * Math.min(1, g * 1.4);
    const ca = Math.cos(a), sa = Math.sin(a);
    ctx.beginPath();
    ctx.moveTo(x - sa * b, y + ca * b);
    ctx.lineTo(x + ca * R, y + sa * R);
    ctx.lineTo(x + sa * b, y - ca * b);
    ctx.closePath();
    ctx.fill();
    ctx.stroke();
  }
  ctx.beginPath();
  ctx.arc(x, y, 10 * ep(t, T_BURST, T_BURST + 0.2), 0, Math.PI * 2);
  ctx.fill();
}

export default function s8(ctx, t, sc, k) {
  const u = t - T_HIT;
  const lands = LAND.map(o => k.L9 + o);
  const loads = loadsAt(t, lands);
  const ys = x => stringY(x, t, loads);

  const jolt = 12 * ring(u, 4, 0.3) + lands.reduce((s, tl, i) => s + 3.2 * WEIGHT[i] * ring(t - tl, 4.5, 0.3), 0);
  camera(ctx, t, sc.t0, sc.t1, 0.03, 0, jolt);
  glow(ctx, CX, TY, 900, 0.2 * Math.exp(-5 * u));

  // thread: snaps out from the centre, later draws back into it
  const out = ep(t, T_HIT, T_HIT + 0.14, E.outQuart) * (1 - ep(t, T_RET, T_RET + 0.7, E.ioC));
  if (out > 0) {
    drawThread(ctx, CX - 1160 * out, CX + 1160 * out, ys, {
      width: 3 + 2 * Math.exp(-3 * u),
      glow: 0.5 + 1.5 * Math.exp(-4 * u) + ep(t, T_RET, T_RET + 0.7),
    });
  }
  if (u < 2) ember(ctx, CX, ys(CX), 9 * (1 + 0.8 * Math.exp(-6 * u)), Math.exp(-2.5 * u), 1.2);

  // 举重若轻
  const wgt = lerp(900, 250, ep(t, T_REL - 0.15, T_REL + 0.9, E.ioS));
  const hov = ep(t, T_PEAK, T_PEAK + 1.1, E.ioS);
  const back = ep(t, T_TAG, T_TAG + 0.9, E.ioC);
  const pk = t >= T_PEAK ? loadsAt(T_PEAK, lands) : null;
  LINE.forEach((ch, i) => {
    const tl = lands[i];
    if (t < tl - FALL) return;
    text(ctx, ch, 0, 0, { alpha: 0 }); // registers the glyph for font preloading
    setText(ctx, { size: lerp(SIZE, TAG_SIZE, back), weight: lerp(wgt, 300, back), fam: ZH, align: 'center' });
    const cx = X0 + SIZE * i + SIZE / 2;
    let y, rot;
    if (!pk) {
      // falls, lands and rides the string
      const q = prog(t, tl - FALL, tl);
      const ang = Math.atan((ys(cx + 1) - ys(cx - 1)) / 2);
      rot = q < 1 ? lerp((hash(i, 17) - 0.5) * 0.14, ang, q) : ang;
      y = ys(cx) - DROP * (1 - q * q) - 3;
    } else {
      // lets go at the top of the whip and drifts up to a common line
      const sy = x => stringY(x, T_PEAK, pk);
      y = lerp(sy(cx) - 3, HOVER, hov);
      rot = Math.atan((sy(cx + 1) - sy(cx - 1)) / 2) * (1 - hov);
    }
    ctx.save();
    ctx.translate(lerp(cx, CX + (i - 1.5) * TAG_ADV, back), lerp(y, TAG_Y, back));
    ctx.rotate(rot * (1 - back));
    ctx.globalAlpha = ep(t, tl - FALL, tl - FALL * 0.4, E.outQ) * lerp(1, 0.9, back);
    ctx.fillStyle = C.paper;
    ctx.fillText(ch, 0, -inkDescent(ctx, ch) * (1 - back));
    ctx.restore();
  });

  // the ember the thread draws back into rises in front of the words and opens into the spark
  const riseY = s => lerp(TY, SPY, ep(s, T_RISE, T_BURST - 0.05, E.ioC));
  const ey = riseY(t), ea = ep(t, T_RET + 0.4, T_RET + 0.7) * (1 - ep(t, T_BURST, T_BURST + 0.3));
  trail(ctx, CX, ey, riseY(t - 0.06), 6, ea);
  ember(ctx, CX, ey, 8, ea, 1);
  if (t > T_BURST) glow(ctx, CX, SPY, 280, 0.35 * Math.exp(-4 * (t - T_BURST)) + 0.07 * ep(t, T_BURST, T_BURST + 0.6));
  spark(ctx, CX, SPY, t);

  // end card
  const ta = k.L10 - 0.1, tp = ep(t, ta, ta + 0.9, E.outC);
  const ls = 14 * (1 - ep(t, ta, ta + 1.6, E.outQuart));
  text(ctx, 'Claude Opus 5.5', CX + ls / 2, NAME_Y + 14 * (1 - tp), { size: 120, weight: 400, fam: EN, color: C.paper, align: 'center', ls, alpha: tp });
  const tb = k.L10 + 1.0;
  text(ctx, '现已上线 Claude 应用与 Claude API，并可通过 AWS、Google Cloud、Microsoft Azure 使用', CX, 850, { size: 28, fam: EN, color: C.graphite, align: 'center', alpha: ep(t, tb, tb + 0.6, E.ioS) });
  text(ctx, 'claude-opus-5-5', CX, 900, { size: 24, fam: MONO, color: C.clay, align: 'center', alpha: ep(t, tb + 0.25, tb + 0.85, E.ioS) });
  return { vignette: 0.9, fade: ep(t, 59.3, 60, E.ioS) };
}
