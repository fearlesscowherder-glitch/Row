// GET /api/schoology -> { assignments: [...], fetchedAt, source }
// Fetches the private Schoology calendar feed (SCHOOLOGY_ICAL_URL) and
// turns it into assignments. The last good result is cached in Supabase
// so pages still show assignments if Schoology is briefly down.
import { send, requireAuth, hasDb, getRow, setRow, PREFIX } from './_lib.js';
import { parseIcs } from './_ics.js';

let memo = null; // { at, body } — warm-instance cache

function stripHtml(s) {
  return (s || '')
    .replace(/<br\s*\/?>/gi, '\n').replace(/<\/p>/gi, '\n')
    .replace(/<[^>]+>/g, '')
    .replace(/&nbsp;/g, ' ').replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>')
    .replace(/&#39;|&apos;/g, "'").replace(/&quot;/g, '"')
    .replace(/\n{3,}/g, '\n\n').trim();
}

function guessCourse(ev, description) {
  if (ev.LOCATION && ev.LOCATION.trim()) return ev.LOCATION.trim();
  const m = description.match(/^(?:course|class|section)\s*:\s*(.+)$/im);
  if (m) return m[1].trim();
  if (ev.CATEGORIES && ev.CATEGORIES.trim()) return ev.CATEGORIES.split(',')[0].trim();
  return '';
}

function kindOf(url) {
  const m = (url || '').match(/\/(assignment|assessment|discussion|event|page|course)\//i);
  return m ? m[1].toLowerCase() : 'item';
}

export async function fetchSchoology() {
  let feed = process.env.SCHOOLOGY_ICAL_URL;
  if (!feed) throw new Error('SCHOOLOGY_ICAL_URL is not set (add it to .env, or to Vercel settings if deployed).');
  feed = feed.trim().replace(/^webcals?:\/\//i, 'https://');
  const r = await fetch(feed, { headers: { 'User-Agent': 'RowDashboard/1.0 (calendar sync)' } });
  if (!r.ok) throw new Error('Schoology feed returned ' + r.status);
  const text = await r.text();
  if (!text.includes('BEGIN:VCALENDAR')) throw new Error('That link did not return a calendar feed.');

  const assignments = parseIcs(text)
    .filter(ev => ev.DTSTART && ev.DTSTART.value)
    .map(ev => {
      const description = stripHtml(ev.DESCRIPTION);
      const url = ev.URL || (description.match(/https?:\/\/\S+schoology\S+/i) || [])[0] || '';
      return {
        id: ev.UID || (ev.SUMMARY + '|' + ev.DTSTART.value),
        title: (ev.SUMMARY || 'Untitled').trim(),
        course: guessCourse(ev, description),
        due: ev.DTSTART.value,
        allDay: ev.DTSTART.allDay,
        url,
        kind: kindOf(url),
        description: description.slice(0, 1200),
      };
    })
    .sort((a, b) => (a.due < b.due ? -1 : 1));

  return { assignments, fetchedAt: new Date().toISOString(), source: 'live' };
}

export default async function handler(req, res) {
  if (!requireAuth(req, res)) return;
  const force = new URL(req.url, 'http://x').searchParams.get('force') === '1';
  if (!force && memo && Date.now() - memo.at < 3 * 60 * 1000) return send(res, 200, memo.body);

  try {
    const body = await fetchSchoology();
    memo = { at: Date.now(), body };
    // Await: Vercel may freeze the function as soon as the response is sent.
    if (hasDb()) { try { await setRow(PREFIX + 'school_cache', body); } catch {} }
    send(res, 200, body);
  } catch (e) {
    // Fall back to the last good copy.
    if (hasDb()) {
      try {
        const cached = await getRow(PREFIX + 'school_cache');
        if (cached) return send(res, 200, Object.assign({}, cached, { source: 'cache', warning: String(e.message || e) }));
      } catch {}
    }
    send(res, 502, { error: String(e.message || e) });
  }
}
