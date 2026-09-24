// S3 · 12–18s · paper. The thread becomes an 18-hour timeline; a playhead runs along it and
// leaves a steady trail of activity marks (tool calls) — no fatigue, no drift.
import { C, EN, M, TY, W, E, ep, prog, lerp, hash, vnoise, text, measure, wipeText, drawThread, ember, camera, footnote, rgba } from '../lib.js';

const X0 = M, X1 = W - M, HOURS = 18;
const hx = h => X0 + ((X1 - X0) * h) / HOURS;

export default function s3(ctx, t, sc, k) {
  ctx.fillStyle = C.paper;
  ctx.fillRect(0, 0, W, 1080);
  camera(ctx, t, sc.t0, sc.t1, 0.02);

  // playhead: 0h at L4 cue, 18h at the right margin, then on past the edge ("以上")
  const ta = k.L4 + 0.05, tb = k.L4 + 3.4, tc = tb + 0.9;
  const px = t < tb ? lerp(X0, X1, E.ioS(prog(t, ta, tb)) * 0.15 + prog(t, ta, tb) * 0.85)
    : lerp(X1, W + 40, E.inQ(prog(t, tb, tc)));

  // base line and hour ticks
  const base = ep(t, sc.t0, sc.t0 + 0.5, E.outQuart);
  ctx.fillStyle = rgba(C.graphite, 1);
  ctx.fillRect(X0, TY - 1, (W + 60 - X0) * base, 2);
  for (let h = 0; h <= HOURS; h++) {
    const a = ep(t, sc.t0 + 0.05 + h * 0.02, sc.t0 + 0.3 + h * 0.02);
    const major = h % 3 === 0;
    ctx.fillStyle = rgba(major ? C.slate : C.graphite, a);
    ctx.fillRect(hx(h) - 1, TY + 6, 2, major ? 16 : 9);
    if (major) text(ctx, h === HOURS ? '18 小时' : String(h), hx(h), TY + 58, { size: 24, fam: EN, color: C.slate, alpha: a, align: 'center' });
  }

  // activity marks behind the playhead
  if (t > ta) {
    for (let x = X0 + 2, i = 0; x < Math.min(px, W + 40); x += 4, i++) {
      const burst = 0.35 + 0.65 * vnoise(i * 0.09, 3);
      const hgt = 8 + 50 * burst * (0.55 + 0.45 * hash(i, 5));
      const grow = E.outC(Math.min(1, (px - x) / 48));
      const near = Math.max(0, 1 - (px - x) / 140);
      ctx.fillStyle = near > 0 ? `rgba(${Math.round(lerp(20, 217, near))},${Math.round(lerp(20, 119, near))},${Math.round(lerp(19, 87, near))},0.9)` : rgba(C.ink, 0.82);
      ctx.fillRect(x, TY - 6 - hgt * grow, 2, hgt * grow);
    }
    drawThread(ctx, X0, Math.min(px, W + 40), () => TY, { width: 3 });
    if (px < W + 20) ember(ctx, px, TY, 7, 1, 0.3);
  }

  // copy
  wipeText(ctx, '连续工作', M, 250, ep(t, k.L4 - 0.05, k.L4 + 0.6, E.lin), { size: 44, weight: 500, color: C.slate });
  const r18 = ep(t, k.L4 + 0.88, k.L4 + 1.5, E.outC);
  const big = { size: 260, weight: 300, fam: EN, color: C.ink };
  text(ctx, '18', M - 8, 470 + 26 * (1 - r18), { ...big, alpha: r18 });
  wipeText(ctx, '小时以上', M - 8 + measure(ctx, '18', big) + 28, 470, ep(t, k.L4 + 1.35, k.L4 + 2.1, E.lin), { size: 80, weight: 500, color: C.ink });
  wipeText(ctx, '始终专注于任务。', M, 820, ep(t, k.L4 + 2.37, k.L4 + 3.5, E.lin), { size: 48, weight: 500, color: C.ink });
  footnote(ctx, '据早期测试者 Clio 的实测', t, k.L4 + 3.0, false);
  return {};
}
