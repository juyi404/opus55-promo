// S5 · 26–34s · ink. Cost: a bar of cells loses its last 40%, which crumbles away.
// Speed: the same reply streams in two lanes; Opus 5.5 runs 1.3× faster than Opus 5.
import { C, EN, M, W, E, ep, prog, lerp, hash, text, measure, wipeText, camera, footnote, mix, rgba } from '../lib.js';

const COLS = 130, ROWS = 10, P = 8, BX = M, BY = 340, CUT = 78; // columns >= CUT are the 40%
const CELLS = [];
for (let c = 0; c < COLS; c++) {
  for (let r = 0; r < ROWS; r++) {
    CELLS.push({
      c, r, x: BX + c * P, y: BY + r * P,
      a: 0.55 + 0.4 * hash(c, r, 1),
      born: 0.75 * (c / COLS) + 0.08 * hash(c, r, 2),
      fall: 0.32 * ((COLS - 1 - c) / (COLS - 1 - CUT)) + 0.13 * hash(c, r, 3),
      vx: (hash(c, r, 4) - 0.5) * 160,
      vy: -(60 + 240 * hash(c, r, 5)),
      w: (hash(c, r, 6) - 0.5) * 14,
    });
  }
}
const REPLY = [...'迁移完成：所有模块已更新，全部测试通过。'];
const CPS = 11, SLOW = 1.3;

function lane(ctx, t, t0, cps, y, color, caret) {
  const n = (t - t0) * cps;
  if (n <= 0) return;
  const o = { size: 40, weight: 400, color };
  const whole = Math.min(REPLY.length, Math.floor(n));
  const s = REPLY.slice(0, whole).join('');
  text(ctx, s, 320, y, o);
  let x = 320 + measure(ctx, s, o);
  if (whole < REPLY.length) {
    text(ctx, REPLY[whole], x, y, { ...o, alpha: n - whole });
    x += (n - whole) * measure(ctx, REPLY[whole], o);
  }
  // caret: follows the text, blinks once the reply is done
  const done = t0 + REPLY.length / cps;
  const on = t < done || Math.floor((t - done) * 2.2) % 2 === 0;
  if (on) { ctx.fillStyle = caret; ctx.fillRect(x + 6, y - 34, 3, 42); }
}

export default function s5(ctx, t, sc, k) {
  camera(ctx, t, sc.t0, sc.t1, 0.02);

  // ---- 运行成本 −40%
  const ta = sc.t0 + 0.15, tc = 28.53, tl = 28.6;
  wipeText(ctx, '运行成本', M, 300, ep(t, k.L6 - 0.05, k.L6 + 0.5, E.lin), { size: 44, weight: 600, color: C.paper });
  const hw = measure(ctx, '运行成本', { size: 44, weight: 600 });
  text(ctx, '对比 Opus 5', M + hw + 24, 300, { size: 24, fam: EN, color: C.graphite, alpha: ep(t, 27.83, 28.2, E.ioS) });

  for (const q of CELLS) {
    const b = ep(t, ta + q.born, ta + q.born + 0.12, E.outQ);
    if (b <= 0) continue;
    if (q.c >= CUT) {
      const u = t - (tc + q.fall);
      if (u > 0.8) continue;
      if (u > 0) {
        const x = q.x + q.vx * u, y = q.y + q.vy * u + 1300 * u * u;
        ctx.save();
        ctx.translate(x + 3.5, y + 3.5);
        ctx.rotate(q.w * u);
        ctx.fillStyle = rgba(C.graphite, q.a * (1 - prog(u, 0.25, 0.8)));
        ctx.fillRect(-3.5, -3.5, 7, 7);
        ctx.restore();
        continue;
      }
      const shake = u > -0.1 ? (hash(q.c, q.r, Math.floor(t * 60)) - 0.5) * 2 : 0;
      ctx.fillStyle = rgba(C.graphite, q.a * b);
      ctx.fillRect(q.x + shake, q.y, 7, 7);
    } else {
      const lt = ep(t, tl + 0.3 * (q.c / CUT), tl + 0.3 * (q.c / CUT) + 0.35, E.ioS);
      ctx.fillStyle = mix(C.graphite, C.paper, lt, lerp(q.a, 0.72 + 0.25 * q.a, lt) * b);
      ctx.fillRect(q.x, q.y, 7, 7);
    }
  }
  const dash = ep(t, 28.95, 29.4, E.ioS);
  if (dash > 0) {
    ctx.setLineDash([6, 5]);
    ctx.lineWidth = 1.5;
    ctx.strokeStyle = rgba(C.graphite, 0.6 * dash);
    ctx.strokeRect(BX + CUT * P + 0.5, BY + 0.5, (COLS - CUT) * P - 2, ROWS * P - 2);
    ctx.setLineDash([]);
  }
  const r40 = ep(t, 28.7, 29.2, E.outC);
  text(ctx, '−40%', W - M, 420 + 20 * (1 - r40), { size: 160, weight: 250, fam: EN, color: C.paper, align: 'right', alpha: r40 });

  // ---- 输出速度 +30% 以上
  const tb = 29.75;
  wipeText(ctx, '输出速度', M, 600, ep(t, 29.5, 30.05, E.lin), { size: 44, weight: 600, color: C.paper });
  const la = ep(t, 29.6, 29.9, E.ioS);
  text(ctx, 'Opus 5', M, 690, { size: 24, fam: EN, color: C.graphite, alpha: la });
  text(ctx, 'Opus 5.5', M, 770, { size: 24, weight: 600, fam: EN, color: C.paper, alpha: la });
  lane(ctx, t, tb, CPS / SLOW, 690, rgba(C.graphite, 0.9), C.graphite);
  lane(ctx, t, tb, CPS, 770, C.paper, C.clay);

  const r30 = ep(t, 30.62, 31.1, E.outC);
  const yw = measure(ctx, '以上', { size: 32, weight: 400 });
  text(ctx, '以上', W - M, 770, { size: 32, color: C.graphite, align: 'right', alpha: ep(t, 31.02, 31.4, E.ioS) });
  text(ctx, '+30%', W - M - yw - 14, 770 + 20 * (1 - r30), { size: 160, weight: 250, fam: EN, color: C.paper, align: 'right', alpha: r30 });

  footnote(ctx, 'API 定价：每百万 tokens 输入 $4、输出 $20', t, 31.6, true);
  return { vignette: 0.85 };
}
