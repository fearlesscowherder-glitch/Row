// =============================================================
// app-core.js — shared by every page.
//   App.api(path, opts)      calls /api/* with the app password
//   App.store                synced key/value store (localStorage cache +
//                            Supabase through /api/state, last write wins)
//   App.mirror(name, test)   syncs an older page's own localStorage keys
//   App.school / App.cal     Schoology + calendar helpers used by several pages
//   App.toast / App.modal / App.esc / date helpers
// Pages still work with no server (opened as a file, or before setup):
// everything just stays in this browser.
// =============================================================
(function () {
  'use strict';

  const PW_KEY = 'row_app_pw';
  const C = 'rowc:';   // cached data
  const M = 'rowm:';   // sync metadata { updated_at, dirty }
  const isFile = location.protocol === 'file:';

  // ---------- tiny event bus ----------
  const listeners = {};
  function on(type, fn) { (listeners[type] = listeners[type] || []).push(fn); }
  function emit(type, detail) {
    (listeners[type] || []).forEach(fn => { try { fn(detail); } catch (e) { console.error(e); } });
  }

  function lsGet(k) { try { const r = localStorage.getItem(k); return r == null ? null : JSON.parse(r); } catch (e) { return null; } }
  function lsSet(k, v) { try { localStorage.setItem(k, JSON.stringify(v)); return true; } catch (e) { return false; } }
  function lsDel(k) { try { localStorage.removeItem(k); } catch (e) {} }

  // ---------- helpers ----------
  function esc(s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  }
  function uid() { return Date.now().toString(36) + Math.random().toString(36).slice(2, 7); }
  const pad = n => String(n).padStart(2, '0');
  function dkey(d) { d = d || new Date(); return d.getFullYear() + '-' + pad(d.getMonth() + 1) + '-' + pad(d.getDate()); }
  function parseWhen(s) {
    if (!s) return null;
    if (s instanceof Date) return s;
    const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(s);
    if (m) return new Date(+m[1], +m[2] - 1, +m[3]);
    const d = new Date(s);
    return isNaN(d) ? null : d;
  }
  function startOfDay(d) { const x = new Date(d); x.setHours(0, 0, 0, 0); return x; }
  function addDays(d, n) { const x = new Date(d); x.setDate(x.getDate() + n); return x; }
  function dayDiff(d) { return Math.round((startOfDay(d) - startOfDay(new Date())) / 86400000); }
  function fmtTime(d) { return d.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' }).replace(':00', '').replace(' ', '').toLowerCase(); }
  function fmtDay(d, opts) { return d.toLocaleDateString([], Object.assign({ weekday: 'short', month: 'short', day: 'numeric' }, opts || {})); }
  function relDay(d) {
    const n = dayDiff(d);
    if (n === 0) return 'Today';
    if (n === 1) return 'Tomorrow';
    if (n === -1) return 'Yesterday';
    if (n > 1 && n < 7) return d.toLocaleDateString([], { weekday: 'long' });
    if (n < 0) return Math.abs(n) + ' days ago';
    return fmtDay(d);
  }

  const PALETTE = ['#E07658', '#6BB8F2', '#6BE3A4', '#F2C063', '#B49AF5', '#F28DB2', '#5ED6D0', '#F29F5E', '#9FD36B', '#8FA8FF', '#E8A0F0', '#D9C77B'];
  function colorFor(name) {
    let h = 0; const s = String(name || '');
    for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) >>> 0;
    return PALETTE[h % PALETTE.length];
  }

  // ---------- toast ----------
  function toast(msg, isErr) {
    let wrap = document.querySelector('.toast-wrap');
    if (!wrap) { wrap = document.createElement('div'); wrap.className = 'toast-wrap'; document.body.appendChild(wrap); }
    const t = document.createElement('div');
    t.className = 'toast' + (isErr ? ' err' : '');
    t.textContent = msg;
    wrap.appendChild(t);
    setTimeout(() => t.remove(), isErr ? 5000 : 2600);
  }

  // ---------- modal ----------
  function modal(innerHtml, opts) {
    opts = opts || {};
    const back = document.createElement('div');
    back.className = 'modal-back';
    back.innerHTML = '<div class="modal" role="dialog" aria-modal="true" style="' + (opts.wide ? 'max-width:760px' : '') + '">' + innerHtml + '</div>';
    document.body.appendChild(back);
    const el = back.firstChild;
    function close(v) {
      back.remove();
      document.removeEventListener('keydown', onKey);
      if (opts.onClose) opts.onClose(v);
    }
    function onKey(e) { if (e.key === 'Escape') close(); }
    back.addEventListener('mousedown', e => { if (e.target === back) close(); });
    document.addEventListener('keydown', onKey);
    const first = el.querySelector('input,textarea,select');
    if (first && !opts.noFocus) setTimeout(() => first.focus(), 30);
    return { el, close };
  }

  // ---------- password ----------
  function password() { try { return localStorage.getItem(PW_KEY) || ''; } catch (e) { return ''; } }
  let pwPromise = null;
  function askPassword(reason) {
    if (pwPromise) return pwPromise;
    pwPromise = new Promise(resolve => {
      const m = modal(
        '<h2>Unlock your dashboard</h2>' +
        '<p class="muted" style="margin:0;font-size:13px;line-height:1.5">' +
        (password() ? 'That password didn\'t work. ' : '') +
        'Enter the <b>APP_PASSWORD</b> you set in Vercel. It is saved on this device only.</p>' +
        '<label for="pwIn">App password</label><input id="pwIn" class="input" type="password" autocomplete="current-password">' +
        '<div class="modal-actions"><button class="btn btn-ghost" data-x>Not now</button><button class="btn btn-primary" data-ok>Unlock</button></div>',
        { onClose: v => { pwPromise = null; resolve(!!v); } }
      );
      const input = m.el.querySelector('#pwIn');
      const ok = () => { if (!input.value) return; try { localStorage.setItem(PW_KEY, input.value); } catch (e) {} m.close(true); };
      m.el.querySelector('[data-ok]').onclick = ok;
      m.el.querySelector('[data-x]').onclick = () => m.close(false);
      input.addEventListener('keydown', e => { if (e.key === 'Enter') ok(); });
    });
    return pwPromise;
  }

  // ---------- sync status ----------
  // 'local'  no server / not set up      'off'  server unreachable
  // 'busy'   pushing or pulling          'ok'   in sync
  let syncState = isFile ? 'local' : 'busy';
  let serverAvailable = !isFile;
  let dbAvailable = !isFile;
  let pwDeclined = false;
  function setSync(s) { if (s !== syncState) { syncState = s; emit('sync', s); } }

  async function api(path, opts) {
    opts = opts || {};
    if (!serverAvailable) { const e = new Error('No server — running in local-only mode.'); e.offline = true; throw e; }
    const headers = { 'x-app-password': password() };
    let body;
    if (opts.body !== undefined) { headers['Content-Type'] = 'application/json'; body = JSON.stringify(opts.body); }
    let r;
    try {
      r = await fetch(path, { method: opts.method || 'GET', headers, body, keepalive: !!opts.keepalive, cache: 'no-store' });
    } catch (e) {
      setSync('off');
      e.offline = true;
      throw e;
    }
    const type = r.headers.get('content-type') || '';
    if (r.status === 404 && !type.includes('json')) {
      // Static host without the /api functions.
      serverAvailable = false; setSync('local');
      const e = new Error('No server — running in local-only mode.'); e.offline = true; throw e;
    }
    let j = null;
    try { j = await r.json(); } catch (e) {}
    if (r.status === 401) {
      if (!opts.noPrompt && !pwDeclined) {
        const ok = await askPassword();
        if (ok && !opts._retried) return api(path, Object.assign({}, opts, { _retried: true }));
        if (!ok) pwDeclined = true;
      }
      setSync('off');
      const e = new Error('Locked — enter your app password.'); e.status = 401; throw e;
    }
    if (!r.ok) {
      const e = new Error((j && j.error) || ('Request failed (' + r.status + ')'));
      e.status = r.status; e.body = j;
      if (r.status === 503 && path.indexOf('/api/state') === 0) { dbAvailable = false; setSync('local'); }
      throw e;
    }
    return j;
  }

  // ---------- synced store ----------
  const watched = new Set();
  const pending = new Map(); // key -> version
  let pushTimer = null;
  let version = 0;

  const store = {
    get(key, dflt) { const v = lsGet(C + key); return v == null ? dflt : v; },
    set(key, data) {
      lsSet(C + key, data);
      const meta = lsGet(M + key) || {};
      meta.dirty = true;
      lsSet(M + key, meta);
      pending.set(key, ++version);
      clearTimeout(pushTimer);
      pushTimer = setTimeout(flush, 700);
      emit('change', { key, local: true });
    },
    watch(keys) { keys.forEach(k => watched.add(k)); return this.pull(keys); },
    async pull(keys) {
      keys = keys || Array.from(watched);
      if (!keys.length || !serverAvailable || !dbAvailable) return;
      setSync('busy');
      let res;
      try { res = await api('/api/state?keys=' + encodeURIComponent(keys.join(',')), { noPrompt: pwDeclined }); }
      catch (e) { if (syncState === 'busy') setSync(e.offline ? syncState : 'off'); return; }
      const rows = res.rows || {};
      keys.forEach(key => {
        const remote = rows[key];
        const meta = lsGet(M + key) || {};
        if (remote) {
          if (remote.updated_at !== meta.updated_at) {
            if (meta.dirty) { pending.set(key, ++version); return; } // local edit wins; push it
            lsSet(C + key, remote.data);
            lsSet(M + key, { updated_at: remote.updated_at, dirty: false });
            emit('change', { key, remote: true });
          }
        } else if (lsGet(C + key) != null && !meta.updated_at) {
          pending.set(key, ++version); // first upload from this device
        }
      });
      if (pending.size) await flush(); else setSync('ok');
    },
    // Larger values (images): kept in IndexedDB locally, pushed to the server.
    async getBlob(key) {
      const local = await idb.get(key);
      if (local != null) return local;
      if (!serverAvailable || !dbAvailable) return null;
      try {
        const res = await api('/api/state?keys=' + encodeURIComponent(key), { noPrompt: true });
        const row = res.rows && res.rows[key];
        if (row) { idb.set(key, row.data); return row.data; }
      } catch (e) {}
      return null;
    },
    async setBlob(key, data) {
      await idb.set(key, data);
      if (!serverAvailable || !dbAvailable) return;
      try { await api('/api/state', { method: 'POST', body: { key, data } }); }
      catch (e) { if (!e.offline) toast('Could not upload image: ' + e.message, true); }
    },
    async delBlob(key) {
      await idb.del(key);
      if (!serverAvailable || !dbAvailable) return;
      try { await api('/api/state?key=' + encodeURIComponent(key), { method: 'DELETE' }); } catch (e) {}
    },
  };

  async function flush(keepalive) {
    clearTimeout(pushTimer);
    if (!pending.size) return;
    if (!serverAvailable || !dbAvailable) { pending.clear(); return; }
    setSync('busy');
    const jobs = Array.from(pending.entries());
    let failed = false;
    for (const [key, ver] of jobs) {
      try {
        const res = await api('/api/state', { method: 'POST', body: { key, data: store.get(key, null) }, keepalive, noPrompt: pwDeclined });
        if (pending.get(key) === ver) {
          pending.delete(key);
          lsSet(M + key, { updated_at: res.updated_at, dirty: false });
        }
      } catch (e) {
        failed = true;
        if (e.offline || e.status === 401 || e.status === 503) { pending.clear(); break; }
      }
    }
    if (pending.size && !failed) return flush(keepalive);
    if (syncState === 'busy') setSync(failed ? 'off' : 'ok');
  }

  // ---------- IndexedDB key/value (for images) ----------
  const idb = (function () {
    let dbp = null;
    function db() {
      if (!dbp) dbp = new Promise((res, rej) => {
        try {
          const r = indexedDB.open('row-blobs', 1);
          r.onupgradeneeded = () => r.result.createObjectStore('kv');
          r.onsuccess = () => res(r.result);
          r.onerror = () => rej(r.error);
        } catch (e) { rej(e); }
      });
      return dbp;
    }
    function tx(mode, fn) {
      return db().then(d => new Promise((res, rej) => {
        const t = d.transaction('kv', mode);
        const req = fn(t.objectStore('kv'));
        t.oncomplete = () => res(req && req.result);
        t.onerror = () => rej(t.error);
      })).catch(() => null);
    }
    return {
      get: k => tx('readonly', s => s.get(k)),
      set: (k, v) => tx('readwrite', s => s.put(v, k)),
      del: k => tx('readwrite', s => s.delete(k)),
    };
  })();

  // ---------- mirror an older page's own localStorage keys ----------
  // name: store key, test(k): which localStorage keys belong to it.
  // When another device changed them, the page reloads to show the new data.
  function mirror(name, test, opts) {
    opts = opts || {};
    const key = 'mirror_' + name;
    const collect = () => {
      const o = {};
      try {
        for (let i = 0; i < localStorage.length; i++) {
          const k = localStorage.key(i);
          if (k && test(k)) o[k] = localStorage.getItem(k);
        }
      } catch (e) {}
      return o;
    };
    const stable = o => JSON.stringify(Object.keys(o).sort().reduce((a, k) => (a[k] = o[k], a), {}));
    let last = stable(collect());

    function apply(remoteKeys) {
      try {
        Object.keys(collect()).forEach(k => { if (!(k in remoteKeys)) localStorage.removeItem(k); });
        Object.keys(remoteKeys).forEach(k => localStorage.setItem(k, remoteKeys[k]));
      } catch (e) {}
      last = stable(collect());
      if (opts.onApply) return opts.onApply();
      const guard = 'row_mirror_reload_' + name;
      const prev = Number(sessionStorage.getItem(guard) || 0);
      if (Date.now() - prev > 8000) { sessionStorage.setItem(guard, String(Date.now())); location.reload(); }
    }

    let waiting = null;
    function applyWhenIdle(keys) {
      const a = document.activeElement;
      if (a && /^(INPUT|TEXTAREA|SELECT)$/.test(a.tagName)) { waiting = keys; return; }
      apply(keys);
    }
    document.addEventListener('focusout', () => setTimeout(() => { if (waiting) { const k = waiting; waiting = null; applyWhenIdle(k); } }, 50));

    const cached = store.get(key, null);
    const local = collect();
    if (cached && stable(cached.keys || {}) !== stable(local)) store.set(key, { keys: local });

    on('change', ev => {
      if (ev.key !== key || !ev.remote) return;
      const remote = (store.get(key, {}) || {}).keys || {};
      if (stable(remote) === stable(collect())) return;
      if (!cached && !opts._firstDone) {
        // First sync on this device: merge so nothing local is lost.
        opts._firstDone = true;
        const merged = Object.assign({}, collect(), remote);
        if (stable(merged) !== stable(remote)) store.set(key, { keys: merged });
        return applyWhenIdle(merged);
      }
      applyWhenIdle(remote);
    });

    store.watch([key]).then(() => {
      if (!store.get(key, null) && Object.keys(collect()).length) store.set(key, { keys: collect() });
    });
    setInterval(() => {
      const now = stable(collect());
      if (now !== last) { last = now; store.set(key, { keys: collect() }); }
    }, 3000);
  }

  // ---------- polling ----------
  function poll() { if (!document.hidden && watched.size) store.pull(); }
  setInterval(poll, 25000);
  document.addEventListener('visibilitychange', () => { if (document.hidden) flush(true); else poll(); });
  window.addEventListener('pagehide', () => flush(true));

  // ---------- Schoology ----------
  const FEED = 'school_feed'; // local-only cache of the last fetch
  const school = {
    meta() {
      return Object.assign({ classNames: {}, rules: [], overrides: {}, done: {}, hidden: {}, order: [] }, store.get('school_meta', {}) || {});
    },
    saveMeta(m) { store.set('school_meta', m); },
    classOf(a, meta) {
      meta = meta || school.meta();
      if (meta.overrides[a.id]) return meta.overrides[a.id];
      const hay = (a.title + ' ' + (a.course || '')).toLowerCase();
      for (const r of meta.rules) if (r.match && hay.indexOf(r.match.toLowerCase()) >= 0) return r.cls;
      if (a.course) return meta.classNames[a.course] || a.course;
      return 'Unsorted';
    },
    cached() { return lsGet(C + FEED); },
    list() {
      const feed = school.cached();
      const meta = school.meta();
      return ((feed && feed.assignments) || [])
        .filter(a => !meta.hidden[a.id])
        .map(a => Object.assign({}, a, { cls: school.classOf(a, meta), done: !!meta.done[a.id], dueDate: parseWhen(a.due) }))
        .filter(a => a.dueDate);
    },
    toggleDone(id, done) {
      const m = school.meta();
      if (done) m.done[id] = Date.now(); else delete m.done[id];
      school.saveMeta(m);
    },
    async refresh(force) {
      try {
        const body = await api('/api/schoology' + (force ? '?force=1' : ''), { noPrompt: pwDeclined });
        lsSet(C + FEED, body);
        emit('school', body);
        return body;
      } catch (e) {
        emit('school-error', e);
        throw e;
      }
    },
  };
  on('change', ev => { if (ev.key === 'school_meta') emit('school', school.cached()); });

  // ---------- calendar aggregation ----------
  const SOURCE_COLORS = { email: '#6BB8F2', event: '#E07658', list: '#F2C063', workout: '#6BE3A4' };
  const cal = {
    sourceColors: SOURCE_COLORS,
    // All calendar items between [from, to) as { id, source, title, start, end, allDay, color, sub, done, ref }
    items(from, to) {
      const out = [];
      const inRange = d => d && d >= from && d < to;

      school.list().forEach(a => {
        if (!inRange(a.dueDate)) return;
        out.push({ id: 's_' + a.id, source: 'school', title: a.title, start: a.dueDate, end: null, allDay: a.allDay, color: colorFor(a.cls), sub: a.cls, done: a.done, ref: a });
      });

      const hidden = store.get('email_hidden', {}) || {};
      ((store.get('email_events', {}) || {}).events || []).forEach(ev => {
        if (hidden[ev.id]) return;
        const s = parseWhen(ev.start);
        if (!inRange(s)) return;
        out.push({ id: ev.id, source: 'email', title: ev.title, start: s, end: parseWhen(ev.end), allDay: ev.allDay, color: SOURCE_COLORS.email, sub: 'From email' + (ev.location ? ' · ' + ev.location : ''), ref: ev });
      });

      (store.get('cal_events', []) || []).forEach(ev => {
        const s = parseWhen(ev.start);
        if (!inRange(s)) return;
        out.push({ id: ev.id, source: 'event', title: ev.title, start: s, end: parseWhen(ev.end), allDay: ev.allDay, color: ev.color || SOURCE_COLORS.event, sub: ev.location || '', ref: ev });
      });

      ((store.get('lists', {}) || {}).lists || []).forEach(l => {
        (l.items || []).forEach(it => {
          if (!it.due) return;
          const s = parseWhen(it.due);
          if (!inRange(s)) return;
          out.push({ id: 'l_' + it.id, source: 'list', title: it.text, start: s, end: null, allDay: true, color: SOURCE_COLORS.list, sub: l.title || 'List', done: !!it.done, ref: { list: l, item: it } });
        });
      });

      const done = lsGet('po_coach_workout_done') || {};
      Object.keys(done).forEach(k => {
        if (!done[k]) return;
        const s = parseWhen(k.slice(0, 10));
        if (!inRange(s)) return;
        out.push({ id: 'w_' + k, source: 'workout', title: 'Workout done', start: s, end: null, allDay: true, color: SOURCE_COLORS.workout, sub: 'Gym', done: true });
      });

      // By day, then all-day items first within a day, then by time.
      return out.sort((a, b) =>
        (startOfDay(a.start) - startOfDay(b.start)) ||
        ((a.allDay ? 0 : 1) - (b.allDay ? 0 : 1)) ||
        (a.start - b.start));
    },
  };

  // ---------- Gmail ----------
  const gmail = {
    async status() { return api('/api/gmail', { noPrompt: true }); },
    async sync(force) {
      const r = await api('/api/gmail' + (force ? '?force=1' : ''), { method: 'POST', noPrompt: pwDeclined });
      try { localStorage.setItem('row_gmail_last', String(Date.now())); } catch (e) {}
      await store.pull(['email_events']);
      return r;
    },
    maybeSync() {
      const last = Number((function () { try { return localStorage.getItem('row_gmail_last'); } catch (e) { return 0; } })() || 0);
      if (Date.now() - last < 10 * 60 * 1000) return Promise.resolve(null);
      return gmail.sync(false).catch(() => null);
    },
    async connect() {
      const r = await api('/api/google-auth', { method: 'POST' });
      location.href = r.url;
    },
  };

  // ---------- sync pill ----------
  function syncPill(el) {
    const labels = { ok: 'Synced', busy: 'Syncing…', off: 'Offline', local: 'This device only' };
    const draw = () => { el.className = 'sync-pill ' + syncState; el.innerHTML = '<span class="dot"></span>' + labels[syncState]; el.title = syncState === 'local' ? 'Sync isn\'t set up yet: data is saved in this browser.' : ''; };
    draw(); on('sync', draw);
  }

  // Remember the browser's time zone so email dates resolve correctly.
  function saveTimezone() {
    try {
      const tz = Intl.DateTimeFormat().resolvedOptions().timeZone;
      const s = store.get('settings', {}) || {};
      if (tz && s.timezone !== tz) store.set('settings', Object.assign({}, s, { timezone: tz }));
    } catch (e) {}
  }

  window.App = {
    api, store, mirror, school, cal, gmail, on, emit, toast, modal, esc, uid,
    dkey, parseWhen, startOfDay, addDays, dayDiff, fmtTime, fmtDay, relDay, colorFor, syncPill,
    get syncState() { return syncState; },
    get serverAvailable() { return serverAvailable; },
    askPassword,
  };

  store.watch(['settings']).then(saveTimezone);
})();
