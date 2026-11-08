# Row: Abhay's Dashboard

A personal dashboard of plain HTML pages plus a small Node server. It runs on this PC at http://localhost:3210 and starts by itself at Windows logon. The repo is `fearlesscowherder-glitch/Row` on GitHub, branch `main`; this PC is already signed in to push. Setup for people is in SETUP.md.

## Pages

Each page is one self-contained HTML file with inline CSS and JS. Most load `app-core.js` and `topbar.js`.

| Page | What |
|---|---|
| index.html | Today: daily goals / to-do, "today at a glance" cards, ✨ Polish (AI) |
| school.html | Schoology assignments, by class or by date |
| calendar.html | Month view: school, email events, own events, list due dates, workouts |
| lists.html | Sticky-note checklists and notes |
| mind.html | Saved links, notes, quotes and images with AI tags (mymind-style, original design) |
| gym.html, health.html, po-water.html, finance.html | Older trackers; synced through `App.mirror` |

- `topbar.js`: the shared top bar and nav row.
- `app.css`: shared design tokens for the newer pages.

## Client: app-core.js (`window.App`)

- `App.store.get/set/watch`: synced key/value storage. Local cache keys are `rowc:` and `rowm:`. The server stores each key as `row:<key>`. Last write wins, and other devices poll every 25 seconds.
- `App.mirror(name, test)`: syncs an older page's own localStorage keys.
- `App.api(path, {method, body})`: sends the app password (localStorage `row_app_pw`) as the `x-app-password` header and shows an unlock prompt on 401.
- `App.school`, `App.cal.items(from, to)`, `App.gmail`: data used by several pages.

## Server

`server.mjs` serves the static files and runs `api/*.js`, the same handlers Vercel would run. Files in `api/` that start with `_` are helpers, not routes.

- `api/_lib.js`: auth and storage.
  - Uses Supabase if `SUPABASE_URL` is set; otherwise one JSON file per key in `data/`.
  - Keys starting with `_row:` are server-only and can't be reached through `/api/state`.
- `api/_ai.js`: `askJson({system, content, schema})`.
  - If `AI_BASE_URL` is set, it uses OmniRoute (OpenAI-compatible, localhost:20128). Otherwise it uses the Claude API with `ANTHROPIC_API_KEY`.
  - `AI_MODEL=groq/openai/gpt-oss-120b` because it's fast. OmniRoute's `auto` picks a slow reasoning model that times out.
  - `AI_VISION_MODEL` handles requests that include images.
- `api/schoology.js`: Schoology.
  - This school's export link requires login, so `server.mjs` imports the newest Schoology `.ics` from `~/Downloads`. The School page also has an Import button.
  - The export has no class names. The AI guesses them, stored in `_row:school_class_guess`. User rules and overrides in `school_meta` win.
- `api/_gmail.js`: Gmail through IMAP with an app password (`GMAIL_ADDRESS`, `GMAIL_APP_PASSWORD`).
  - Sends 5 emails per AI call and adds only personal events, never marketing.
  - Saves `row:email_events`.
  - OAuth (`api/google-auth.js`) is an unused fallback.
- `server.mjs` runs a background sync every 15 minutes: Gmail and the Schoology URL, if one is set.

## Running and restarting

- The always-on copy is the Task Scheduler task "Row Dashboard", which runs `tools\start-hidden.vbs` and then `tools\run-forever.cmd`. The log is `logs\server.log`.
- **After changing anything in `api/`, `server.mjs` or `.env`, restart it.** Kill the `node.exe` whose command line contains `server.mjs`; it comes back within 15 seconds:
  `Get-CimInstance Win32_Process -Filter "Name='node.exe'" | ? { $_.CommandLine -match 'server\.mjs' } | % { Stop-Process -Id $_.ProcessId -Force }`
- HTML, CSS and client JS changes only need a browser refresh.
- `npm start` fails with "port in use" while the always-on copy is running. That's expected.

## Rules

- **Never commit or print secrets.**
  - `.env` holds the app password, Gmail app password and settings.
  - `data/` holds personal data.
  - `logs/` and `node_modules/` don't belong in git either.
  - All four are gitignored; `.env.example` is the template.
- The server blocks dotfiles, `data/`, `logs/`, `tools/`, `api/` and package files from being served. Keep it that way when adding folders.
- Keep pages dependency-free (no build step).
- Check changes at phone width (about 390px) as well as desktop.
- Commit messages end with a `Co-Authored-By` line.
