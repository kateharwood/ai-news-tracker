# AI News Tracker

Personal AI news curator: ingest from RSS/arXiv, filter and rank with Claude, learn from your upvotes/downvotes.

## Stack

- **Next.js** (App Router) on Vercel
- **Supabase** (Postgres + Auth)
- **Claude** (Anthropic API) for filter, rank, summarize, and preference bullets
- **Resend** (optional) for a daily HTML email of today’s top 10

## Setup

1. **Clone and install**

   ```bash
   cd ai-news-tracker
   npm install
   ```

   If your npm registry is custom, use the public registry for this project:

   ```bash
   npm install --registry https://registry.npmjs.org/
   ```

2. **Supabase**

   - Create a project at [supabase.com](https://supabase.com).
   - Apply all migrations in `supabase/migrations/` in order (`001` … `008`), or run `supabase db push` if you use the Supabase CLI. The initial schema is in `001_initial.sql`; later files add columns and tables (e.g. `daily_rankings.is_surprise`, `email_digest_sent` for the email digest).
   - In Authentication → Providers, keep Email enabled. For **closed sign-up**, either:
     - Disable “Allow new signups” in Authentication → Providers → Email, and create your user via Supabase dashboard (Authentication → Users → Add user), or
     - Use an invite-only flow (e.g. only allow listed emails).
   - Copy the project URL and anon key (and service role key for cron).

3. **Environment variables**

   Copy `env.example` to `.env.local` and set:

   | Variable | Purpose |
   |----------|---------|
   | `NEXT_PUBLIC_SUPABASE_URL` | Supabase project URL |
   | `NEXT_PUBLIC_SUPABASE_ANON_KEY` | Supabase anon (public) key |
   | `SUPABASE_SERVICE_ROLE_KEY` | Service role key (cron and server-side writes) |
   | `ANTHROPIC_API_KEY` or `CLAUDE_API_KEY` | Anthropic API |
   | `CRON_SECRET` | Optional; if set, cron routes require `Authorization: Bearer <CRON_SECRET>` |
   | `APP_TIMEZONE` | Optional; defaults to `America/New_York`. Used for “today” and ranking dates. On Vercel use this instead of `TZ`. |
   | `RESEND_API_KEY` | For the daily email digest ([Resend](https://resend.com)) |
   | `EMAIL_DIGEST_FROM` | Sender, e.g. `AI News <onboarding@resend.dev>` for testing |
   | `EMAIL_DIGEST_TO` | Recipient inbox for the digest |
   | `NEXT_PUBLIC_SITE_URL` | Optional; base URL for links inside the digest (defaults to `https://VERCEL_URL` on Vercel) |

   Optional: `ANTHROPIC_MODEL` to override the default Claude model (see `env.example`).

4. **Run locally**

   ```bash
   npm run dev
   ```

   Open [http://localhost:3000](http://localhost:3000). Sign in with the user you created in Supabase.

## Cron jobs (Vercel)

`vercel.json` defines schedules in **UTC**:

- **`/api/cron/daily`** — ingest and filter only (runs every **two hours** on odd UTC hours: `1, 3, 5, …, 23`). Same cadence as before; ranking is **not** part of this route.
- **`/api/cron/rank-daily`** — builds today’s top 10 from **`news_items`** whose **`included_at`** is in the **rolling last 24 hours** (from `rolling24HoursAgo()` to now). Runs **once per day** at **`0 11 * * *`** (11:00 UTC), **before** the email digest so rankings exist when the digest sends.
- **`/api/cron/email-digest`** — sends one email per calendar day with today’s top 10 (newspaper-style HTML). Default: **`0 12 * * *`** (12:00 UTC daily, which is **7:00 AM Eastern** during EST or **8:00 AM Eastern** during EDT).

Secure cron routes in production by setting `CRON_SECRET` in the Vercel dashboard.

### Manual triggers

Ingest + filter (same as the frequent cron):

```bash
curl -X GET "https://your-app.vercel.app/api/cron/daily" \
  -H "Authorization: Bearer YOUR_CRON_SECRET"
```

Ranking only (same logic as the daily rank cron):

```bash
curl -X GET "https://your-app.vercel.app/api/cron/rank-daily" \
  -H "Authorization: Bearer YOUR_CRON_SECRET"
```

The dashboard **“Fetch & rank news”** button still runs the **full** pipeline (ingest → filter → rank) in one request.

Email digest (same auth pattern):

```bash
curl -X GET "https://your-app.vercel.app/api/cron/email-digest" \
  -H "Authorization: Bearer YOUR_CRON_SECRET"
```

If `CRON_SECRET` is not set, the routes still run (useful for local testing only).


## Usage

- **Dashboard**: Today’s top 10 in a newspaper-style layout (after the daily job has run). Upvote/downvote; open links to mark read.
- **History**: Past days’ rankings (date picker or “Yesterday”).
- **Sources**: Add/edit/remove RSS feeds and arXiv sources (category + optional keyword).
- **Email**: Optional daily HTML digest mirroring the dashboard layout (configure Resend env vars and deploy).

After 10 new votes, the app updates your preference prompt (and condenses it if it exceeds 500 words). Those preferences feed the next filter and rank runs.

## Prompts

All Claude prompts live in the `prompts/` folder. Placeholders like `{{preference_prompt}}` and `{{items}}` are replaced in code.
