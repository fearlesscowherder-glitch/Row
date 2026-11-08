// Shared helpers for the serverless functions in /api.
// Files starting with "_" are not exposed as routes by Vercel.
import crypto from 'node:crypto';
import fs from 'node:fs/promises';
import path from 'node:path';

// Every row this app writes lives under this prefix in the `row_state`
// table. Rows starting with "_" are server-only (tokens, bookkeeping)
// and can never be read or written through /api/state.
export const PREFIX = 'row:';
export const PRIVATE_PREFIX = '_row:';

export function send(res, status, body) {
  res.statusCode = status;
  res.setHeader('Content-Type', 'application/json');
  res.setHeader('Cache-Control', 'no-store');
  res.end(JSON.stringify(body));
}

function safeEqual(a, b) {
  const ab = Buffer.from(String(a));
  const bb = Buffer.from(String(b));
  return ab.length === bb.length && crypto.timingSafeEqual(ab, bb);
}

// The site is public, so every endpoint that touches personal data
// requires the APP_PASSWORD (sent by the pages as a header).
export function requireAuth(req, res) {
  const pw = process.env.APP_PASSWORD;
  if (!pw) {
    send(res, 500, { error: 'APP_PASSWORD is not set (add it to .env, or to Vercel settings if deployed).' });
    return false;
  }
  if (!safeEqual(req.headers['x-app-password'] || '', pw)) {
    send(res, 401, { error: 'Wrong or missing app password.' });
    return false;
  }
  return true;
}

export function isCron(req) {
  const secret = process.env.CRON_SECRET;
  return !!secret && safeEqual(req.headers.authorization || '', 'Bearer ' + secret);
}

export function hmac(text) {
  return crypto.createHmac('sha256', process.env.APP_PASSWORD || 'unset').update(text).digest('hex');
}

// ---------- Storage ----------
// Supabase when SUPABASE_URL / SUPABASE_SERVICE_KEY are set. Otherwise, when
// running on your own computer (server.mjs sets LOCAL_DATA_DIR), one JSON
// file per key in that folder.
function localDir() {
  return process.env.SUPABASE_URL ? null : process.env.LOCAL_DATA_DIR || null;
}
const fileFor = (dir, k) => path.join(dir, encodeURIComponent(k) + '.json');
async function readLocal(dir, k) {
  try { return JSON.parse(await fs.readFile(fileFor(dir, k), 'utf8')); }
  catch (e) { if (e.code === 'ENOENT') return null; throw e; }
}

// ---------- Supabase (service role, server-side only) ----------
function supa() {
  const url = process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_KEY;
  if (!url || !key) throw new Error('SUPABASE_URL / SUPABASE_SERVICE_KEY are not set.');
  return { url: url.replace(/\/$/, ''), key };
}

function headers(key, extra) {
  const h = { apikey: key, 'Content-Type': 'application/json' };
  // Legacy service_role keys are JWTs and also go in Authorization.
  // New-style secret keys (sb_secret_...) go only in the apikey header.
  if (key.startsWith('eyJ')) h.Authorization = 'Bearer ' + key;
  return Object.assign(h, extra || {});
}

export function hasDb() {
  return !!((process.env.SUPABASE_URL && process.env.SUPABASE_SERVICE_KEY) || localDir());
}

// Returns { [fullKey]: { data, updated_at } }
export async function getRows(fullKeys) {
  if (!fullKeys.length) return {};
  const dir = localDir();
  if (dir) {
    const out = {};
    for (const k of fullKeys) { const row = await readLocal(dir, k); if (row) out[k] = row; }
    return out;
  }
  const { url, key } = supa();
  const list = fullKeys.map(k => '"' + k.replace(/"/g, '') + '"').join(',');
  const r = await fetch(
    url + '/rest/v1/row_state?select=key,data,updated_at&key=in.(' + encodeURIComponent(list) + ')',
    { headers: headers(key) }
  );
  if (!r.ok) throw new Error('Supabase read failed: ' + r.status + ' ' + (await r.text()));
  const out = {};
  for (const row of await r.json()) out[row.key] = { data: row.data, updated_at: row.updated_at };
  return out;
}

export async function getRow(fullKey) {
  const rows = await getRows([fullKey]);
  return rows[fullKey] ? rows[fullKey].data : null;
}

// Returns keys (and updated_at) that start with a prefix, without data.
export async function listKeys(fullPrefix) {
  const dir = localDir();
  if (dir) {
    let names = [];
    try { names = await fs.readdir(dir); } catch (e) { if (e.code !== 'ENOENT') throw e; }
    const out = [];
    for (const n of names) {
      if (!n.endsWith('.json')) continue;
      const k = decodeURIComponent(n.slice(0, -5));
      if (!k.startsWith(fullPrefix)) continue;
      const row = await readLocal(dir, k);
      if (row) out.push({ key: k, updated_at: row.updated_at });
    }
    return out;
  }
  const { url, key } = supa();
  const r = await fetch(
    url + '/rest/v1/row_state?select=key,updated_at&key=like.' + encodeURIComponent(fullPrefix + '*'),
    { headers: headers(key) }
  );
  if (!r.ok) throw new Error('Supabase list failed: ' + r.status);
  return r.json();
}

export async function setRow(fullKey, data) {
  const updated_at = new Date().toISOString();
  const dir = localDir();
  if (dir) {
    await fs.mkdir(dir, { recursive: true });
    const file = fileFor(dir, fullKey);
    const tmp = file + '.' + process.pid + '.' + Math.random().toString(36).slice(2) + '.tmp';
    await fs.writeFile(tmp, JSON.stringify({ data, updated_at }));
    await fs.rename(tmp, file);
    return updated_at;
  }
  const { url, key } = supa();
  const r = await fetch(url + '/rest/v1/row_state?on_conflict=key', {
    method: 'POST',
    headers: headers(key, { Prefer: 'resolution=merge-duplicates,return=minimal' }),
    body: JSON.stringify({ key: fullKey, data, updated_at }),
  });
  if (!r.ok) throw new Error('Supabase write failed: ' + r.status + ' ' + (await r.text()));
  return updated_at;
}

export async function deleteRow(fullKey) {
  const dir = localDir();
  if (dir) {
    try { await fs.unlink(fileFor(dir, fullKey)); } catch (e) { if (e.code !== 'ENOENT') throw e; }
    return;
  }
  const { url, key } = supa();
  const r = await fetch(url + '/rest/v1/row_state?key=eq.' + encodeURIComponent(fullKey), {
    method: 'DELETE',
    headers: headers(key),
  });
  if (!r.ok) throw new Error('Supabase delete failed: ' + r.status);
}

// Read a JSON request body whether or not the platform already parsed it.
export async function readBody(req) {
  if (req.body && typeof req.body === 'object') return req.body;
  if (typeof req.body === 'string') { try { return JSON.parse(req.body); } catch { return {}; } }
  const chunks = [];
  for await (const c of req) chunks.push(c);
  try { return JSON.parse(Buffer.concat(chunks).toString('utf8') || '{}'); } catch { return {}; }
}
