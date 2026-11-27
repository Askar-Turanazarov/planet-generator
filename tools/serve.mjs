// Minimal zero-dependency static file server for local development.
// Usage: node tools/serve.mjs [port] [folder]
//   node tools/serve.mjs            the source tree on port 5173
//   node tools/serve.mjs 4173 dist  the built site, as a host would serve it
// It listens on every network interface, so a phone or tablet on the same
// Wi-Fi can open it by the computer's address (printed at start-up).
import { createServer } from 'node:http';
import { readFile, stat } from 'node:fs/promises';
import { networkInterfaces } from 'node:os';
import { extname, join, normalize, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

const PROJECT = resolve(fileURLToPath(new URL('..', import.meta.url)));
const PORT = Number(process.argv[2] || process.env.PORT || 5173);
const ROOT = resolve(PROJECT, process.argv[3] || '.');

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.webmanifest': 'application/manifest+json; charset=utf-8',
  '.md': 'text/markdown; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
};

createServer(async (req, res) => {
  try {
    const urlPath = decodeURIComponent(new URL(req.url, 'http://localhost').pathname);
    let filePath = normalize(join(ROOT, urlPath));
    // Never serve anything outside the project root.
    if (filePath !== ROOT && !filePath.startsWith(ROOT + sep)) {
      res.writeHead(403).end('Forbidden');
      return;
    }
    const info = await stat(filePath);
    if (info.isDirectory()) filePath = join(filePath, 'index.html');
    const body = await readFile(filePath);
    res.writeHead(200, {
      'Content-Type': MIME[extname(filePath).toLowerCase()] || 'application/octet-stream',
      'Cache-Control': 'no-store',
    });
    res.end(body);
  } catch {
    res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' }).end('Not found');
  }
}).listen(PORT, () => {
  console.log(`Planet Generator 3D → http://localhost:${PORT}`);
  for (const addresses of Object.values(networkInterfaces())) {
    for (const address of addresses ?? []) {
      if (address.family === 'IPv4' && !address.internal) {
        console.log(`  on this network     → http://${address.address}:${PORT}`);
      }
    }
  }
});
