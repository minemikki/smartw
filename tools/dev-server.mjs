// Local development server. Mounts the api/ handlers over plain http and serves
// the static files, so the whole app runs without the Vercel CLI.
//   SESSION_SECRET=$(openssl rand -base64 32) node tools/dev-server.mjs
//   → http://localhost:4340/?venue=brygge-og-bord   (guest)
//   → http://localhost:4340/admin.html              (menu admin)
//
// Magic-link emails are printed to this terminal when RESEND_API_KEY is unset.
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const PORT = Number(process.env.PORT || 4340);
const TYPES = {
  '.html': 'text/html; charset=utf-8', '.css': 'text/css', '.js': 'text/javascript',
  '.json': 'application/json', '.woff2': 'font/woff2', '.svg': 'image/svg+xml',
  '.png': 'image/png', '.jpg': 'image/jpeg', '.ico': 'image/x-icon',
};

const routes = {};
for (const name of ['waiter', 'login', 'session', 'menu']) {
  routes[`/api/${name}`] = (await import(path.join(ROOT, 'api', `${name}.js`))).default;
}

http.createServer(async (req, res) => {
  const u = new URL(req.url, 'http://localhost');
  const handler = routes[u.pathname];

  if (handler) {
    let raw = '';
    for await (const chunk of req) raw += chunk;
    const headers = {};
    // The minimum of Vercel's res object that the handlers actually use.
    const shim = {
      code: 200,
      setHeader(k, v) { headers[k] = v; return this; },
      status(c) { this.code = c; return this; },
      json(body) {
        res.writeHead(this.code, { ...headers, 'content-type': 'application/json; charset=utf-8' });
        res.end(JSON.stringify(body));
        return this;
      },
      end(body) { res.writeHead(this.code, headers); res.end(body || ''); return this; },
    };
    try {
      await handler({
        method: req.method, headers: req.headers,
        query: Object.fromEntries(u.searchParams),
        body: raw ? JSON.parse(raw) : {},
      }, shim);
    } catch (e) {
      console.error(`[${u.pathname}]`, e);
      if (!res.headersSent) {
        res.writeHead(500, { 'content-type': 'application/json' });
        res.end(JSON.stringify({ error: e.message }));
      }
    }
    return;
  }

  const rel = u.pathname === '/' ? 'index.html' : u.pathname.replace(/^\/+/, '');
  const file = path.join(ROOT, rel);
  // Keep path traversal out even in dev.
  if (!file.startsWith(ROOT) || !fs.existsSync(file) || fs.statSync(file).isDirectory()) {
    res.writeHead(404, { 'content-type': 'text/plain' });
    return res.end('Ikke funnet');
  }
  res.writeHead(200, { 'content-type': TYPES[path.extname(file)] || 'application/octet-stream' });
  fs.createReadStream(file).pipe(res);
}).listen(PORT, () => {
  console.log(`Gjest : http://localhost:${PORT}/?venue=brygge-og-bord`);
  console.log(`Admin : http://localhost:${PORT}/admin.html`);
  if (!process.env.SESSION_SECRET) console.log('OBS: SESSION_SECRET mangler — admin vil feile.');
  if (!process.env.ANTHROPIC_API_KEY) console.log('OBS: ANTHROPIC_API_KEY mangler — kelneren kjører i degradert modus.');
});
