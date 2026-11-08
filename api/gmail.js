// GET  /api/gmail        -> connection + last-sync status
// POST /api/gmail        -> scan new emails now (throttled to every 4 min; ?force=1 skips that)
import { send, requireAuth, hasDb, setRow, PRIVATE_PREFIX } from './_lib.js';
import { gmailStatus, runGmailSync } from './_gmail.js';

export default async function handler(req, res) {
  if (!requireAuth(req, res)) return;
  if (!hasDb()) return send(res, 503, { error: 'Sync database is not configured.' });
  try {
    if (req.method === 'GET') return send(res, 200, await gmailStatus());
    if (req.method === 'POST') {
      const force = new URL(req.url, 'http://x').searchParams.get('force') === '1';
      return send(res, 200, await runGmailSync({ force }));
    }
    send(res, 405, { error: 'method not allowed' });
  } catch (e) {
    const msg = String(e.message || e);
    try { await setRow(PRIVATE_PREFIX + 'gmail_status', { lastRun: new Date().toISOString(), lastError: msg }); } catch {}
    send(res, 500, { error: msg });
  }
}
