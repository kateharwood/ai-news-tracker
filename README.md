# AI News Tracker

Personal AI news curator: ingest from RSS/arXiv, filter and rank with Claude, learn from your upvotes/downvotes.

## Stack

- **Next.js** (App Router) on Vercel
- **Supabase** (Postgres + Auth)
- **Claude** (Anthropic API) for filter, rank, summarize, and preference bullets

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
   - Run the SQL in `supabase/migrations/001_initial.sql` in the SQL Editor (or use `supabase db push` if using Supabase CLI).
   - In Authentication → Providers, keep Email enabled. For **closed sign-up**, either:
     - Disable “Allow new signups” in Authentication → Providers → Email, and create your user via Supabase dashboard (Authentication → Users → Add user), or
     - Use an invite-only flow (e.g. only allow listed emails).
   - Copy the project URL and anon key (and service role key for cron).

3. **Environment variables**

   Copy `env.example` to `.env.local` and set:

   - `NEXT_PUBLIC_SUPABASE_URL`
   - `NEXT_PUBLIC_SUPABASE_ANON_KEY`
   - `SUPABASE_SERVICE_ROLE_KEY` (for cron and server-side writes)
   - `ANTHROPIC_API_KEY` or `CLAUDE_API_KEY`
   - `CRON_SECRET` (optional; set and pass as `Authorization: Bearer <CRON_SECRET>` when calling the daily cron)
   - `TZ=America/New_York` (optional; for “today” and cron timing)

4. **Run locally**

   ```bash
   npm run dev
   ```

   Open [http://localhost:3000](http://localhost:3000). Sign in with the user you created in Supabase.

5. **Daily cron (ingest + filter + rank)**

   Call once per day (e.g. 6am ET via Vercel Cron or an external scheduler):

   ```bash
   curl -X GET "https://your-app.vercel.app/api/cron/daily" \
     -H "Authorization: Bearer YOUR_CRON_SECRET"
   ```

   If `CRON_SECRET` is not set, the route still runs (useful for local testing).

## Usage

- **Dashboard**: Today’s top 10 (after cron has run). Upvote/downvote; click through to mark read; optionally hide read items.
- **History**: View past days’ top 10 (date picker or “Yesterday”).
- **Sources**: Add/edit/remove RSS feeds and arXiv sources (category + optional keyword).

After 10 new votes, the app updates your preference prompt (and condenses it if it exceeds 500 words). Those preferences are used in the next day’s filter and rank.

## Prompts

All Claude prompts live in the `prompts/` folder. Placeholders like `{{preference_prompt}}` and `{{items}}` are replaced in code.
