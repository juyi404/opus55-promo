// S4 · 18–26s · paper. Three benchmark rows as a dot plot. Opus 5.5's dot starts where
// Opus 5 sits and travels to its own score, drawing the gain as a clay segment.
import { C, EN, M, W, E, ep, lerp, text, measure, wipeText, camera, footnote } from '../lib.js';

const L0 = 560, L1 = W - M;
// [zh, en, min, max, unit, opus5, fable51, opus55, beat offset from L5]
const ROWS = [
  ['编程', 'Terminal-Bench 4.0', 40, 90, '%', 52.3, 55.8, 66.4, 0],
  ['电脑操作', 'OSWorld 2.0', 40, 90, '%', 74.0, 80.7, 81.8, 0.81],
  ['知识工作', 'GDPval-AA v2.1', 1500, 2000, ' Elo', 1708, 1735, 1846, 1.92],
];
const YS = [480, 640, 800];

function dot(ctx, x, y, r, a, fill, stroke, lw = 3) {
  if (r <= 0 || a <= 0) return;
  ctx.globalAlpha = a;
  ctx.beginPath();
  ctx.arc(x, y, r, 0, Math.PI * 2);
  if (fill) { ctx.fillStyle = fill; ctx.fill(); }
  if (stroke) { ctx.lineWidth = lw; ctx.strokeStyle = stroke; ctx.stroke(); }
  ctx.globalAlpha = 1;
}

export default function s4(ctx, t, sc, k) {
  ctx.fillStyle = C.paper;
  ctx.fillRect(0, 0, W, 1080);
  camera(ctx, t, sc.t0, sc.t1, 0.018);
  const tHead = k.L5 + 3.02, tDelta = tHead + 1.4;

  ROWS.forEach(([zh, en, lo, hi, unit, o5, f51, o55, off], i) => {
    const y = YS[i], tb = k.L5 + off;
    const X = v => lerp(L0, L1, (v - lo) / (hi - lo));
    const la = ep(t, tb - 0.15, tb + 0.25, E.outQ);
    text(ctx, zh, M, y + 15, { size: 44, weight: 600, color: C.ink, alpha: la });
    text(ctx, en, M, y + 50, { size: 22, fam: EN, color: C.slate, alpha: la });

    const draw = ep(t, tb, tb + 0.45, E.outQuart);
    ctx.fillStyle = C.graphite;
    ctx.fillRect(L0, y - 1, (L1 - L0) * draw, 2);
    const ends = unit === '%' ? [`${lo}%`, `${hi}%`] : [`${lo}`, `${hi} Elo`];
    text(ctx, ends[0], L0, y + 40, { size: 20, fam: EN, color: C.slate, alpha: draw });
    text(ctx, ends[1], L1, y + 40, { size: 20, fam: EN, color: C.slate, alpha: draw, align: 'right' });

    // gain segment first, so the reference markers sit on top of it
    const mv = ep(t, tb + 0.45, tb + 1.1, E.ioC);
    const x55 = lerp(X(o5), X(o55), mv);
    if (t > tb + 0.45) {
      ctx.fillStyle = C.clay;
      ctx.fillRect(X(o5), y - 2, x55 - X(o5), 4);
    }
    dot(ctx, X(o5), y, 10 * ep(t, tb + 0.25, tb + 0.45, E.outBack), 1, C.graphite);
    dot(ctx, X(f51), y, 10 * ep(t, tb + 0.35, tb + 0.55, E.outBack), 1, C.paper, C.ink);
    if (t > tb + 0.4) {
      dot(ctx, x55, y, 13 * ep(t, tb + 0.4, tb + 0.55, E.outBack), 1, C.clay);
      const v = lerp(o5, o55, mv);
      const label = unit === '%' ? `${v.toFixed(1)}%` : `${Math.round(v)}`;
      text(ctx, label, x55, y - 30, { size: 34, weight: 600, fam: EN, color: C.ink, align: 'center', alpha: ep(t, tb + 0.45, tb + 0.65) });
    }

    // during the hold: the gain over Opus 5, under the clay segment
    const d = o55 - o5;
    const dl = unit === '%' ? `+${d.toFixed(1)} 个百分点` : `+${Math.round(d)} Elo`;
    const da = ep(t, tDelta + i * 0.12, tDelta + i * 0.12 + 0.5, E.ioS);
    text(ctx, dl, (X(o5) + X(o55)) / 2, y + 40 + 8 * (1 - da), { size: 22, weight: 500, fam: EN, color: C.clay, align: 'center', alpha: da });
  });

  // legend, top right
  const lg = ep(t, k.L5 + 0.2, k.L5 + 0.7, E.outQ);
  const items = [['Opus 5', 'o5'], ['Claude Fable 5.1', 'f'], ['Opus 5.5', 'o55']];
  let x = L1;
  for (let j = items.length - 1; j >= 0; j--) {
    const [label, kind] = items[j];
    const w = measure(ctx, label, { size: 22, fam: EN });
    text(ctx, label, x, 390, { size: 22, fam: EN, color: C.slate, align: 'right', alpha: lg });
    const cx = x - w - 18;
    if (kind === 'o5') dot(ctx, cx, 383, 8, lg, C.graphite);
    else if (kind === 'f') dot(ctx, cx, 383, 8, lg, C.paper, C.ink, 2.5);
    else dot(ctx, cx, 383, 10, lg, C.clay);
    x = cx - 44;
  }

  wipeText(ctx, '比肩 Claude Fable 5.1', M, 300, ep(t, tHead - 0.05, tHead + 1.1, E.lin), { size: 88, weight: 600, fam: EN, color: C.ink, soft: 220 });
  footnote(ctx, '基准测试数据来自 Anthropic，2026 年 9 月', t, tHead + 0.6, false);
  return {};
}
