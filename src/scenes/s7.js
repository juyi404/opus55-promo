// S7 · 44–50s · ink. Two thousand scenarios as a grid of dots; a wave of review lights them
// one by one and the thread closes a boundary around them. At the end everything gathers into
// the ember at the centre of the frame, ready for the finale.
import { C, EN, M, TY, W, E, ep, prog, lerp, hash, vnoise, text, wipeText, drawThread, ember, camera, footnote, mix, rgba } from '../lib.js';

const NX = 50, NY = 40, PITCH = 15, GX = 1000, GY = 248;
const DOTS = [];
for (let j = 0; j < NY; j++) {
  for (let i = 0; i < NX; i++) {
    DOTS.push({
      x: GX + i * PITCH, y: GY + j * PITCH,
      lit: 44.6 + 2.8 * (0.62 * (i / (NX - 1)) + 0.38 * (j / (NY - 1))) + 0.4 * (vnoise(i * 0.37 + j * 0.23, 7) - 0.5),
      born: 0.3 * vnoise(i * 0.5 + j * 0.9, 3),
      gd: 0.45 * hash(i, j, 21),
    });
  }
}

// Rounded rectangle around the grid, sampled by arc length, starting mid-left, clockwise.
const PAD = 34, RR = 26;
const BX0 = GX - PAD, BY0 = GY - PAD, BX1 = GX + (NX - 1) * PITCH + PAD, BY1 = GY + (NY - 1) * PITCH + PAD;
const LOOP = (() => {
  const pts = [], cy = (BY0 + BY1) / 2;
  const arc = (cx, cy, a0) => { for (let s = 1; s <= 12; s++) { const a = a0 + (s / 12) * (Math.PI / 2); pts.push([cx + RR * Math.cos(a), cy + RR * Math.sin(a)]); } };
  pts.push([BX0, cy], [BX0, BY0 + RR]);
  arc(BX0 + RR, BY0 + RR, Math.PI);
  pts.push([BX1 - RR, BY0]);
  arc(BX1 - RR, BY0 + RR, -Math.PI / 2);
  pts.push([BX1, BY1 - RR]);
  arc(BX1 - RR, BY1 - RR, 0);
  pts.push([BX0 + RR, BY1]);
  arc(BX0 + RR, BY1 - RR, Math.PI / 2);
  pts.push([BX0, cy]);
  const len = [0];
  for (let i = 1; i < pts.length; i++) len.push(len[i - 1] + Math.hypot(pts[i][0] - pts[i - 1][0], pts[i][1] - pts[i - 1][1]));
  return { pts, len, total: len[len.length - 1] };
})();
function loopTo(ctx, p) {
  const want = LOOP.total * p;
  ctx.beginPath();
  ctx.moveTo(...LOOP.pts[0]);
  let head = LOOP.pts[0];
  for (let i = 1; i < LOOP.pts.length; i++) {
    const [x0, y0] = LOOP.pts[i - 1], [x1, y1] = LOOP.pts[i];
    if (LOOP.len[i] <= want) { ctx.lineTo(x1, y1); head = [x1, y1]; continue; }
    const f = (want - LOOP.len[i - 1]) / (LOOP.len[i] - LOOP.len[i - 1]);
    head = [lerp(x0, x1, f), lerp(y0, y1, f)];
    ctx.lineTo(...head);
    break;
  }
  return head;
}

const T_LOOP = 46.3, T_GATHER = 49.05, CX = W / 2;

export default function s7(ctx, t, sc, k) {
  camera(ctx, t, sc.t0, sc.t1, 0.035);
  const fadeUI = 1 - ep(t, 48.9, 49.4, E.ioS);

  for (const d of DOTS) {
    const a0 = ep(t, sc.t0 + d.born, sc.t0 + d.born + 0.4, E.outQ);
    if (a0 <= 0) continue;
    const l = ep(t, d.lit, d.lit + 0.25, E.outQ);
    const pop = Math.sin(Math.PI * prog(t, d.lit, d.lit + 0.35));
    // gather: staggered starts, all arrive together, spiralling into the ember
    const g = ep(t, T_GATHER + d.gd, 49.95, E.inC);
    const rx = d.x - CX, ry = d.y - TY, an = 0.9 * g, cs = Math.cos(an), sn = Math.sin(an);
    const x = CX + (rx * cs - ry * sn) * (1 - g), y = TY + (rx * sn + ry * cs) * (1 - g);
    ctx.fillStyle = mix(C.graphite, C.paper, l, a0 * lerp(0.3, 0.92, l) * (1 - 0.6 * g));
    ctx.beginPath();
    ctx.arc(x, y, (2.5 + 1.3 * pop) * (1 - 0.5 * g), 0, Math.PI * 2);
    ctx.fill();
  }

  // the thread closes the boundary
  const lp = ep(t, T_LOOP, T_LOOP + 1.3, E.ioS);
  if (lp > 0 && fadeUI > 0) {
    ctx.lineWidth = 3;
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';
    ctx.strokeStyle = rgba(C.clay, fadeUI);
    ctx.shadowColor = rgba(C.clay, 0.35 * fadeUI);
    ctx.shadowBlur = 10;
    const head = loopTo(ctx, lp);
    ctx.stroke();
    ctx.shadowBlur = 0;
    ctx.shadowColor = 'transparent';
    ember(ctx, head[0], head[1], 6, (1 - ep(t, T_LOOP + 1.3, T_LOOP + 1.7)) * fadeUI, 0.8);
  }
  // the ember the finale grows from
  ember(ctx, CX, TY, 7 * ep(t, 49.5, 49.95, E.outQ), ep(t, 49.5, 49.8), 1);

  // copy
  const o = { weight: 500, fam: EN, color: C.paper, alpha: fadeUI };
  wipeText(ctx, '近 2,000 个场景', M, 420, ep(t, k.L8 - 0.06, k.L8 + 1.1, E.lin), { ...o, size: 96 });
  wipeText(ctx, '行为审计', M, 540, ep(t, 45.68, 46.4, E.lin), { ...o, size: 96 });
  wipeText(ctx, '迄今最好的成绩', M, 660, ep(t, 47.25, 48.6, E.lin), { ...o, size: 56, color: C.clay, weight: 600 });
  footnote(ctx, '发布前，METR、Frontier Design 等外部机构已独立测试', t, 47.8, true, { alpha: fadeUI });
  return { vignette: 0.9 };
}
