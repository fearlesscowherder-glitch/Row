// Password-protected key/value store backed by Supabase.
//   GET    /api/state?keys=lists,cal_events   -> { rows: { lists: {data, updated_at} } }
//   GET    /api/state?prefix=mind_img:         -> { keys: [{ key, updated_at }] }
//   POST   /api/state  { key, data }           -> { updated_at }
//   DELETE /api/state?key=lists
import { send, requireAuth, readBody, getRows, setRow, deleteRow, listKeys, hasDb, PREFIX } from './_lib.js';

const VALID = /^[a-z0-9][a-z0-9_:\-.]{0,120}$/i;

export default async function handler(req, res) {
  if (!requireAuth(req, res)) return;
  if (!hasDb()) return send(res, 503, { error: 'Sync database is not configured.' });

  try {
    if (req.method === 'GET') {
      const url = new URL(req.url, 'http://x');
      const prefix = url.searchParams.get('prefix');
      if (prefix != null) {
        if (!VALID.test(prefix)) return send(res, 400, { error: 'bad prefix' });
        const rows = await listKeys(PREFIX + prefix);
        return send(res, 200, { keys: rows.map(r => ({ key: r.key.slice(PREFIX.length), updated_at: r.updated_at })) });
      }
      const keys = (url.searchParams.get('keys') || '').split(',').map(s => s.trim()).filter(Boolean);
      if (!keys.length || keys.length > 100 || !keys.every(k => VALID.test(k))) {
        return send(res, 400, { error: 'bad keys' });
      }
      const rows = await getRows(keys.map(k => PREFIX + k));
      const out = {};
      for (const k of keys) if (rows[PREFIX + k]) out[k] = rows[PREFIX + k];
      return send(res, 200, { rows: out });
    }

    if (req.method === 'POST') {
      const body = await readBody(req);
      if (!body || !VALID.test(body.key || '') || body.data === undefined) {
        return send(res, 400, { error: 'need { key, data }' });
      }
      const updated_at = await setRow(PREFIX + body.key, body.data);
      return send(res, 200, { updated_at });
    }

    if (req.method === 'DELETE') {
      const key = new URL(req.url, 'http://x').searchParams.get('key') || '';
      if (!VALID.test(key)) return send(res, 400, { error: 'bad key' });
      await deleteRow(PREFIX + key);
      return send(res, 200, { ok: true });
    }

    send(res, 405, { error: 'method not allowed' });
  } catch (e) {
    send(res, 500, { error: String(e.message || e) });
  }
}
