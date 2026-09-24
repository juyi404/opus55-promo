// Frame-accurate renderer. Parallel workers each render a contiguous range: headless Chrome draws
// the frame (float16 canvas), turns it into dithered 8-bit yuv420p itself and POSTs the bytes to
// the local server, which writes them into that worker's ffmpeg (src/film.js, render/serve.mjs).
//
//   node render/render.mjs stills 2.5 7 10.5     -> render/tmp/still_<t>.png (16-bit)
//   node render/render.mjs video [workers]       -> out/opus55_video.mp4 (no audio)
//   node render/render.mjs mux                   -> out/opus55_promo*.mp4 (video + each mix; the
//                                                   first cut, on the synth score, in out/v1_synth/)
//   node render/render.mjs site                  -> docs/, the web version that GitHub Pages serves:
//                                                   the player, the font slices the film draws from,
//                                                   each mix as AAC, and a poster for link previews
import { spawn } from 'node:child_process';
import { mkdir, writeFile, rm, access, readFile, copyFile, cp, stat, readdir } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import puppeteer from 'puppeteer-core';
import { serve, sinks } from './serve.mjs';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const TMP = join(ROOT, 'render', 'tmp');
const OUT = join(ROOT, 'out');
const CHROME = process.env.CHROME || 'C:/Program Files/Google/Chrome/Application/chrome.exe';
const MIXES = [ // audio/build/<mix> -> out/<file>
  ['mix_cardinal.wav', 'opus55_promo.mp4'],
  ['mix_xiaoxiao.wav', 'opus55_promo_xiaoxiao.mp4'],
  ['mix_music.wav', 'opus55_promo_music_only.mp4'],
  ['mix_synth_xiaoxiao.wav', 'v1_synth/opus55_promo.mp4'],
  ['mix_synth_yunjian.wav', 'v1_synth/opus55_promo_yunjian.mp4'],
  ['mix_synth_music.wav', 'v1_synth/opus55_promo_music_only.mp4'],
];

function run(cmd, args, opts = {}) {
  return new Promise((ok, fail) => {
    const p = spawn(cmd, args, { stdio: ['pipe', 'inherit', 'inherit'], ...opts });
    p.on('error', fail);
    p.on('close', code => (code === 0 ? ok() : fail(new Error(`${cmd} exited ${code}`))));
    if (opts.feed) opts.feed(p.stdin).catch(e => { p.kill(); fail(e); });
  });
}

async function openPage(port, path = 'src/index.html') {
  const browser = await puppeteer.launch({
    executablePath: CHROME,
    headless: true,
    // canvases on the CPU from the first frame: Chrome moves one off the GPU after a few readbacks,
    // and the two anti-alias text differently, so a worker's first frames would not match the rest
    args: ['--force-device-scale-factor=1', '--hide-scrollbars', '--force-color-profile=srgb', '--mute-audio',
      '--disable-accelerated-2d-canvas'],
    defaultViewport: { width: 1920, height: 1080, deviceScaleFactor: 1 },
  });
  const page = await browser.newPage();
  page.on('pageerror', e => console.error('pageerror:', e.message));
  page.on('console', m => { if (m.type() === 'error') console.error('console.error:', m.text()); }); // a file that didn't load, too
  await page.goto(`http://127.0.0.1:${port}/${path}?render=1`, { waitUntil: 'load' });
  await page.waitForFunction('window.__ready', { timeout: 60000 });
  await page.evaluate(() => window.__ready);
  return { browser, page };
}

const grab = (page, t) =>
  page.evaluate(t => { window.__render(t); return document.getElementById('c').toDataURL('image/png').slice(22); }, t)
    .then(b64 => Buffer.from(b64, 'base64'));

async function stills(times) {
  const server = await serve(0);
  const { browser, page } = await openPage(server.address().port);
  await mkdir(TMP, { recursive: true });
  for (const s of times) {
    const t = Number(s);
    const png = await grab(page, t);
    const again = await grab(page, t);
    const file = join(TMP, `still_${t.toFixed(2)}.png`);
    await writeFile(file, png);
    console.log(file, png.equals(again) ? '' : '(NOT deterministic)');
  }
  await browser.close();
  server.close();
}

async function video(workers) {
  const server = await serve(0);
  const port = server.address().port;
  await mkdir(TMP, { recursive: true });
  await mkdir(OUT, { recursive: true });
  const probe = await openPage(port);
  const { fps, dur } = await probe.page.evaluate(() => ({ fps: window.__fps, dur: window.__duration }));
  await probe.browser.close();
  const total = Math.round(fps * dur);
  const per = Math.ceil(total / workers);
  const started = Date.now();
  let done = 0;
  const segs = [];
  await Promise.all(Array.from({ length: workers }, async (_, w) => {
    const a = w * per, b = Math.min(total, a + per);
    if (a >= b) return;
    const file = join(TMP, `seg_${String(w).padStart(2, '0')}.mp4`);
    segs[w] = file;
    const { browser, page } = await openPage(port);
    const sink = `/frame/${w}`;
    await run('ffmpeg', [
      '-y', '-v', 'error', '-f', 'rawvideo', '-pix_fmt', 'yuv420p', '-s', '1920x1080', '-framerate', String(fps), '-i', '-',
      // the frames arrive already BT.709 limited range; ffmpeg takes the tags from the frames, not
      // from the flags below, so set them here
      '-vf', 'setparams=range=tv:colorspace=bt709:color_primaries=bt709:color_trc=bt709',
      // tune film and aq-mode 3 keep the dither in the dark gradients (tune grain makes them band)
      '-c:v', 'libx264', '-preset', 'slow', '-tune', 'film', '-crf', '16', '-x264-params', 'aq-mode=3', '-g', String(fps * 2),
      '-colorspace', 'bt709', '-color_primaries', 'bt709', '-color_trc', 'bt709', '-color_range', 'tv',
      '-threads', '2', file,
    ], {
      feed: async stdin => {
        sinks.set(sink, stdin);
        for (let i = a; i < b; i++) {
          const status = await page.evaluate((t, u) => window.__send(t, u), i / fps, sink);
          if (status !== 204) throw new Error(`frame ${i}: HTTP ${status}`);
          if (++done % 120 === 0) {
            const el = (Date.now() - started) / 1000;
            console.log(`${done}/${total} frames  ${(done / el).toFixed(1)} fps  eta ${((total - done) / (done / el)).toFixed(0)}s`);
          }
        }
        sinks.delete(sink);
        stdin.end();
      },
    });
    await browser.close();
  }));
  server.close();
  const list = join(TMP, 'segments.txt');
  await writeFile(list, segs.filter(Boolean).map(f => `file '${f.replace(/\\/g, '/')}'`).join('\n'));
  await run('ffmpeg', ['-y', '-v', 'error', '-f', 'concat', '-safe', '0', '-i', list, '-c', 'copy', join(OUT, 'opus55_video.mp4')]);
  console.log(`video done in ${((Date.now() - started) / 1000).toFixed(0)}s -> out/opus55_video.mp4`);
}

async function mux() {
  const vid = join(OUT, 'opus55_video.mp4');
  for (const [wav, mp4] of MIXES) {
    const src = join(ROOT, 'audio', 'build', wav);
    try { await access(src); } catch { console.log(`skip ${mp4}: missing audio/build/${wav}`); continue; }
    await mkdir(dirname(join(OUT, mp4)), { recursive: true });
    await run('ffmpeg', ['-y', '-v', 'error', '-i', vid, '-i', src, '-map', '0:v', '-map', '1:a',
      '-c:v', 'copy', '-c:a', 'aac', '-b:a', '256k', '-ar', '48000', '-shortest', '-movflags', '+faststart', join(OUT, mp4)]);
    console.log(`out/${mp4}`);
  }
}

// ---------- the web version ----------
const SITE = join(ROOT, 'docs');
const HOME = 'https://juyi404.github.io/opus55-promo/';
const POSTER = 58; // s: the end card, the picture that link previews show

// A CSS unicode-range as [first, last] code point pairs.
const ranges = css => css.split(',').map(r => {
  const u = r.trim().replace(/^U\+/i, '');
  if (u.includes('?')) return [parseInt(u.replaceAll('?', '0'), 16), parseInt(u.replaceAll('?', 'F'), 16)];
  const [a, b = a] = u.split('-');
  return [parseInt(a, 16), parseInt(b, 16)];
});
const esc = s => s.replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]);
// s with its one a replaced by b; more or fewer than one is an error, so a changed page can't slip through
const swap = (s, a, b) => {
  const parts = s.split(a);
  if (parts.length !== 2) throw new Error(`expected one ${JSON.stringify(a)}, found ${parts.length - 1}`);
  return parts.join(b);
};
async function du(p) {
  const s = await stat(p);
  if (!s.isDirectory()) return s.size;
  let n = 0;
  for (const e of await readdir(p)) n += await du(join(p, e));
  return n;
}
// A hash of each frame as the page draws it, at full precision, to tell whether two pages draw alike.
const hashes = (page, times) => page.evaluate(times => times.map(t => {
  window.__render(t);
  const c = document.getElementById('c');
  const u = new Uint32Array(c.getContext('2d').getImageData(0, 0, c.width, c.height, { pixelFormat: 'rgba-float16' }).data.buffer);
  let h = 0x811c9dc5;
  for (let i = 0; i < u.length; i++) h = Math.imul(h ^ u[i], 16777619);
  return h >>> 0;
}), times);

// docs/: src/ as it runs on its own. Of the fonts, only the unicode-range slices that hold a glyph the
// film draws, listed on the page so that they all load at once; the mixes as AAC; and a poster. It
// then opens docs/ and checks that it draws the film exactly as src/ does.
async function site() {
  const started = Date.now();
  const html = await readFile(join(ROOT, 'src', 'index.html'), 'utf8');
  const sheets = [...html.matchAll(/^<link rel="stylesheet" href="(\.\.\/node_modules\/[^"]+)">\n/gm)];
  const voices = [...html.matchAll(/<option value="([^"]+)">/g)].map(m => m[1]);
  const title = /<title>([^<]+)<\/title>/.exec(html)[1];
  const desc = /<meta name="description" content="([^"]+)">/.exec(html)[1];
  const cover = /<h1[^>]*>([^<]+)<\/h1>/.exec(html)[1] + /<p class="motto">([^<]+)<\/p>/.exec(html)[1];
  const modules = [...(await readFile(join(ROOT, 'src', 'film.js'), 'utf8')).matchAll(/^import .* from '\.\/([^']+)';$/gm)].map(m => m[1]);
  if (!sheets.length || !voices.length || !modules.length) throw new Error('src/index.html or src/film.js is not as expected');

  // every glyph the film draws, from every frame; S2's code rain draws ASCII of its own
  const server = await serve(0);
  const port = server.address().port;
  const src = await openPage(port);
  const { fps, dur } = await src.page.evaluate(() => ({ fps: window.__fps, dur: window.__duration }));
  const n = Math.round(fps * dur);
  for (let a = 0; a <= n; a += 600) {
    await src.page.evaluate((a, b, fps) => { for (let i = a; i < b; i++) window.__render(i / fps); }, a, Math.min(n + 1, a + 600), fps);
  }
  const ascii = Array.from({ length: 95 }, (_, i) => String.fromCharCode(32 + i)).join('');
  const glyphs = [...new Set(await src.page.evaluate(() => window.__glyphs()) + ascii + cover)]
    .sort((a, b) => a.codePointAt(0) - b.codePointAt(0)).join('');
  const times = Array.from({ length: 2 * dur + 1 }, (_, i) => i / 2);
  const want = await hashes(src.page, times);
  await mkdir(TMP, { recursive: true });
  const png = join(TMP, 'poster.png');
  await writeFile(png, await grab(src.page, POSTER));
  await src.browser.close();
  console.log(`${[...glyphs].length} glyphs, from ${n + 1} frames`);

  await rm(SITE, { recursive: true, force: true });
  await mkdir(join(SITE, 'fonts'), { recursive: true });
  await mkdir(join(SITE, 'audio'));

  // the faces that hold any of those glyphs, or of the digits the preload adds
  const need = [...glyphs + '0123456789'].map(c => c.codePointAt(0));
  const faces = [], files = [];
  let total = 0;
  for (const [, href] of sheets) {
    const css = join(ROOT, 'src', href);
    for (const f of (await readFile(css, 'utf8')).match(/(?:\/\*[^*]*\*\/\s*)?@font-face\s*\{[^}]*\}/g)) {
      total++;
      const u = /unicode-range:\s*([^;]+);/.exec(f);
      if (u && !ranges(u[1]).some(([a, b]) => need.some(c => c >= a && c <= b))) continue;
      for (const [, file] of f.matchAll(/url\(\.\/files\/([^)]+)\)/g)) {
        await copyFile(join(dirname(css), 'files', file), join(SITE, 'fonts', file));
        files.push(file);
      }
      faces.push(f.replaceAll('url(./files/', 'url(./'));
    }
  }
  await writeFile(join(SITE, 'fonts', 'fonts.css'), faces.join('\n\n') + '\n');
  console.log(`fonts: ${faces.length} of ${total} faces, ${(await du(join(SITE, 'fonts')) / 1024).toFixed(0)} KB`);

  for (const v of voices) {
    await run('ffmpeg', ['-y', '-v', 'error', '-i', join(ROOT, 'audio', 'build', `mix_${v}.wav`),
      '-c:a', 'aac', '-b:a', '192k', '-ar', '48000', '-movflags', '+faststart', join(SITE, 'audio', `mix_${v}.m4a`)]);
  }
  await run('ffmpeg', ['-y', '-v', 'error', '-i', png, '-vf', 'scale=1280:720:flags=lanczos', '-pix_fmt', 'yuvj444p', '-q:v', '3',
    join(SITE, 'poster.jpg')]);
  for (const e of await readdir(join(ROOT, 'src'))) if (e !== 'index.html') await cp(join(ROOT, 'src', e), join(SITE, e), { recursive: true });

  const og = [
    `<link rel="canonical" href="${HOME}">`,
    '<meta property="og:type" content="website">',
    `<meta property="og:url" content="${HOME}">`,
    `<meta property="og:title" content="${title}">`,
    `<meta property="og:description" content="${desc}">`,
    `<meta property="og:image" content="${HOME}poster.jpg">`,
    '<meta property="og:image:width" content="1280">',
    '<meta property="og:image:height" content="720">',
    '<meta name="twitter:card" content="summary_large_image">',
  ];
  // what the film waits for before it can start, fetched from the outset rather than as each is found
  const early = [
    '<link rel="stylesheet" href="fonts/fonts.css">',
    ...files.map(f => `<link rel="preload" href="fonts/${f}" as="font" type="font/woff2" crossorigin>`),
    ...modules.map(m => `<link rel="modulepreload" href="${m}">`),
    '<link rel="preload" href="cues.json" as="fetch" crossorigin>',
  ];
  let out = swap(html, '</title>\n', `</title>\n${og.join('\n')}\n`);
  out = swap(out, sheets[0][0], early.join('\n') + '\n');
  for (const [line] of sheets.slice(1)) out = swap(out, line, '');
  out = swap(out, 'data-src="../audio/build/mix_{voice}.wav"', 'data-src="audio/mix_{voice}.m4a"');
  out = swap(out, '<html lang="zh-CN">', `<html lang="zh-CN" data-glyphs="${esc(glyphs)}">`);
  await writeFile(join(SITE, 'index.html'), out);
  await writeFile(join(SITE, '.nojekyll'), ''); // served as is, without Jekyll

  const docs = await openPage(port, 'docs/index.html');
  const got = await hashes(docs.page, times);
  await docs.browser.close();
  server.close();
  const off = times.filter((_, i) => got[i] !== want[i]);
  if (off.length) throw new Error(`docs/ draws the film differently at ${off.join(', ')} s`);
  const kb = async p => `${(await du(join(SITE, p)) / 1024).toFixed(0)} KB`;
  console.log(`docs/ ${await kb('.')}: fonts ${await kb('fonts')}, audio ${await kb('audio')}, poster ${await kb('poster.jpg')}; ` +
    `draws the film as src/ does (${times.length} frames); ${((Date.now() - started) / 1000).toFixed(0)} s`);
}

const [mode = 'video', ...rest] = process.argv.slice(2);
if (mode === 'stills') await stills(rest);
else if (mode === 'video') { await video(Number(rest[0]) || 10); await mux(); }
else if (mode === 'mux') await mux();
else if (mode === 'site') await site();
else if (mode === 'clean') await rm(TMP, { recursive: true, force: true });
else console.error('usage: render.mjs stills <t...> | video [workers] | mux | site | clean');
