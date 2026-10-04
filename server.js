import http from 'node:http';
import { readFile, stat } from 'node:fs/promises';
import { resolve, extname, sep, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = dirname(fileURLToPath(import.meta.url));
const port = Number(process.env.PORT || 4173);
const host = process.env.HOST || '127.0.0.1';
const mime = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.svg': 'image/svg+xml', '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.json': 'application/json', '.webmanifest': 'application/manifest+json', '.md': 'text/plain' };
http.createServer(async (req, res) => {
  try {
    const pathname = decodeURIComponent(new URL(req.url, 'http://local').pathname);
    if (pathname.split('/').some(part => part.startsWith('.') || part === 'tests') || pathname.includes('node_modules')) {
      res.writeHead(403).end('Accès refusé'); return;
    }
    const path = resolve(root, '.' + (pathname === '/' ? '/index.html' : pathname));
    if (!path.startsWith(root + sep) || !(await stat(path)).isFile()) { res.writeHead(404).end('Introuvable'); return; }
    const body = await readFile(path);
    const type = mime[extname(path)] || 'application/octet-stream';
    res.writeHead(200, { 'Content-Type': type + (type.startsWith('text/') || type.endsWith('+xml') ? '; charset=utf-8' : ''), 'Cache-Control': 'no-cache', 'X-Content-Type-Options': 'nosniff' }).end(body);
  } catch { res.writeHead(404).end('Introuvable'); }
}).listen(port, host, () => console.log(`Blue Night — serveur prêt, port ${port}`));
