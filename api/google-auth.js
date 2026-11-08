// Gmail connection (OAuth 2.0, read-only scope).
//   POST /api/google-auth            (needs app password) -> { url } to send the browser to
//   GET  /api/google-auth?code=...   Google redirects here; stores the refresh token
//   DELETE /api/google-auth          (needs app password) disconnect
import { send, requireAuth, hmac, setRow, deleteRow, PRIVATE_PREFIX } from './_lib.js';

const SCOPE = 'https://www.googleapis.com/auth/gmail.readonly';

function redirectUri(req) {
  if (process.env.PUBLIC_URL) return process.env.PUBLIC_URL.replace(/\/$/, '') + '/api/google-auth';
  const proto = req.headers['x-forwarded-proto'] || 'https';
  return proto + '://' + req.headers.host + '/api/google-auth';
}

function page(res, status, title, message, ok) {
  res.statusCode = status;
  res.setHeader('Content-Type', 'text/html; charset=utf-8');
  res.end(`<!doctype html><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>${title}</title>
<body style="background:#050506;color:#FAFAFA;font-family:-apple-system,Segoe UI,Roboto,sans-serif;display:grid;place-items:center;min-height:100vh;margin:0;padding:16px">
<div style="max-width:420px;text-align:center">
<h1 style="font-size:22px">${title}</h1><p style="color:#B8B6B0;line-height:1.5">${message}</p>
<a href="/calendar.html${ok ? '?gmail=connected' : ''}" style="color:#E07658">Back to calendar →</a></div></body>`);
}

export default async function handler(req, res) {
  const url = new URL(req.url, 'http://x');

  if (req.method === 'POST') {
    if (!requireAuth(req, res)) return;
    if (!process.env.GOOGLE_CLIENT_ID || !process.env.GOOGLE_CLIENT_SECRET) {
      return send(res, 500, { error: 'GOOGLE_CLIENT_ID / GOOGLE_CLIENT_SECRET are not set in Vercel.' });
    }
    const ts = String(Date.now());
    const state = ts + '.' + hmac('gmail-oauth:' + ts);
    const auth = new URL('https://accounts.google.com/o/oauth2/v2/auth');
    auth.search = new URLSearchParams({
      client_id: process.env.GOOGLE_CLIENT_ID,
      redirect_uri: redirectUri(req),
      response_type: 'code',
      scope: SCOPE,
      access_type: 'offline',
      prompt: 'consent',
      include_granted_scopes: 'true',
      state,
    }).toString();
    return send(res, 200, { url: auth.toString() });
  }

  if (req.method === 'DELETE') {
    if (!requireAuth(req, res)) return;
    await deleteRow(PRIVATE_PREFIX + 'google_token');
    return send(res, 200, { ok: true });
  }

  if (req.method !== 'GET') return send(res, 405, { error: 'method not allowed' });

  // ---- OAuth callback ----
  if (url.searchParams.get('error')) {
    return page(res, 400, 'Gmail not connected', 'Google said: ' + url.searchParams.get('error'), false);
  }
  const code = url.searchParams.get('code');
  const [ts, sig] = (url.searchParams.get('state') || '').split('.');
  if (!code || !ts || sig !== hmac('gmail-oauth:' + ts) || Date.now() - Number(ts) > 15 * 60 * 1000) {
    return page(res, 400, 'Link expired', 'Start the connection again from the Calendar page.', false);
  }

  const r = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      code,
      client_id: process.env.GOOGLE_CLIENT_ID || '',
      client_secret: process.env.GOOGLE_CLIENT_SECRET || '',
      redirect_uri: redirectUri(req),
      grant_type: 'authorization_code',
    }),
  });
  const j = await r.json();
  if (!r.ok || !j.refresh_token) {
    return page(res, 400, 'Gmail not connected',
      'Google did not return a refresh token (' + (j.error_description || j.error || 'missing token') +
      '). Remove this app at myaccount.google.com/permissions and try again.', false);
  }
  await setRow(PRIVATE_PREFIX + 'google_token', { refresh_token: j.refresh_token, connectedAt: new Date().toISOString() });
  page(res, 200, 'Gmail connected ✓', 'New emails will be scanned for events and added to your calendar.', true);
}
