// S1 · 0–4s · ink. An ember draws the thread; "有些工作，很重。" drops onto it word by word,
// and the string sags under the load — deepest under 重.
import { C, ZH, M, TY, E, ep, prog, lerp, hash, step2, ring, sagAt, slopeAt, drawThread, ember, setText, text, camera } from '../lib.js';

const LINE = [...'有些工作，很重。'];
const SIZE = 150;
const WEIGHT = [1, 1, 1, 1, 0.25, 1, 3, 0.25];
// Landing beats, relative to the VO cue of the word that is being spoken.
const BEAT = [['L1a', 0], ['L1a', 0.15], ['L1a', 0.38], ['L1a', 0.53], ['L1a', 0.65], ['L1b', 0], ['L1b', 0.29], ['L1b', 0.45]];
const FALL = 0.36, DROP = 520, SAG = 78;

function charLoads(i, p, out) {
  const x0 = M + SIZE * i;
  for (let j = 0; j < 5; j++) out.push({ u: x0 + (SIZE * (j + 0.5)) / 5, p: p / 5 });
}
// Scale so the settled string sags exactly SAG px at its lowest point.
const K = (() => {
  const loads = [];
  WEIGHT.forEach((w, i) => charLoads(i, w, loads));
  let peak = 0;
  for (let x = 0; x <= 1920; x += 4) peak = Math.max(peak, sagAt(x, loads));
  return SAG / peak;
})();

const descCache = new Map();
function inkDescent(ctx, ch) {
  const key = ch + ctx.font;
  let d = descCache.get(key);
  if (d === undefined) { d = ctx.measureText(ch).actualBoundingBoxDescent; descCache.set(key, d); }
  return d;
}

export default function s1(ctx, t, sc, k) {
  const lands = BEAT.map(([id, o]) => k[id] + o);
  const loads = [];
  lands.forEach((tl, i) => { if (t > tl) charLoads(i, K * WEIGHT[i] * (step2(t - tl) + 0.5 * ring(t - tl)), loads); });

  camera(ctx, t, sc.t0, sc.t1, 0.03, 0, 7 * ring(t - lands[6], 4.5, 0.3));

  const g = ep(t, 0.25, 0.85, E.outQuart);
  if (g > 0) drawThread(ctx, 960 - 1160 * g, 960 + 1160 * g, x => TY + sagAt(x, loads), { glow: 0.5 });
  ember(ctx, 960, TY, 6 * ep(t, 0.1, 0.3, E.outBack), ep(t, 0.1, 0.2) * (1 - ep(t, 0.6, 1.0)));

  LINE.forEach((ch, i) => {
    const tl = lands[i];
    if (t < tl - FALL) return;
    text(ctx, ch, 0, 0, { alpha: 0 }); // register glyph for preloading
    setText(ctx, { size: SIZE, weight: 900, fam: ZH, align: 'center' });
    const cx = M + SIZE * i + SIZE / 2;
    const q = prog(t, tl - FALL, tl);
    const ang = Math.atan(slopeAt(cx, loads));
    const rot = q < 1 ? lerp((hash(i, 11) - 0.5) * 0.14, ang, q) : ang;
    const y = TY + sagAt(cx, loads) - DROP * (1 - q * q) - 3;
    ctx.save();
    ctx.translate(cx, y);
    ctx.rotate(rot);
    ctx.globalAlpha = ep(t, tl - FALL, tl - FALL * 0.4, E.outQ);
    ctx.fillStyle = C.paper;
    ctx.fillText(ch, 0, -inkDescent(ctx, ch));
    ctx.restore();
  });
  return { vignette: 0.8 };
}
