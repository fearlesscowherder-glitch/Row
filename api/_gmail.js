// Reads recent Gmail messages, asks the AI which ones contain real
// events or deadlines, and stores them in row:email_events.
//
// Two ways to read Gmail:
//   • App password over IMAP (GMAIL_ADDRESS + GMAIL_APP_PASSWORD). No
//     Google Cloud project needed. Used whenever those are set.
//   • Google sign-in (OAuth) with GOOGLE_CLIENT_ID / GOOGLE_CLIENT_SECRET.
import { ImapFlow } from 'imapflow';
import { simpleParser } from 'mailparser';
import { getRow, setRow, PREFIX, PRIVATE_PREFIX } from './_lib.js';
import { askJson } from './_ai.js';

function imapConfigured() {
  return !!(process.env.GMAIL_ADDRESS && process.env.GMAIL_APP_PASSWORD);
}

const TOKEN_KEY = PRIVATE_PREFIX + 'google_token';
const SEEN_KEY = PRIVATE_PREFIX + 'gmail_seen';
const STATUS_KEY = PRIVATE_PREFIX + 'gmail_status';
const EVENTS_KEY = PREFIX + 'email_events';

export async function gmailStatus() {
  const [token, status] = await Promise.all([getRow(TOKEN_KEY), getRow(STATUS_KEY)]);
  if (imapConfigured()) return Object.assign({ connected: true, method: 'app-password', account: process.env.GMAIL_ADDRESS }, status || {}, { needsReconnect: false });
  return Object.assign({
    connected: !!(process.env.GOOGLE_REFRESH_TOKEN || (token && token.refresh_token)),
    method: 'oauth',
    oauthAvailable: !!process.env.GOOGLE_CLIENT_ID,
  }, status || {});
}

async function accessToken() {
  const stored = await getRow(TOKEN_KEY);
  const refresh = (stored && stored.refresh_token) || process.env.GOOGLE_REFRESH_TOKEN;
  if (!refresh) return null;
  const r = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      client_id: process.env.GOOGLE_CLIENT_ID || '',
      client_secret: process.env.GOOGLE_CLIENT_SECRET || '',
      refresh_token: refresh,
      grant_type: 'refresh_token',
    }),
  });
  const j = await r.json();
  if (!r.ok) {
    const err = new Error(j.error === 'invalid_grant'
      ? 'Gmail access expired or was revoked. Reconnect Gmail.'
      : 'Google token error: ' + (j.error_description || j.error || r.status));
    err.code = j.error;
    throw err;
  }
  return j.access_token;
}

async function gmail(token, path) {
  const r = await fetch('https://gmail.googleapis.com/gmail/v1/users/me/' + path, {
    headers: { Authorization: 'Bearer ' + token },
  });
  if (!r.ok) throw new Error('Gmail API ' + r.status + ': ' + (await r.text()).slice(0, 200));
  return r.json();
}

function decode(data) {
  return Buffer.from(data || '', 'base64url').toString('utf8');
}

function htmlToText(html) {
  return html
    .replace(/<(script|style)[\s\S]*?<\/\1>/gi, '')
    .replace(/<br\s*\/?>|<\/(p|div|tr|li|h\d)>/gi, '\n')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/g, ' ').replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>')
    .replace(/&#39;/g, "'").replace(/&quot;/g, '"')
    .replace(/[ \t]+/g, ' ').replace(/\n\s*\n+/g, '\n\n').trim();
}

function bodyText(payload) {
  let plain = '', html = '';
  (function walk(p) {
    if (!p) return;
    if (p.mimeType === 'text/plain' && p.body && p.body.data) plain += decode(p.body.data) + '\n';
    else if (p.mimeType === 'text/html' && p.body && p.body.data) html += decode(p.body.data) + '\n';
    (p.parts || []).forEach(walk);
  })(payload);
  return (plain.trim() || htmlToText(html)).slice(0, 6000);
}

// Same Gmail search used by the API path, run over IMAP (X-GM-RAW).
async function imapEmails(query, seen) {
  const client = new ImapFlow({
    host: process.env.GMAIL_IMAP_HOST || 'imap.gmail.com',
    port: Number(process.env.GMAIL_IMAP_PORT || 993),
    secure: process.env.GMAIL_IMAP_PORT ? process.env.GMAIL_IMAP_PORT === '993' : true,
    auth: { user: process.env.GMAIL_ADDRESS, pass: process.env.GMAIL_APP_PASSWORD.replace(/\s+/g, '') },
    logger: false,
  });
  try {
    await client.connect();
  } catch (e) {
    if (e.authenticationFailed) throw new Error('Gmail rejected the app password. Check GMAIL_ADDRESS and GMAIL_APP_PASSWORD (see SETUP.md step 4).');
    throw new Error('Could not connect to Gmail: ' + e.message);
  }
  try {
    const lock = await client.getMailboxLock('INBOX', { readOnly: true });
    try {
      const uids = (await client.search({ gmraw: query }, { uid: true })) || [];
      const recent = uids.slice(-40);
      if (!recent.length) return [];
      const heads = await client.fetchAll(recent, { emailId: true }, { uid: true });
      const want = heads.filter(m => !seen.has('i' + m.emailId)).slice(-20).map(m => m.uid);
      if (!want.length) return [];
      const msgs = await client.fetchAll(want, { emailId: true, internalDate: true, source: true }, { uid: true });
      const out = [];
      for (const m of msgs) {
        const p = await simpleParser(m.source);
        const hex = /^\d+$/.test(m.emailId) ? BigInt(m.emailId).toString(16) : '';
        out.push({
          id: 'i' + m.emailId,
          subject: p.subject || '(no subject)',
          from: (p.from && p.from.text) || '',
          sent: new Date(m.internalDate || p.date || Date.now()).toISOString(),
          text: ((p.text || '').trim() || htmlToText(p.html || '')).slice(0, 6000),
          link: hex ? 'https://mail.google.com/mail/u/0/#all/' + hex : 'https://mail.google.com/mail/u/0/#inbox',
        });
      }
      return out;
    } finally { lock.release(); }
  } finally {
    await client.logout().catch(() => {});
  }
}

// Gmail API path (Google sign-in).
async function apiEmails(token, query, seen) {
  const list = await gmail(token, 'messages?maxResults=40&q=' + encodeURIComponent(query));
  const fresh = (list.messages || []).filter(m => !seen.has(m.id)).slice(0, 20);
  const msgs = await Promise.all(fresh.map(m => gmail(token, 'messages/' + m.id + '?format=full')));
  return msgs.map(m => {
    const h = {};
    for (const x of (m.payload && m.payload.headers) || []) h[x.name.toLowerCase()] = x.value;
    return {
      id: m.id,
      subject: h.subject || '(no subject)',
      from: h.from || '',
      sent: new Date(Number(m.internalDate)).toISOString(),
      text: bodyText(m.payload) || m.snippet || '',
      link: 'https://mail.google.com/mail/u/0/#all/' + m.id,
    };
  });
}

const EVENT_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  required: ['events'],
  properties: {
    events: {
      type: 'array',
      items: {
        type: 'object',
        additionalProperties: false,
        required: ['email_index', 'title', 'date', 'start_time', 'end_time', 'location', 'notes'],
        properties: {
          email_index: { type: 'integer', description: 'Index of the email this came from.' },
          title: { type: 'string', description: 'Short calendar title, under 60 characters.' },
          date: { type: 'string', description: 'YYYY-MM-DD' },
          start_time: { type: 'string', description: '24h HH:MM, or empty string if all-day / no time given.' },
          end_time: { type: 'string', description: '24h HH:MM, or empty string.' },
          location: { type: 'string', description: 'Place or meeting link, or empty string.' },
          notes: { type: 'string', description: 'One short line of useful detail, or empty string.' },
        },
      },
    },
  },
};

const SYSTEM = `You turn a student's emails into calendar entries.
Add an entry only for something with a specific date that the student would attend or must meet: classes, meetings, practices, games, rehearsals, appointments, tests, assignment or application deadlines, school events, flights, reservations, parties.
Only add events that are the student's own: sent by a person or group they belong to (teachers, coaches, school, clubs, team, family, friends, employer), or something they registered for, booked or were personally scheduled for (confirmations, interviews, appointments, tickets).
Skip mass-mailed invitations to things the student hasn't signed up for, even if the email uses their name: college admissions marketing (open houses, webinars, info sessions, campus visits), company promos and sales ("offer ends Sunday"), newsletters, and event listings. Also skip receipts and shipping updates, events that have already passed, and anything without a clear date.
When unsure whether something is personal or marketing, leave it out.
Resolve relative dates ("this Friday", "tomorrow") against the email's sent date. Times are in the student's local time zone. One email can produce several entries, or none.`;

export async function runGmailSync({ force = false } = {}) {
  const status = (await getRow(STATUS_KEY)) || {};
  if (!force && status.lastRun && Date.now() - Date.parse(status.lastRun) < 4 * 60 * 1000) {
    return Object.assign({ skipped: true, connected: true }, status);
  }

  const seenRow = (await getRow(SEEN_KEY)) || { ids: [] };
  const seen = new Set(seenRow.ids);
  const firstRun = seen.size === 0;
  const q = (firstRun ? 'newer_than:10d' : 'newer_than:3d') + ' -category:promotions -category:social -in:sent -in:chats';

  let emails;
  if (imapConfigured()) {
    try {
      emails = await imapEmails(q, seen);
    } catch (e) {
      const s = { lastRun: new Date().toISOString(), lastError: e.message };
      await setRow(STATUS_KEY, s);
      return Object.assign({ connected: true }, s);
    }
  } else {
    let token;
    try {
      token = await accessToken();
    } catch (e) {
      const s = { lastRun: new Date().toISOString(), lastError: e.message, needsReconnect: e.code === 'invalid_grant' };
      await setRow(STATUS_KEY, s);
      return Object.assign({ connected: e.code !== 'invalid_grant' }, s);
    }
    if (!token) return { connected: false };
    emails = await apiEmails(token, q, seen);
  }

  let added = 0, scanned = 0, lastError = '';
  if (emails.length) {

    const settings = (await getRow(PREFIX + 'settings')) || {};
    const tz = settings.timezone || process.env.TZ_NAME || 'America/New_York';
    const today = new Intl.DateTimeFormat('en-CA', { timeZone: tz, dateStyle: 'short' }).format(new Date());

    const store = (await getRow(EVENTS_KEY)) || { events: [] };
    const cutoff = new Date(Date.now() - 30 * 86400000).toISOString().slice(0, 10);
    const keep = store.events.filter(ev => ev.start.slice(0, 10) >= cutoff);
    const existing = new Set(keep.map(ev => ev.id));

    // A few emails per request keeps each one fast enough for smaller models;
    // progress is saved after every batch.
    const BATCH = 5;
    for (let b = 0; b < emails.length; b += BATCH) {
    const group = emails.slice(b, b + BATCH);
    const content = `Today is ${today} (time zone ${tz}).\n\n` + group.map((e, i) =>
      `<email index="${i}">\nFrom: ${e.from}\nSent: ${e.sent}\nSubject: ${e.subject}\n\n${e.text.slice(0, 3000)}\n</email>`
    ).join('\n\n');

    let result;
    try {
      result = await askJson({ system: SYSTEM, content, schema: EVENT_SCHEMA, maxTokens: 4000 });
    } catch (e) {
      lastError = e.message;
      break; // try the rest next time
    }

    result.events.forEach((ev, n) => {
      const src = group[ev.email_index];
      if (!src || !/^\d{4}-\d{2}-\d{2}$/.test(ev.date)) return;
      const id = 'gm_' + src.id + '_' + n;
      if (existing.has(id)) return;
      const hasTime = /^\d{2}:\d{2}$/.test(ev.start_time);
      keep.push({
        id,
        title: ev.title,
        start: hasTime ? ev.date + 'T' + ev.start_time + ':00' : ev.date,
        end: hasTime && /^\d{2}:\d{2}$/.test(ev.end_time) ? ev.date + 'T' + ev.end_time + ':00' : '',
        allDay: !hasTime,
        location: ev.location,
        notes: ev.notes,
        subject: src.subject,
        from: src.from,
        link: src.link,
        addedAt: new Date().toISOString(),
      });
      added++;
    });

    await setRow(EVENTS_KEY, { events: keep.slice(-500) });
    group.forEach(m => seen.add(m.id));
    scanned += group.length;
    await setRow(SEEN_KEY, { ids: Array.from(seen).slice(-1500) });
    }
  }

  const s = { lastRun: new Date().toISOString(), lastError, scanned, added };
  await setRow(STATUS_KEY, s);
  return Object.assign({ connected: true }, s);
}
