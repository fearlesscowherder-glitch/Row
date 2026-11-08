// Run the whole app on this computer: `npm start`, then open http://localhost:3210
//
// Serves the pages, runs the /api functions (same code Vercel runs) and,
// instead of Vercel's once-a-day cron, refreshes Schoology and scans Gmail
// every 15 minutes while it's running. Settings come from a `.env` file
// next to this one (see SETUP.md → "Run it on your computer").
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { fileURLToPath, pathToFileURL } from 'node:url';

const ROOT = path.dirname(fileURLToPath(import.meta.url));
const envFile = path.join(ROOT, '.env');
if (fs.existsSync(envFile)) process.loadEnvFile(envFile);

// Without Supabase, keep data in ./data on this computer.
if (!process.env.SUPABASE_URL && !process.env.LOCAL_DATA_DIR) process.env.LOCAL_DATA_DIR = path.join(ROOT, 'data');
// No serverless time limit here, so allow slow local models more time.
if (!process.env.AI_TIMEOUT_MS) process.env.AI_TIMEOUT_MS = '180000';
const PORT = Number(process.env.PORT || 3210);
const HOST = process.env.HOST || '127.0.0.1';
const SYNC_MINUTES = Number(process.env.SYNC_MINUTES || 15);

// Load every /api/*.js route (files starting with "_" are helpers).
const handlers = {};
for (const f of fs.readdirSync(path.join(ROOT, 'api'))) {
  if (f.startsWith('_') || !f.endsWith('.js')) continue;
  handlers['/api/' + f.slice(0, -3)] = (await import(pathToFileURL(path.join(ROOT, 'api', f)).href)).default;
}

const TYPES = {
  '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8', '.json': 'application/json', '.png': 'image/png', '.jpg': 'image/jpeg',
  '.svg': 'image/svg+xml', '.ico': 'image/x-icon', '.webmanifest': 'application/manifest+json',
};
// Never serve secrets or server code as static files.
const BLOCKED = /^\/(\..*|node_modules|data|logs|tools|api|server\.mjs|package(-lock)?\.json|supabase\.sql|[^/]*\.md)(\/|$)/i;

const server = http.createServer(async (req, res) => {
  const u = new URL(req.url, 'http://localhost');
  try {
    const handler = handlers[u.pathname.replace(/\/$/, '')];
    if (handler) {
      req.query = Object.fromEntries(u.searchParams);
      // Local server is plain http (used by the Google sign-in redirect).
      if (!req.headers['x-forwarded-proto']) req.headers['x-forwarded-proto'] = 'http';
      return await handler(req, res);
    }
    if (u.pathname.startsWith('/api/')) {
      res.writeHead(404, { 'Content-Type': 'application/json' });
      return res.end('{"error":"no such api"}');
    }
    let p = decodeURIComponent(u.pathname);
    if (p === '/') p = '/index.html';
    const file = path.resolve(ROOT, '.' + p);
    if (BLOCKED.test(p) || !file.startsWith(ROOT + path.sep) || !fs.existsSync(file) || fs.statSync(file).isDirectory()) {
      res.writeHead(404, { 'Content-Type': 'text/plain' });
      return res.end('Not found');
    }
    res.writeHead(200, { 'Content-Type': TYPES[path.extname(file).toLowerCase()] || 'application/octet-stream', 'Cache-Control': 'no-cache' });
    fs.createReadStream(file).pipe(res);
  } catch (e) {
    console.error(req.method, u.pathname, e);
    if (!res.headersSent) { res.writeHead(500, { 'Content-Type': 'application/json' }); }
    res.end(JSON.stringify({ error: String(e.message || e) }));
  }
});

// Background refresh (what Vercel's cron does, but more often).
async function backgroundSync() {
  const { hasDb } = await import('./api/_lib.js');
  if (!hasDb()) return;
  const parts = [];
  if (process.env.SCHOOLOGY_ICAL_URL) {
    try {
      const { fetchSchoology } = await import('./api/schoology.js');
      const body = await fetchSchoology();
      parts.push('schoology ' + body.assignments.length);
    } catch (e) { parts.push('schoology error: ' + e.message); }
  }
  try {
    const { runGmailSync } = await import('./api/_gmail.js');
    const r = await runGmailSync({ force: true });
    parts.push('gmail ' + JSON.stringify(r));
  } catch (e) { parts.push('gmail error: ' + e.message); }
  console.log(new Date().toLocaleTimeString(), 'sync:', parts.join(' | '));
}

// Schoology exports land in Downloads; import the newest one whenever it changes.
const DOWNLOADS = process.env.DOWNLOADS_DIR || path.join(os.homedir(), 'Downloads');
let lastImported = 0, importing = false, importTimer = null;
async function importFromDownloads() {
  if (importing) return;
  importing = true;
  try {
    const { getRow, setRow, hasDb, PRIVATE_PREFIX } = await import('./api/_lib.js');
    if (!hasDb()) return;
    if (!lastImported) lastImported = ((await getRow(PRIVATE_PREFIX + 'school_import')) || {}).mtime || 0;
    const files = fs.readdirSync(DOWNLOADS).filter(f => /.ics$/i.test(f))
      .map(f => ({ f, t: fs.statSync(path.join(DOWNLOADS, f)).mtimeMs }))
      .filter(x => x.t > lastImported).sort((a, b) => b.t - a.t);
    for (const { f, t } of files) {
      const text = fs.readFileSync(path.join(DOWNLOADS, f), 'utf8');
      const { isSchoologyIcs, importIcs } = await import('./api/schoology.js');
      if (!isSchoologyIcs(text)) continue;
      console.log(new Date().toLocaleTimeString(), 'importing Schoology export', f, '(sorting new items into classes can take a minute)…');
      const body = await importIcs(text, 'download');
      lastImported = t;
      await setRow(PRIVATE_PREFIX + 'school_import', { mtime: t, file: f });
      console.log(new Date().toLocaleTimeString(), 'imported', body.assignments.length, 'Schoology items' + (body.warning ? ' — ' + body.warning : ''));
      break; // newest Schoology file wins
    }
  } catch (e) {
    console.error('Schoology import failed:', e.message);
  } finally { importing = false; }
}
function watchDownloads() {
  if (!fs.existsSync(DOWNLOADS)) return;
  importFromDownloads();
  try {
    fs.watch(DOWNLOADS, (ev, name) => {
      if (name && !/.ics$/i.test(name)) return;
      clearTimeout(importTimer);
      importTimer = setTimeout(importFromDownloads, 2000);
    });
  } catch (e) { console.error('Cannot watch Downloads:', e.message); }
  // fs.watch can miss events on some drives; check again every few minutes.
  setInterval(importFromDownloads, 3 * 60000);
}

server.on('error', e => {
  if (e.code === 'EADDRINUSE') console.error('Port ' + PORT + ' is already used by another program. Add PORT=3211 (or any free number) to .env and run npm start again.');
  else console.error(e);
  process.exit(1);
});

server.listen(PORT, HOST, async () => {
  const { aiProvider } = await import('./api/_ai.js');
  const ai = aiProvider();
  console.log(`Row is running at http://localhost:${PORT}`);
  console.log('Data: ' + (process.env.SUPABASE_URL ? 'Supabase' : process.env.LOCAL_DATA_DIR));
  console.log('AI: ' + (ai === 'gateway' ? `gateway ${process.env.AI_BASE_URL} (model ${process.env.AI_MODEL || 'auto'})` : ai === 'claude' ? 'Claude API' : 'not configured'));
  if (!fs.existsSync(envFile)) console.log('No .env file found. Copy .env.example to .env and fill it in.');
  console.log('Watching for Schoology exports in ' + DOWNLOADS);
  watchDownloads();
  if (SYNC_MINUTES > 0) {
    setTimeout(backgroundSync, 5000);
    setInterval(backgroundSync, SYNC_MINUTES * 60000);
  }
});
