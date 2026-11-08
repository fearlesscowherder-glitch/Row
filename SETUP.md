# Setup: Schoology, Gmail, sync

The pages work right away when opened as files, but then everything stays in that one browser. To get Schoology assignments, Gmail → calendar, AI tagging and sync, run the app one of two ways:

- **On your computer** (`npm start`), using OmniRoute on the same computer for AI. See [Run it on your computer](#run-it-on-your-computer).
- **On Vercel**, reachable from your phone anywhere. AI then needs a Claude API key, or OmniRoute exposed to the internet (see step 3).

Plan on about 30 minutes, once. You'll collect these values. For Vercel paste them into **Vercel → your project → Settings → Environment Variables**; for your computer put them in a `.env` file:

| Variable | What it is |
|---|---|
| `APP_PASSWORD` | Any password you make up. The site is public, so this is what keeps your assignments and email events private. You type it once per device. |
| `SUPABASE_URL` | Supabase project URL (step 1) |
| `SUPABASE_SERVICE_KEY` | Supabase **secret** key (step 1) |
| `SCHOOLOGY_ICAL_URL` | Your private Schoology calendar link (step 2) |
| `AI_BASE_URL` / `AI_API_KEY` / `AI_MODEL` | OmniRoute (or any OpenAI-compatible gateway) for reading emails, tagging Mind items and ✨ Polish (step 3) |
| `ANTHROPIC_API_KEY` | Instead of the three above: a Claude API key (step 3) |
| `GMAIL_ADDRESS` / `GMAIL_APP_PASSWORD` | Gmail connection (step 4) |
| `CRON_SECRET` | Any long random string. Lets Vercel's daily job run (step 5) |

## 1. Supabase (sync database)

1. Make a free account at [supabase.com](https://supabase.com) and create a project.
2. Open **SQL Editor**, paste in everything from [supabase.sql](supabase.sql), and click **Run**.
3. Open **Project Settings → API Keys**. Copy the **Project URL** into `SUPABASE_URL` and a **secret key** (`sb_secret_…`, or the legacy `service_role` key) into `SUPABASE_SERVICE_KEY`.
   Never put the secret key in an HTML file. It only goes in Vercel.

## 2. Schoology calendar link

1. In Schoology, open **Calendar** (top bar), then look for **Export** / **Subscribe** (on some schools it's under the ⚙ or "…" menu).
2. Copy the private link (starts with `webcal://` or `https://`). Paste it into `SCHOOLOGY_ICAL_URL`.

The School page refreshes every 10 minutes while it's open, and a daily job keeps a saved copy. If some assignments show up as **Unsorted**, your school's feed doesn't include class names. Open **School → Classes** and add rules like "title contains `Chem` → Chemistry".

## 3. AI (OmniRoute or Claude)

**OmniRoute (runs on your computer):**

1. Start OmniRoute and open its dashboard (normally [localhost:20128](http://localhost:20128)). Connect the providers you want to use.
2. Under **Endpoints / API Keys**, create a key. Put it in `AI_API_KEY`.
3. Set `AI_BASE_URL=http://localhost:20128/v1`.
4. Set `AI_MODEL` to a model or combo name OmniRoute lists (`auto` lets OmniRoute pick). For tagging Mind images, pick a model that can see images.

Check it works: `curl http://localhost:20128/v1/models -H "Authorization: Bearer YOUR_KEY"` should list models.

`localhost` only means something on your own computer, so this works when the app runs there (`npm start`). A Vercel deployment can't reach it. To use OmniRoute from Vercel you'd have to expose it with a tunnel (e.g. Cloudflare Tunnel) and set `AI_BASE_URL` to the tunnel's address. If you do, make sure OmniRoute requires its API key.

When `AI_BASE_URL` is set the app uses it; otherwise it uses `ANTHROPIC_API_KEY`.

**Claude API instead:** create a key at [platform.claude.com](https://platform.claude.com) → API Keys and put it in `ANTHROPIC_API_KEY`. It uses `claude-opus-5-5`. Each email scan or Mind item costs a fraction of a cent to a few cents.

## 4. Gmail (emails → calendar)

Use a Gmail **app password**. No Google Cloud project needed.

1. Turn on **2-Step Verification** for your Google account: [myaccount.google.com/security](https://myaccount.google.com/security). App passwords only exist once it's on.
2. Open [myaccount.google.com/apppasswords](https://myaccount.google.com/apppasswords), type a name like `Row`, click **Create**, and copy the 16-letter password (spaces don't matter).
3. Set `GMAIL_ADDRESS` to your Gmail address and `GMAIL_APP_PASSWORD` to that password.
4. Make sure IMAP isn't turned off: Gmail → ⚙ **See all settings → Forwarding and POP/IMAP**. (New accounts have it on.)

Restart the app (or redeploy). **Calendar** then shows "Gmail connected". The app looks at recent inbox emails (not promotions or social) and adds things with real dates: practices, meetings, appointments, deadlines. It never sends, deletes or marks anything as read.

The app password can read your whole mailbox, so keep it only in `.env` / Vercel settings, never in a page or in git. To revoke it, delete it on the app passwords page.

If the app passwords page says it isn't available, your account is managed by a school or work (or uses Advanced Protection). Use a personal Gmail.

<details><summary>Alternative: Google sign-in (needs a Google Cloud project)</summary>

1. At [console.cloud.google.com](https://console.cloud.google.com) create a project, then enable **Gmail API** under **APIs & Services → Library**.
2. **OAuth consent screen**: choose **External**, fill in an app name and your email, and add yourself under **Test users**.
3. **Clients → Create client → Web application**, with redirect URI `https://YOUR-SITE.vercel.app/api/google-auth` and/or `http://localhost:3210/api/google-auth`. Copy the ID and secret into `GOOGLE_CLIENT_ID` / `GOOGLE_CLIENT_SECRET`.
4. On **Audience**, click **Publish app**, or Google expires the connection every 7 days.
5. Open **Calendar → Connect Gmail**.

</details>

## 5. Deploy on Vercel

1. Push this repo to GitHub. In [vercel.com](https://vercel.com) choose **Add New → Project** and import it. No build settings needed.
2. Add all the environment variables above, then **Deploy**. (If you add or change variables later, redeploy: Deployments → ⋯ → Redeploy.)
3. Open your site. It asks for your `APP_PASSWORD` once per device.

Vercel runs `/api/cron` once a day (that's the free plan's limit), which refreshes Schoology and scans Gmail even when nothing is open. While any page is open, Schoology refreshes every 10 minutes and Gmail every 10 minutes.

## Run it on your computer

Needs [Node.js](https://nodejs.org) 20.12 or newer.

1. In this folder, copy `.env.example` to `.env` and fill it in (steps 2–4 above). Supabase (step 1) and `CRON_SECRET` are optional here: without Supabase, everything is saved in the `data` folder next to this file.
2. Run `npm install` once, then `npm start`.
3. Open [http://localhost:3210](http://localhost:3210). The terminal shows which AI it's using.

While it runs it refreshes Schoology and scans Gmail every 15 minutes (`SYNC_MINUTES` changes that), even with no page open. Close the terminal and it stops. If you set up Supabase, data lives there instead, and a Vercel deployment would see the same lists, notes and assignments. Back up the `data` folder if you don't use Supabase.

To open it from your phone on the same Wi-Fi, add `HOST=0.0.0.0` to `.env` and visit `http://YOUR-PC-IP:3210`. 

## Troubleshooting

- **"Could not reach the AI gateway"**: OmniRoute isn't running, or `AI_BASE_URL` has the wrong port. On Vercel this always happens with a `localhost` address (see step 3).
- **"AI gateway error 401"**: `AI_API_KEY` doesn't match a key in OmniRoute's dashboard.

- **"This device only" next to the page title**: the server isn't reachable or Supabase isn't set up. Check the variables and redeploy.
- **"Gmail rejected the app password"**: recreate it (step 4.2) and make sure `GMAIL_ADDRESS` is the same account.
- **Schoology error 401/403**: the link was reset. Copy a fresh export link from Schoology.
