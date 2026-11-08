// Minimal iCalendar (.ics) parser — enough for Schoology's calendar feed.

function unescapeText(v) {
  return v.replace(/\\n/gi, '\n').replace(/\\,/g, ',').replace(/\\;/g, ';').replace(/\\\\/g, '\\');
}

// Offset (ms) of a time zone from UTC at a given instant.
function tzOffset(utcMs, tz) {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: tz, hourCycle: 'h23',
    year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', second: '2-digit',
  }).formatToParts(new Date(utcMs));
  const p = {};
  for (const x of parts) p[x.type] = Number(x.value);
  return Date.UTC(p.year, p.month - 1, p.day, p.hour, p.minute, p.second) - utcMs;
}

function zonedToUtcIso(y, mo, d, h, mi, s, tz) {
  const guess = Date.UTC(y, mo - 1, d, h, mi, s);
  try {
    let t = guess - tzOffset(guess, tz);
    t = guess - tzOffset(t, tz); // second pass handles DST edges
    return new Date(t).toISOString();
  } catch {
    return null; // unknown TZID — caller falls back to floating time
  }
}

const pad = n => String(n).padStart(2, '0');

// Returns { value, allDay }. value is:
//   "YYYY-MM-DD"            for all-day dates
//   ISO string with "Z"     when the zone is known
//   "YYYY-MM-DDTHH:MM:SS"   for floating local times (browser reads as local)
export function parseIcsDate(raw, params) {
  const v = raw.trim();
  if ((params.VALUE === 'DATE') || /^\d{8}$/.test(v)) {
    return { value: v.slice(0, 4) + '-' + v.slice(4, 6) + '-' + v.slice(6, 8), allDay: true };
  }
  const m = v.match(/^(\d{4})(\d{2})(\d{2})T(\d{2})(\d{2})(\d{2})?(Z)?$/);
  if (!m) return { value: null, allDay: false };
  const [, y, mo, d, h, mi, s = '00', z] = m;
  if (z) return { value: new Date(Date.UTC(+y, +mo - 1, +d, +h, +mi, +s)).toISOString(), allDay: false };
  if (params.TZID) {
    const iso = zonedToUtcIso(+y, +mo, +d, +h, +mi, +s, params.TZID.replace(/^"|"$/g, ''));
    if (iso) return { value: iso, allDay: false };
  }
  return { value: `${y}-${mo}-${d}T${pad(h)}:${pad(mi)}:${pad(s)}`, allDay: false };
}

export function parseIcs(text) {
  // Unfold continuation lines (RFC 5545 §3.1).
  const lines = text.replace(/\r\n/g, '\n').replace(/\n[ \t]/g, '').split('\n');
  const events = [];
  let cur = null;
  for (const line of lines) {
    if (line === 'BEGIN:VEVENT') { cur = {}; continue; }
    if (line === 'END:VEVENT') { if (cur) events.push(cur); cur = null; continue; }
    if (!cur) continue;
    const colon = line.indexOf(':');
    if (colon < 0) continue;
    const left = line.slice(0, colon);
    const value = line.slice(colon + 1);
    const [name, ...paramParts] = left.split(';');
    const params = {};
    for (const p of paramParts) {
      const eq = p.indexOf('=');
      if (eq > 0) params[p.slice(0, eq).toUpperCase()] = p.slice(eq + 1);
    }
    const key = name.toUpperCase();
    if (key === 'DTSTART' || key === 'DTEND') cur[key] = parseIcsDate(value, params);
    else cur[key] = unescapeText(value);
  }
  return events;
}
