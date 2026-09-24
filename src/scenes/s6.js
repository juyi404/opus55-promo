// S6 · 34–44s · paper. A long, hedging reply; the characters that matter light up and fly to
// the top — the result first, the one thing to do second. Then Ramp's line.
import { C, EN, M, W, H, E, ep, lerp, text, measure, wipeText, drawThread, ember, camera, mix } from '../lib.js';

const PARA = '关于这次迁移，在综合考虑了多方面的因素之后，我想先简单说明一下整体的背景和过程。我们逐一检查了各个模块，也对可能存在的风险做了评估。总体而言，情况基本符合预期，全部测试目前看来都已经通过了。另外，在上线之前，可能只需要你再帮忙确认一处配置。所以，迁移应该算是已完成了。';
const PER = 36, PS = 34, PL = 58, PY = 640;
const PUNCT = '，。、：；！？”';

// Paragraph on a full-width grid; punctuation never starts a line (it hangs instead).
const SRC = [];
{
  let col = 0, row = 0;
  for (const ch of PARA) {
    if (col >= PER && !PUNCT.includes(ch)) { col = 0; row++; }
    SRC.push({ ch, x: M + col * PS, y: PY + row * PL, row });
    col++;
  }
}
const LINES = [
  { s: '迁移已完成，全部测试通过。', y: 410, size: 64, weight: 600, color: C.ink },
  { s: '上线前，只需你确认一处配置。', y: 492, size: 44, weight: 400, color: C.slate },
];
// Each target character takes the last unused matching character of the paragraph, so the
// conclusion ("迁移……已完成") is pulled from the very end of the reply to the front.
const TGT = [], USED = new Set();
LINES.forEach(L => [...L.s].forEach((ch, j) => {
  let src = -1;
  for (let i = SRC.length - 1; i >= 0; i--) if (!USED.has(i) && SRC[i].ch === ch) { src = i; break; }
  if (src >= 0) USED.add(src);
  TGT.push({ ch, src, x: M + j * L.size, y: L.y, size: L.size, weight: L.weight, color: L.color, n: TGT.length });
}));

let layer;
function layerCtx(ctx) {
  if (!layer) { layer = document.createElement('canvas'); layer.width = W; layer.height = H; }
  const l = layer.getContext('2d');
  l.setTransform(1, 0, 0, 1, 0, 0);
  l.clearRect(0, 0, W, H);
  l.setTransform(ctx.getTransform());
  return l;
}

const T_HL = 35.45, T_FLY = 36.05, STAG = 0.022, DUR = 0.75, T_LINE = 37.4;
// Safari has no canvas filter. Ask the prototype: clear() sets ctx.filter every frame, which
// there only leaves a plain property on the context. (Guarded, so that like the other scenes
// this still imports outside a browser.)
const FILTER = 'filter' in (globalThis.CanvasRenderingContext2D?.prototype ?? {});
// where the paragraph's glyphs are, with room for the blur and the camera's slow push-in
const BAND = [M - 24, PY - PS - 24, (PER + 1) * PS + 48, SRC[SRC.length - 1].row * PL + PS + 48];

export default function s6(ctx, t, sc, k) {
  ctx.fillStyle = C.paper;
  ctx.fillRect(0, 0, W, H);
  camera(ctx, t, sc.t0, sc.t1, 0.02);

  wipeText(ctx, '表达更自然', M, 280, ep(t, k.L7 - 0.05, k.L7 + 0.6, E.lin), { size: 44, weight: 500, color: C.slate });

  const hl = ep(t, T_HL, T_HL + 0.5, E.ioS);
  const gone = ep(t, T_FLY + 0.15, T_FLY + 0.95, E.ioS);

  // the rest of the reply: dims and blurs, then clears away
  if (gone < 1) {
    const l = layerCtx(ctx);
    SRC.forEach((q, i) => {
      if (USED.has(i)) return;
      text(l, q.ch, q.x, q.y, { size: PS, color: C.slate, alpha: ep(t, 34.1 + 0.08 * q.row, 34.5 + 0.08 * q.row) });
    });
    ctx.save();
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.globalAlpha = lerp(1, 0.3, hl) * (1 - gone);
    if (hl > 0 && !FILTER) {
      // the layer is all one colour (every row has faded in by now), so its shadow in that colour
      // is the same Gaussian blur, sigma = shadowBlur / 2: draw the layer a frame to the left and
      // let only the shadow fall into place. Just the band with the text in it, as blurring costs
      // by the area.
      const [x, y, w, h] = BAND;
      ctx.shadowColor = C.slate;
      ctx.shadowBlur = 5 * hl;
      ctx.shadowOffsetX = W;
      ctx.drawImage(layer, x, y, w, h, x - W, y, w, h);
    } else {
      if (hl > 0) ctx.filter = `blur(${(2.5 * hl).toFixed(2)}px)`;
      ctx.drawImage(layer, 0, 0);
    }
    ctx.restore();
  }

  // the characters that matter: light up, then fly into place
  for (const q of TGT) {
    const ts = T_FLY + STAG * q.n, p = ep(t, ts, ts + DUR, E.ioC);
    const s = SRC[q.src];
    if (!s) { text(ctx, q.ch, q.x, q.y, { size: q.size, weight: q.weight, color: q.color, alpha: p }); continue; }
    const a = ep(t, 34.1 + 0.08 * s.row, 34.5 + 0.08 * s.row);
    const dist = Math.hypot(q.x - s.x, q.y - s.y);
    const x = lerp(s.x, q.x, p), y = lerp(s.y, q.y, p) - (20 + 0.08 * dist) * Math.sin(Math.PI * p);
    const color = p > 0 ? mix(C.ink, q.color, p) : mix(C.slate, C.ink, hl);
    text(ctx, q.ch, x, y, { size: lerp(PS, q.size, p), weight: lerp(lerp(400, 600, hl), q.weight, p), color, alpha: a });
  }

  // the thread underlines the answer
  const u = ep(t, T_LINE, T_LINE + 0.5, E.ioC);
  if (u > 0) {
    const x1 = lerp(M, M + 12 * 64 + 8, u);
    drawThread(ctx, M, x1, () => 436, { width: 3, n: 8 });
    ember(ctx, x1, 436, 6, 1 - ep(t, T_LINE + 0.5, T_LINE + 0.9), 0.3);
  }

  // Ramp
  wipeText(ctx, 'Ramp 这样评价：', M, 690, ep(t, k.L7b - 0.05, k.L7b + 0.9, E.lin), { size: 32, fam: EN, color: C.slate });
  const qo = { size: 72, weight: 500, color: C.ink, soft: 220 };
  const hang = measure(ctx, '“', qo);
  wipeText(ctx, '“它写起来，像一位好同事。”', M - hang, 790, ep(t, k.L7b + 1.45, k.L7b + 3.6, E.lin), qo);
  return {};
}
