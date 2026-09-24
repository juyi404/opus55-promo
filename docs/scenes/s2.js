// S2 · 4–12s · ink. A wall of code scrolls up through the thread, which "migrates" each line
// as it passes; the counter runs to 680,000. Then the wall collapses into the thread and
// "不到一天。" rests on it without bending it.
import { C, ZH, EN, MONO, M, TY, W, H, E, ep, prog, lerp, hash, ring, text, wipeText, slotNumber, slotWidth, setText, drawThread, camera, footnote, rgba } from '../lib.js';

const NAMES = ['order', 'invoice', 'ledger', 'account', 'session', 'report', 'payment', 'user', 'refund', 'batch', 'policy', 'vendor'];
// [legacy, migrated] pairs; $ is replaced by an identifier.
const PAIRS = [
  ["var $Svc = require('./$/service');", "import { $Service } from './$/service';"],
  ['db.query(sql, function (err, rows) {', 'const rows = await db.query(sql);'],
  ['  if (err) return callback(err);', '  if (!rows.length) throw new NotFound($Id);'],
  ['module.exports = { load$, save$ };', 'export { load$, save$ };'],
  ['_.map(list, function (x) { return x.id; });', 'list.map(x => x.id);'],
  ['$.prototype.total = function () {', 'get total(): Money {'],
  ["  return this.items.reduce(add, 0);", '  return sum(this.items, i => i.price);'],
  ['function fetch$(id, cb) {', 'async function fetch$(id: $Id) {'],
  ["  http.get('/api/$/' + id, cb);", '  return api.get(`/api/$/${id}`);'],
  ['}', '}'],
  ['', ''],
  ['var self = this;', ''],
  ['setTimeout(function () { retry$(); }, 500);', 'await retry(() => sync$(), { delay: 500 });'],
  ["assert.equal(res.status, 200);", 'expect(res.status).toBe(200);'],
  ['$Store.on("change", this.update.bind(this));', 'useEffect(() => $Store.subscribe(update), []);'],
  ['for (var i = 0; i < $s.length; i++) {', 'for (const $ of $s) {'],
];
const COLS = [72, 712, 1352], LH = 22;

function codeLine(n, c, migrated) {
  const h = hash(n, c, 7);
  const pair = PAIRS[Math.floor(h * PAIRS.length)];
  const name = NAMES[Math.floor(hash(n, c, 9) * NAMES.length)];
  const Name = name[0].toUpperCase() + name.slice(1);
  const indent = '  '.repeat(Math.floor(hash(n, c, 3) * 3));
  const s = migrated ? pair[1] : pair[0];
  return s ? indent + s.replace(/\$([A-Z]?)/g, (_, cap) => (cap ? Name + cap : name)) : '';
}

function wall(ctx, t, t0) {
  const u = t - t0;
  const scroll = 40 * u + 64 * u * u;
  const slam = Math.exp(-7 * u);
  ctx.font = `400 15px ${MONO}`;
  ctx.textAlign = 'left';
  ctx.textBaseline = 'alphabetic';
  ctx.letterSpacing = '0px';
  const first = Math.floor((scroll - 40) / LH), last = Math.ceil((scroll + H + 40) / LH);
  for (let c = 0; c < 3; c++) {
    const off = c * 7; // columns are staggered so their rows don't line up
    for (let n = first; n <= last; n++) {
      const y = n * LH - scroll + off - 30 * slam;
      const migrated = y < TY;
      const s = codeLine(n, c, migrated);
      if (!s) continue;
      const d = TY - y; // distance above the thread
      let a, col;
      if (!migrated) { a = 0.2; col = C.graphite; }
      else if (d < 90) { a = lerp(0.85, 0.34, d / 90); col = d < 18 ? C.clay : C.paper; }
      else { a = 0.34; col = C.paper; }
      ctx.globalAlpha = Math.min(1, a * (1 + 1.6 * slam));
      ctx.fillStyle = col;
      ctx.fillText(s, COLS[c], y);
    }
  }
  ctx.globalAlpha = 1;
}

export default function s2(ctx, t, sc, k) {
  const t0 = sc.t0;
  const squash = ep(t, 9.0, 9.9, E.inC); // wall collapses into the thread
  const jolt = 10 * ring(t - t0, 5, 0.35);
  camera(ctx, t, t0, sc.t1, 0.025, 0, jolt);

  if (squash < 1) {
    ctx.save();
    ctx.translate(0, TY);
    ctx.scale(1, 1 - squash);
    ctx.translate(0, -TY);
    ctx.globalAlpha = 1;
    wall(ctx, t, t0);
    ctx.restore();
  }
  // keep the left side quiet so the numbers read
  const g = ctx.createLinearGradient(0, 0, 1500, 0);
  g.addColorStop(0, rgba(C.ink, 0.94));
  g.addColorStop(0.62, rgba(C.ink, 0.86));
  g.addColorStop(1, rgba(C.ink, 0));
  ctx.fillStyle = g;
  ctx.fillRect(-100, -100, 1700, H + 200);

  const glow = 0.5 + 2.2 * ep(t, 9.3, 9.9, E.inQ) * (1 - ep(t, 9.95, 10.8, E.outQ));
  drawThread(ctx, -60, W + 60, () => TY, { glow, width: 3 + 2 * squash * (1 - ep(t, 9.95, 10.6)) });

  // 680,000 行代码迁移
  const out = 1 - ep(t, 9.0, 9.7, E.inQ);
  const cnt = Math.round(680000 * ep(t, k.L2 - 0.1, k.L2 + 1.3, E.outC));
  const num = cnt.toLocaleString('en-US');
  const nw = 900 - 650 * ep(t, 9.0, 9.7, E.ioS);
  const numO = { size: 240, weight: nw, fam: EN, color: C.paper };
  const full = slotWidth(ctx, '680,000', numO);
  if (t >= k.L2 - 0.1) slotNumber(ctx, num, M + full, 560, { ...numO, alpha: out * ep(t, k.L2 - 0.1, k.L2 + 0.1) });
  wipeText(ctx, '行代码迁移', M + full + 36, 560, ep(t, k.L2 + 0.68, k.L2 + 1.6, E.lin), { size: 72, weight: 600, color: C.paper, alpha: out });
  wipeText(ctx, '团队预估：数周', M, 740, ep(t, k.L2 + 2.16, k.L2 + 3.4, E.lin), { size: 40, weight: 400, color: C.graphite, alpha: out });

  // 不到一天。 — rests on the thread; the string stays straight
  const tb = k.L3 + 0.59;
  setText(ctx, { size: 220, weight: 250, fam: ZH });
  const desc = ctx.measureText('不到一天。').actualBoundingBoxDescent;
  wipeText(ctx, '不到一天。', M, TY - 4 - desc, ep(t, tb - 0.05, tb + 0.8, E.lin), { size: 220, weight: 250, color: C.paper, soft: 260 });
  footnote(ctx, '来自一位早期测试者的实际项目', t, tb + 0.5, true);
  return { vignette: 0.85 };
}
