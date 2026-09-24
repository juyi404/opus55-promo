// Tiny static file server rooted at the project directory (used for preview and rendering).
// While rendering it also takes frames: POST <path> writes the body into sinks.get(path), the
// stdin of that worker's ffmpeg, and answers 204 once the sink has taken it.
import http from 'node:http';
import { once } from 'node:events';
import { readFile, stat } from 'node:fs/promises';
import { extname, join, normalize, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(fileURLToPath(import.meta.url), '../..');
const TYPES = {
  '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8', '.json': 'application/json; charset=utf-8', '.woff2': 'font/woff2',
  '.wav': 'audio/wav', '.mp3': 'audio/mpeg', '.m4a': 'audio/mp4', '.png': 'image/png', '.jpg': 'image/jpeg', '.svg': 'image/svg+xml',
};

export const sinks = new Map();

export function serve(port = 0) {
  const server = http.createServer(async (req, res) => {
    try {
      const url = new URL(req.url, 'http://x');
      if (url.pathname === '/') { // the bare origin (what the preview pane opens) goes to the film
        res.writeHead(302, { location: '/src/' });
        res.end();
        return;
      }
      if (req.method === 'POST') {
        const sink = sinks.get(url.pathname);
        if (!sink) throw new Error('no sink');
        const frame = Buffer.concat(await Array.fromAsync(req)); // one write per frame, not per chunk
        if (!sink.write(frame)) await once(sink, 'drain');
        res.writeHead(204);
        res.end();
        return;
      }
      let p = normalize(join(ROOT, decodeURIComponent(url.pathname)));
      if (!p.startsWith(ROOT)) throw new Error('outside root');
      if ((await stat(p)).isDirectory()) p = join(p, 'index.html');
      const body = await readFile(p);
      const head = { 'content-type': TYPES[extname(p)] || 'application/octet-stream', 'cache-control': 'no-store', 'accept-ranges': 'bytes' };
      // byte ranges, so that the preview's <audio> knows its duration and can seek
      const range = /^bytes=(\d*)-(\d*)$/.exec(req.headers.range || '');
      if (range && (range[1] || range[2])) {
        const n = body.length;
        const a = range[1] ? Number(range[1]) : Math.max(0, n - Number(range[2]));
        const b = range[1] && range[2] ? Math.min(n - 1, Number(range[2])) : n - 1;
        if (a > b) {
          res.writeHead(416, { 'content-range': `bytes */${n}` });
          res.end();
          return;
        }
        res.writeHead(206, { ...head, 'content-range': `bytes ${a}-${b}/${n}`, 'content-length': b - a + 1 });
        res.end(body.subarray(a, b + 1));
        return;
      }
      res.writeHead(200, { ...head, 'content-length': body.length });
      res.end(body);
    } catch {
      res.writeHead(404); res.end('not found');
    }
  });
  return new Promise(r => server.listen(port, '127.0.0.1', () => r(server)));
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const port = Number(process.argv[2] || 5173);
  serve(port).then(() => console.log(`serving ${ROOT} on http://127.0.0.1:${port}/src/`));
}
