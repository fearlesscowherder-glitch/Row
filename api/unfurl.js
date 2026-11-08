// GET /api/unfurl?url=https://...  -> { title, description, image, siteName, favicon, url }
// Reads a page's preview metadata for Mind link cards.
import { send, requireAuth } from './_lib.js';

const BLOCKED = /^(localhost|127\.|10\.|192\.168\.|169\.254\.|172\.(1[6-9]|2\d|3[01])\.|0\.|\[?::1\]?$|metadata\.)/i;

function meta(html, names) {
  for (const n of names) {
    const re1 = new RegExp('<meta[^>]+(?:property|name)=["\']' + n + '["\'][^>]*content=["\']([^"\']*)["\']', 'i');
    const re2 = new RegExp('<meta[^>]+content=["\']([^"\']*)["\'][^>]*(?:property|name)=["\']' + n + '["\']', 'i');
    const m = html.match(re1) || html.match(re2);
    if (m && m[1].trim()) return decode(m[1].trim());
  }
  return '';
}

function decode(s) {
  return s.replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"').replace(/&#39;|&#x27;/g, "'")
    .replace(/&#(\d+);/g, (_, n) => String.fromCharCode(Number(n)));
}

export default async function handler(req, res) {
  if (!requireAuth(req, res)) return;
  let target;
  try { target = new URL(new URL(req.url, 'http://x').searchParams.get('url') || ''); }
  catch { return send(res, 400, { error: 'bad url' }); }
  if (!/^https?:$/.test(target.protocol) || BLOCKED.test(target.hostname)) return send(res, 400, { error: 'url not allowed' });

  const fallback = { url: target.href, title: target.hostname.replace(/^www\./, ''), description: '', image: '', siteName: target.hostname.replace(/^www\./, ''), favicon: target.origin + '/favicon.ico' };
  try {
    const ctrl = new AbortController();
    const t = setTimeout(() => ctrl.abort(), 7000);
    const r = await fetch(target.href, {
      signal: ctrl.signal,
      redirect: 'follow',
      headers: { 'User-Agent': 'Mozilla/5.0 (compatible; RowDashboard/1.0; link preview)', Accept: 'text/html,*/*' },
    });
    clearTimeout(t);
    const type = r.headers.get('content-type') || '';
    if (type.startsWith('image/')) return send(res, 200, Object.assign(fallback, { image: target.href }));
    if (!type.includes('html')) return send(res, 200, fallback);
    const html = (await r.text()).slice(0, 600000);
    const base = new URL(r.url || target.href);
    const abs = u => { try { return u ? new URL(u, base).href : ''; } catch { return ''; } };
    const titleTag = (html.match(/<title[^>]*>([\s\S]*?)<\/title>/i) || [])[1] || '';
    const icon = (html.match(/<link[^>]+rel=["'][^"']*icon[^"']*["'][^>]*href=["']([^"']+)["']/i) || [])[1];
    send(res, 200, {
      url: base.href,
      title: meta(html, ['og:title', 'twitter:title']) || decode(titleTag.trim()) || fallback.title,
      description: meta(html, ['og:description', 'twitter:description', 'description']).slice(0, 400),
      image: abs(meta(html, ['og:image', 'og:image:url', 'twitter:image', 'twitter:image:src'])),
      siteName: meta(html, ['og:site_name', 'application-name']) || fallback.siteName,
      favicon: abs(icon) || base.origin + '/favicon.ico',
    });
  } catch {
    send(res, 200, fallback);
  }
}
