// Entry point: one 1920×1080 canvas and one pure render(t). The same code drives the
// web player and the frame-by-frame render (?render=1).
import { W, H, C, SEEN, FAMILIES, clamp, clear, vignette } from './lib.js';
import s1 from './scenes/s1.js';
import s2 from './scenes/s2.js';
import s3 from './scenes/s3.js';
import s4 from './scenes/s4.js';
import s5 from './scenes/s5.js';
import s6 from './scenes/s6.js';
import s7 from './scenes/s7.js';
import s8 from './scenes/s8.js';

const cues = await (await fetch(new URL('./cues.json', import.meta.url))).json();
const DUR = cues.duration, FPS = cues.fps;
const DRAW = { S1: s1, S2: s2, S3: s3, S4: s4, S5: s5, S6: s6, S7: s7, S8: s8 };
const scenes = cues.scenes.map(s => ({ ...s, draw: DRAW[s.id] }));
// Cue start times by line id (k.L2 etc.); scenes place their beats relative to these.
const k = Object.fromEntries(cues.vo.map(l => [l.id, l.t]));

const params = new URLSearchParams(location.search);
const RENDER = params.has('render');
if (RENDER) document.body.classList.add('render');
const cv = document.getElementById('c');
// float16: the layers composite at full precision, and the frame is rounded to 8 bits just once,
// on its way out (yuv420 below), with dither — so the dark gradients don't band
const ctx = cv.getContext('2d', { alpha: false, colorType: 'float16' });

function render(t) {
  t = Math.min(Math.max(t, 0), DUR);
  const sc = scenes.find(s => t >= s.t0 && t < s.t1) ?? scenes[scenes.length - 1];
  clear(ctx, C.ink);
  ctx.save();
  const o = sc.draw(ctx, t, sc, k) || {};
  ctx.restore();
  if (o.vignette) vignette(ctx, o.vignette);
  if (o.fade > 0) {
    ctx.globalAlpha = o.fade;
    ctx.fillStyle = '#000';
    ctx.fillRect(0, 0, W, H);
    ctx.globalAlpha = 1;
  }
}

// The fonts, all in before anything is drawn: S1 and S8 keep what they measure of a glyph, so a
// frame drawn in a fallback font would leave its measures behind. On the site, the page lists the
// glyphs the film draws (render.mjs site) and just the unicode-range slices that hold them load;
// here, every slice does.
async function preload() {
  const listed = document.documentElement.dataset.glyphs;
  if (listed === undefined) await Promise.all([...document.fonts].map(f => f.load()));
  else await Promise.all(FAMILIES.map(f => document.fonts.load(`400 100px '${f}'`, listed + '0123456789')));
  await document.fonts.ready;
}

// The frame at t as 8-bit BT.709 limited-range 4:2:0, the encoder's own format. Each plane is
// rounded against a fixed dither threshold (interleaved gradient noise, offset per plane); the
// pattern stays put from frame to frame, so the encoder can carry it over.
const ign = (x, y) => { const f = 0.06711056 * x + 0.00583715 * y, g = 52.9829189 * (f - Math.floor(f)); return g - Math.floor(g); };
let yuvOut, dither;
function yuv420(t) {
  render(t);
  const d = ctx.getImageData(0, 0, W, H, { pixelFormat: 'rgba-float16' }).data;
  const n = W * H, w2 = W / 2, h2 = H / 2, U = n, V = n + n / 4;
  if (!yuvOut) {
    yuvOut = new Uint8ClampedArray(n * 1.5); // rounds to nearest: + (threshold - 0.5) makes it dithered
    dither = new Float32Array(n * 1.5);
    for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) dither[y * W + x] = ign(x, y) - 0.5;
    for (let y = 0; y < h2; y++) for (let x = 0; x < w2; x++) {
      dither[U + y * w2 + x] = ign(x + 37, y + 11) - 0.5;
      dither[V + y * w2 + x] = ign(x + 13, y + 59) - 0.5;
    }
  }
  const o = yuvOut, q = dither;
  for (let j = 0, i = 0; j < n; j++, i += 4) o[j] = 16 + 219 * (0.2126 * d[i] + 0.7152 * d[i + 1] + 0.0722 * d[i + 2]) + q[j];
  for (let y = 0; y < h2; y++) {
    for (let x = 0; x < w2; x++) {
      const a = 8 * (y * W + x), b = a + 4 * W; // top-left of the 2×2 block, and the pixel below it
      const r = (d[a] + d[a + 4] + d[b] + d[b + 4]) / 4;
      const g = (d[a + 1] + d[a + 5] + d[b + 1] + d[b + 5]) / 4;
      const bl = (d[a + 2] + d[a + 6] + d[b + 2] + d[b + 6]) / 4;
      const l = 0.2126 * r + 0.7152 * g + 0.0722 * bl, c = y * w2 + x;
      o[U + c] = 128 + (224 / 1.8556) * (bl - l) + q[U + c];
      o[V + c] = 128 + (224 / 1.5748) * (r - l) + q[V + c];
    }
  }
  return new Uint8Array(o.buffer);
}

window.__duration = DUR;
window.__fps = FPS;
window.__render = render;
window.__glyphs = () => [...SEEN].join(''); // every glyph drawn so far
// Rendering: the page posts each frame's bytes to the local server (render/serve.mjs), which feeds
// them to ffmpeg; handing 3 MB back through DevTools as base64 took longer than drawing the frame.
// Wrapped in a Blob, the upload is about three times faster than as a bare Uint8Array.
window.__send = (t, url) => fetch(url, { method: 'POST', body: new Blob([yuv420(t)]) }).then(r => r.status);
window.__ready = preload().then(() => true);

if (!RENDER) {
  const $ = id => document.getElementById(id);
  const stage = $('stage'), bar = $('bar'), cover = $('cover'), wait = $('wait'), audio = $('audio');
  const begin = $('start'), play = $('play'), scrub = $('scrub'), time = $('time'), voice = $('voice'), full = $('full');

  // The film as large as it fits, centred: lifted clear of the controls where there is room under
  // it, and under them (they hide while it plays) where there isn't.
  const fit = () => {
    const bh = bar.offsetHeight, s = Math.min(innerWidth / W, innerHeight / H);
    const y = Math.max(0, Math.min((innerHeight - H * s) / 2, innerHeight - bh - H * s));
    stage.style.transform = `translate(${(innerWidth - W * s) / 2}px, ${y}px) scale(${s})`;
    document.documentElement.style.setProperty('--bar', `${bh}px`);
  };
  addEventListener('resize', fit);
  fit();

  // The audio is the clock. Its currentTime moves in steps, so between them the page clock carries
  // the picture on, but never more than LEAD past the last step, so that a stall holds the picture
  // too. Without audio (it failed to load, or won't play here) the page clock runs the film alone.
  const LEAD = 0.1;
  let t = clamp(Number(params.get('t')) || 0, 0, DUR), dirty = true, ready = false;
  let silent = false, run = false; // no audio; and then, whether the film runs
  let t0 = 0, p0 = 0;              // silent: film time and page time at the last start or seek
  let waiting = false, waitSince = 0;
  let read = -1, readAt = 0;       // audio.currentTime as last read, and when it was
  const playing = () => (silent ? run : !audio.paused);
  const clock = now => {
    if (silent) return run ? t0 + (now - p0) / 1000 : t;
    const a = audio.currentTime;
    if (a !== read) { read = a; readAt = now; }
    return audio.paused || waiting ? a : a + Math.min((now - readAt) / 1000, LEAD);
  };
  const toSilent = () => {
    if (silent) return;
    silent = true; run = !audio.paused; waiting = false; t0 = t; p0 = performance.now();
  };
  const setVoice = () => {
    silent = false; run = false; waiting = false; read = -1;
    audio.src = audio.dataset.src.replace('{voice}', voice.value);
  };
  audio.addEventListener('loadedmetadata', () => { if (Math.abs(audio.currentTime - t) > 0.02) audio.currentTime = t; });
  for (const e of ['waiting', 'seeking']) audio.addEventListener(e, () => { if (!waiting) waitSince = performance.now(); waiting = true; });
  for (const e of ['playing', 'seeked']) audio.addEventListener(e, () => { waiting = false; });
  audio.addEventListener('error', toSilent);
  audio.addEventListener('ended', () => { t = DUR; dirty = true; });

  const seek = x => {
    t = clamp(x, 0, DUR); t0 = t; p0 = performance.now(); read = -1; dirty = true;
    if (!silent) audio.currentTime = t;
  };
  const start = () => {
    if (!ready) return;
    cover.hidden = true;
    if (t >= DUR) seek(0);
    if (silent) { run = true; t0 = t; p0 = performance.now(); }
    else {
      if (Math.abs(audio.currentTime - t) > 0.02) audio.currentTime = t;
      audio.play().catch(e => {
        // NotSupportedError: this audio won't play here, so the film goes on without it.
        // NotAllowedError (no user gesture) or AbortError (paused, or a new voice, first): it stays paused.
        if (e.name === 'NotSupportedError') { toSilent(); start(); }
      });
    }
    wake();
  };
  const pause = () => {
    if (silent && run) t = Math.min(clock(performance.now()), DUR);
    run = false;
    audio.pause();
    wake();
  };
  const toggle = () => (playing() ? pause() : start());

  // While it plays, the controls and the pointer hide after 2.5 s without input.
  let idleTimer = 0, overBar = false, tapWoke = false;
  const wake = () => {
    document.body.classList.remove('idle');
    clearTimeout(idleTimer);
    idleTimer = setTimeout(() => {
      if (playing() && cover.hidden && !overBar && !bar.querySelector(':focus-visible')) document.body.classList.add('idle');
    }, 2500);
  };
  bar.addEventListener('pointerenter', () => { overBar = true; });
  bar.addEventListener('pointerleave', () => { overBar = false; wake(); });
  // on a touch screen, the first tap on the hidden controls only brings them back
  addEventListener('pointerdown', e => { tapWoke = e.pointerType !== 'mouse' && document.body.classList.contains('idle'); wake(); }, true);
  addEventListener('pointermove', e => { if (e.pointerType === 'mouse') wake(); });
  addEventListener('click', e => { if (ready && !tapWoke && !e.target.closest('#bar, #cover')) toggle(); });
  // a click on a button leaves the focus where it was, so that Space still plays and pauses
  bar.addEventListener('mousedown', e => { if (e.target.closest('button')) e.preventDefault(); });

  const root = document.documentElement;
  const fsElement = () => document.fullscreenElement ?? document.webkitFullscreenElement;
  full.hidden = !(document.fullscreenEnabled ?? document.webkitFullscreenEnabled);
  const fullscreen = () => {
    if (full.hidden) return;
    const p = fsElement() ? (document.exitFullscreen ?? document.webkitExitFullscreen).call(document)
      : (root.requestFullscreen ?? root.webkitRequestFullscreen).call(root);
    p?.catch?.(() => {});
  };
  for (const e of ['fullscreenchange', 'webkitfullscreenchange']) {
    document.addEventListener(e, () => { full.textContent = fsElement() ? '退出全屏' : '全屏'; fit(); });
  }

  begin.addEventListener('click', start);
  play.addEventListener('click', toggle);
  full.addEventListener('click', fullscreen);
  scrub.addEventListener('input', () => { cover.hidden = true; seek(Number(scrub.value)); wake(); });
  voice.addEventListener('change', () => { const was = playing(); pause(); setVoice(); if (was) start(); });
  addEventListener('keydown', e => {
    if (!ready || e.ctrlKey || e.metaKey || e.altKey || e.target === voice) return;
    if ((e.code === 'Space' || e.code === 'Enter') && e.target.closest('button, a')) return; // the control's own
    if (!cover.hidden) {
      if (e.code === 'Space' || e.code === 'Enter') { e.preventDefault(); start(); }
      return;
    }
    const step = e.shiftKey ? 1 : 1 / FPS;
    switch (e.code) {
      case 'Space': case 'KeyK': toggle(); break;
      case 'KeyF': fullscreen(); break;
      case 'ArrowRight': seek(t + step); break;
      case 'ArrowLeft': seek(t - step); break;
      case 'Home': seek(0); break;
      default: return;
    }
    e.preventDefault();
    wake();
  });

  // ?voice=cardinal|xiaoxiao|music picks the voice; ?t=<s> opens at that moment, without the start screen
  const want = params.get('voice');
  if ([...voice.options].some(o => o.value === want)) voice.value = want;
  if (params.has('t')) cover.hidden = true;
  setVoice();
  await window.__ready;
  ready = true;
  begin.disabled = play.disabled = scrub.disabled = false;
  begin.textContent = '播放';
  fit();

  const frame = now => {
    const p = playing();
    if (p) {
      // the picture follows the clock, but doesn't step back by the little it may have run ahead
      const c = Math.min(clock(now), DUR);
      if (c > t || t - c > LEAD) t = c;
      if (t >= DUR) pause();
      dirty = true;
    } else document.body.classList.remove('idle');
    if (dirty) {
      render(t);
      scrub.value = t;
      time.textContent = `${t.toFixed(2)} s`;
      dirty = false;
    }
    const label = playing() ? '暂停' : t >= DUR ? '重播' : '播放';
    if (play.textContent !== label) play.textContent = label;
    const w = p && waiting && now - waitSince > 300;
    if (wait.hidden === w) wait.hidden = !w;
    requestAnimationFrame(frame);
  };
  requestAnimationFrame(frame);
}

