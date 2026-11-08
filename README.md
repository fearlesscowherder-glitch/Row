# Personal Dashboard

A set of small, self-contained HTML apps that share a top bar.

## Deploy your own copy

[![Deploy with Vercel](https://vercel.com/button)](https://vercel.com/new/clone?repository-url=https%3A%2F%2Fgithub.com%2FRowanThistlebrooke%2FYTdashh1)

One click → Vercel signs you in, copies the repo to your GitHub, and deploys it. ~30 seconds to a live URL.

## How to use

Open any `.html` file directly in your browser — no build step, no install.

| File | What it is |
|---|---|
| [index.html](index.html) | Today: due-soon assignments, today's schedule, workout status, Day Ring, daily To Do list |
| [school.html](school.html) | Schoology assignments, by class or by date, with done checkboxes |
| [calendar.html](calendar.html) | Month calendar + agenda: school, Gmail events, your events, list due dates, workouts |
| [lists.html](lists.html) | Sticky-note style checklists and notes |
| [mind.html](mind.html) | Save links, notes, quotes and images; auto-tagged and searchable |
| [health.html](health.html) | Supplement / daily stack tracker |
| [po-water.html](po-water.html) | Water intake tracker |
| [finance.html](finance.html) | Finances |
| [gym.html](gym.html) | Progressive overload gym tracker |
| [topbar.js](topbar.js) | Shared top bar + page nav |
| [app-core.js](app-core.js) / [app.css](app.css) | Shared sync, helpers and styles |
| [api/](api/) | Vercel serverless functions: Schoology feed, Gmail → calendar, Claude tagging, sync storage |

Opened as plain files, every page works and saves to that browser only. Deployed on Vercel with the settings in **[SETUP.md](SETUP.md)**, you get Schoology sync, Gmail → calendar, AI tagging, and sync across devices.

## Building from scratch

[BUILD_DASHBOARD.md](BUILD_DASHBOARD.md) is the prompt I gave Claude to generate `index.html` — paste it into Claude if you want to rebuild that page yourself.
