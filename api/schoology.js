// GET  /api/schoology            -> { assignments: [...], fetchedAt, source }
// POST /api/schoology { ics }    -> import a downloaded Schoology .ics file
//
// Two ways in:
//   • SCHOOLOGY_ICAL_URL: a feed link that works without logging in.
//   • A downloaded export (Schoology → Calendar → Export). server.mjs picks
//     these up from the Downloads folder automatically; the School page
//     also has an Import button.
// The latest result is saved as row:school_cache.
//
// Schoology exports don't say which class an item belongs to, so the AI
// guesses a class from each title once, and the guess is remembered.
import { send, requireAuth, hasDb, getRow, setRow, PREFIX, PRIVATE_PREFIX, readBody } from './_lib.js';
import { parseIcs } from './_ics.js';
import { askJson, aiProvider } from './_ai.js';

const CACHE_KEY = PREFIX + 'school_cache';
const GUESS_KEY = PRIVATE_PREFIX + 'school_class_guess';
const KEEP_DAYS = 120; // ignore items older than this (exports go back years)

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

export function isSchoologyIcs(text) {
  return typeof text === 'string' && text.includes('BEGIN:VCALENDAR') && /schoology/i.test(text.slice(0, 2000));
}

// Turn calendar text into the assignment list.
export function buildFromIcs(text, source) {
  if (!text || !text.includes('BEGIN:VCALENDAR')) throw new Error('That is not a calendar file.');
  const cutoff = new Date(Date.now() - KEEP_DAYS * 86400000).toISOString().slice(0, 10);
  const assignments = parseIcs(text)
    .filter(ev => ev.DTSTART && ev.DTSTART.value && ev.DTSTART.value.slice(0, 10) >= cutoff)
    .map(ev => {
      const description = stripHtml(ev.DESCRIPTION).replace(/\s*-\s*Link:\s*https?:\/\/\S+\s*$/i, '');
      const url = (ev.URL || (description.match(/https?:\/\/\S+schoology\S+/i) || [])[0] || '').replace(/^http:/, 'https:');
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
  return { assignments, fetchedAt: new Date().toISOString(), source };
}

const CLASS_SCHEMA = {
  type: 'object', additionalProperties: false, required: ['items'],
  properties: {
    items: {
      type: 'array',
      items: {
        type: 'object', additionalProperties: false, required: ['i', 'cls'],
        properties: { i: { type: 'integer' }, cls: { type: 'string' } },
      },
    },
  },
};

// Fill in `course` for items the feed left blank, using remembered AI
// guesses and asking the AI only about new titles.
async function addClassGuesses(body) {
  if (!hasDb()) return body;
  const guesses = (await getRow(GUESS_KEY)) || {};
  // Only items from the last two weeks onward matter enough to sort.
  const from = new Date(Date.now() - 14 * 86400000).toISOString().slice(0, 10);
  const todo = body.assignments.filter(a => !a.course && !(a.id in guesses) && a.due.slice(0, 10) >= from);
  if (todo.length && aiProvider()) {
    const known = Array.from(new Set(Object.values(guesses))).filter(Boolean).sort();
    try {
      for (let start = 0; start < todo.length; start += 30) {
        const batch = todo.slice(start, start + 30);
        const out = await askJson({
          system: 'You sort a high-school student\'s Schoology calendar items into their classes. ' +
            'Use short class names like "Chemistry", "AP Calculus", "Spanish", "English", "AP US History", "Physics". ' +
            'Reuse an existing class name whenever it fits so the same class always gets the same name. ' +
            'Use "School events" for school-wide things (days of the rotation, dances, spirit days, homeroom, assemblies). ' +
            'Use "Other" only if there is truly no clue.',
          content: (known.length ? 'Class names already in use: ' + known.join(', ') + '\n\n' : '') +
            batch.map((a, i) => i + '. ' + a.title + (a.description ? ' — ' + a.description.slice(0, 140).replace(/\s+/g, ' ') : '')).join('\n'),
          schema: CLASS_SCHEMA,
          maxTokens: 3000,
        });
        for (const r of out.items || []) {
          const a = batch[r.i];
          if (a && typeof r.cls === 'string') guesses[a.id] = r.cls.trim().slice(0, 40);
        }
        for (const a of batch) if (!(a.id in guesses)) guesses[a.id] = '';
        known.push(...Object.values(guesses).filter(c => c && !known.includes(c)));
        await setRow(GUESS_KEY, guesses); // keep progress if a later batch fails
      }
    } catch (e) {
      body.warning = 'Could not sort into classes: ' + e.message;
    }
  }
  for (const a of body.assignments) if (!a.course && guesses[a.id]) a.course = guesses[a.id];
  return body;
}

export async function saveSchoology(body) {
  await addClassGuesses(body);
  if (hasDb()) await setRow(CACHE_KEY, body);
  memo = { at: Date.now(), body };
  return body;
}

export async function importIcs(text, source = 'import') {
  if (!isSchoologyIcs(text)) throw new Error('That file is not a Schoology calendar export.');
  return saveSchoology(buildFromIcs(text, source));
}

// Live feed (only when SCHOOLOGY_ICAL_URL is set and reachable without login).
export async function fetchSchoology() {
  let feed = process.env.SCHOOLOGY_ICAL_URL;
  if (!feed) throw new Error('SCHOOLOGY_ICAL_URL is not set.');
  feed = feed.trim().replace(/^webcals?:\/\//i, 'https://');
  const r = await fetch(feed, { headers: { 'User-Agent': 'RowDashboard/1.0 (calendar sync)' }, redirect: 'manual' });
  if (r.status >= 300 && r.status < 400) throw new Error('That Schoology link needs you to be logged in, so it can\'t be read automatically. Use Export and the downloaded file instead.');
  if (!r.ok) throw new Error('Schoology feed returned ' + r.status);
  const text = await r.text();
  if (!text.includes('BEGIN:VCALENDAR')) throw new Error('That link did not return a calendar feed.');
  return saveSchoology(buildFromIcs(text, 'live'));
}

const NO_SOURCE = 'No Schoology assignments yet. In Schoology open Calendar → Export, and the app imports the downloaded file (or use Import on the School page).';

export default async function handler(req, res) {
  if (!requireAuth(req, res)) return;

  if (req.method === 'POST') {
    const b = await readBody(req);
    try { return send(res, 200, await importIcs(String(b.ics || ''), 'import')); }
    catch (e) { return send(res, 400, { error: String(e.message || e) }); }
  }

  const force = new URL(req.url, 'http://x').searchParams.get('force') === '1';
  if (!force && memo && Date.now() - memo.at < 3 * 60 * 1000) return send(res, 200, memo.body);

  if (process.env.SCHOOLOGY_ICAL_URL) {
    try { return send(res, 200, await fetchSchoology()); }
    catch (e) {
      const cached = hasDb() ? await getRow(CACHE_KEY).catch(() => null) : null;
      if (cached) return send(res, 200, Object.assign({}, cached, { warning: String(e.message || e) }));
      return send(res, 502, { error: String(e.message || e) });
    }
  }

  const cached = hasDb() ? await getRow(CACHE_KEY).catch(() => null) : null;
  if (cached) { memo = { at: Date.now(), body: cached }; return send(res, 200, cached); }
  send(res, 404, { error: NO_SOURCE, needsImport: true });
}
