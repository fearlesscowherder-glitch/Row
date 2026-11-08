// Scheduled by vercel.json. Vercel sends "Authorization: Bearer $CRON_SECRET".
// Refreshes the Schoology cache and scans Gmail even when no page is open.
import { send, isCron, hasDb, setRow, PREFIX } from './_lib.js';
import { fetchSchoology } from './schoology.js';
import { runGmailSync } from './_gmail.js';

export default async function handler(req, res) {
  if (!isCron(req)) return send(res, 401, { error: 'cron only' });
  const out = {};
  if (process.env.SCHOOLOGY_ICAL_URL && hasDb()) {
    try {
      const body = await fetchSchoology();
      await setRow(PREFIX + 'school_cache', body);
      out.schoology = body.assignments.length;
    } catch (e) { out.schoology = 'error: ' + e.message; }
  }
  if (hasDb()) {
    try { out.gmail = await runGmailSync({ force: true }); }
    catch (e) { out.gmail = 'error: ' + e.message; }
  }
  send(res, 200, out);
}
