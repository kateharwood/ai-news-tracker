# AI News Tracker

Personal AI news curator: ingest from RSS, filter and rank with Claude, learn from your upvotes/downvotes.

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
   - Apply all migrations in `supabase/migrations/` in order (`001` … `012`), or run `supabase db push` if you use the Supabase CLI. The initial schema is in `001_initial.sql`; later files add columns and tables (e.g. `daily_rankings.is_surprise`, `email_digest_sent`, `raw_fetched_items.filter_skipped_at`, migration `010` narrows `sources` to RSS-only, migration `011` adds view `source_filtered_counts`, migration `012` adds `sources.last_ingest_attempt_at` and `ingest_long_fetch_timestamps` for Sources page ingest health).
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

`vercel.json` defines schedules in **UTC**. On **Vercel Hobby**, each cron job may run **at most once per day**; expressions like `0 * * * *` (hourly in one job) **fail deploy**. This repo uses **separate cron entries** per UTC hour so ingest and filter still run **hourly in effect** while each job’s expression fires once per day — see [Usage & pricing for cron jobs](https://vercel.com/docs/cron-jobs/usage-and-pricing). On **Pro**, you could instead use one job per path with `0 * * * *` and `15 * * * *`; the split here remains valid on all plans.

- **`/api/cron/ingest`** — RSS ingest only. **24 cron jobs** (`0 0 * * *` … `0 23 * * *`): one run per clock hour at **:00** UTC. No LLM calls.
- **`/api/cron/filter`** — LLM filter on pending raw rows. **24 cron jobs** (`15 0 * * *` … `15 23 * * *`): one run per hour at **:15** UTC so that hour’s ingest can finish first. Does **not** write `daily_rankings`.
- **`/api/cron/rank-daily`** — builds today’s top 10 from **`news_items`** whose **`included_at`** is in the **rolling last 24 hours** (from `rolling24HoursAgo()` to now). Runs **once per day** at **`0 11 * * *`** (11:00 UTC), **before** the email digest so rankings exist when the digest sends.
- **`/api/cron/email-digest`** — sends one email per calendar day with today’s top 10 (newspaper-style HTML). Default: **`0 12 * * *`** (12:00 UTC daily, which is **7:00 AM Eastern** during EST or **8:00 AM Eastern** during EDT).

Secure cron routes in production by setting `CRON_SECRET` in the Vercel dashboard.

### Manual triggers

Ingest only (same as the hourly ingest cron):

```bash
curl -X GET "https://your-app.vercel.app/api/cron/ingest" \
  -H "Authorization: Bearer YOUR_CRON_SECRET"
```

Filter only (same as the hourly filter cron):

```bash
curl -X GET "https://your-app.vercel.app/api/cron/filter" \
  -H "Authorization: Bearer YOUR_CRON_SECRET"
```

Ranking only (same logic as the daily rank cron):

```bash
curl -X GET "https://your-app.vercel.app/api/cron/rank-daily" \
  -H "Authorization: Bearer YOUR_CRON_SECRET"
```

The dashboard **“Fetch & rank news”** button runs **three signed-in POSTs** in order — **`/api/run/ingest`**, **`/api/run/filter`**, **`/api/run/rank`** — so each step gets its own **300s** Vercel limit (Hobby-friendly). Legacy **`runIngestFilterJob`** (ingest then filter in one process) remains in code for manual scripting; **`runDailyJob`** still chains all three in one process and can hit the same single-invocation timeout as before.

Email digest (same auth pattern):

```bash
curl -X GET "https://your-app.vercel.app/api/cron/email-digest" \
  -H "Authorization: Bearer YOUR_CRON_SECRET"
```

If `CRON_SECRET` is not set, the routes still run (useful for local testing only).

## What happens when a run is triggered (step by step)

### How run types differ

| Run type | How it starts | Auth | Code path | Touches rankings / raw / news? | LLM? |
|----------|---------------|------|-----------|-------------------------------|------|
| **Dashboard “Fetch & rank news”** | `POST /api/run/ingest` → `POST /api/run/filter` → `POST /api/run/rank` (sequential, same session) | Must be **signed in** (Supabase session cookie). No `CRON_SECRET`. | **`runIngestOnlyJob`**, then **`runFilterOnlyJob`**, then **`runRankingJob`** | Yes: same DB effects as the three crons above. | **Yes** — same LLM usage as those steps. |
| **Cron ingest** | `GET /api/cron/ingest` on schedule or manual curl | If `CRON_SECRET` is set: header **`Authorization: Bearer <CRON_SECRET>`**. | **`runIngestOnlyJob`** | Raw ingest only; **no** filter or rankings. | **No** |
| **Cron filter** | `GET /api/cron/filter` on schedule or manual curl | Same optional Bearer cron secret. | **`runFilterOnlyJob`** | Filter → `news_items`; **does not** write `daily_rankings`. | **Yes** — every `filterItem` (and optional `summarizeItem`) for the filter queue. |
| **Cron rank** | `GET /api/cron/rank-daily` | Same optional Bearer cron secret. | **`runRankingJob`** only | **No** ingest or filter; only reads `news_items` and writes **`daily_rankings`** for today. | **Yes** — one **`rankTop12`** if the 24h candidate pool is non-empty. |
| **Email digest** | `GET /api/cron/email-digest` | Same optional Bearer cron secret. | Loads today’s ranking + items, builds HTML, sends via Resend; records **`email_digest_sent`** for that date so the same day is not sent twice. | Reads **`daily_rankings`** / **`news_items`**; **no** ingest/filter/rank. | **No** Claude calls in this route. |
| **Preference update** | `POST /api/run-preferences` (e.g. after voting from the dashboard) | Signed-in user. | Appends bullets to `preference_prompt`, may condense | Updates **`preference_prompt`** (+ **`preference_bullet_runs`**); does **not** ingest or re-rank by itself. | **Yes** — **`preferencesToBullets`**, and **`condensePrompt`** only if appended text pushes total **over 500 words**. |

**Ordering and failures:** The dashboard chains **three HTTP requests** so a slow ingest does not consume the same **300s** budget as filter/rank. If **ingest** fails, stop before filter/rank. Scheduled **ingest** (each UTC hour **:00**) and **filter** (**:15**) are independent: **`rank-daily`** can run without a recent ingest (it uses whatever `news_items` already exist in the rolling 24h window). **`runIngestFilterJob`** (ingest+filter in one invocation) and **`runDailyJob`** (all three in one) remain for scripts but share a single function timeout on Vercel.

**Shared Anthropic call shape (all news + preference LLMs):** `src/lib/claude.ts` sends a **single `user` message** per request (no separate system message in code). Default model: **`ANTHROPIC_MODEL`** env var or **`claude-sonnet-4-6`**; on **404** the client retries once with **`claude-haiku-4-5`**; on **429** it waits using `Retry-When` / `Retry-After` when present, then retries.

---

### A. Ingest only (`runIngestOnlyJob`)

Used by: **`GET /api/cron/ingest`**, **`POST /api/run/ingest`**, and as the first half of **`runIngestFilterJob`**. No LLMs.

1. **Load sources** — Read all **enabled** rows from `sources` (each row is an **RSS** feed URL in `config.url`).
2. **Ingest per source** — For each RSS source in turn: fetch the feed (with retries on some transient errors). Keep only entries whose published time is within the **last 3 hours**; older or undated entries are skipped. Upsert each kept entry into `raw_fetched_items` on `(source_id, external_id)`. On success, reset that source’s ingest failure streak; on failure, increment the streak.
3. **Return count** — `ingested` = successful per-item upserts in step 2.

---

### B. Filter only (`runFilterOnlyJob`)

Used by: **`GET /api/cron/filter`**, **`POST /api/run/filter`**, and as the second half of **`runIngestFilterJob`**. No ingest.

1. **Load preferences** — Read the single `preference_prompt` row (injected into filter prompts as `{{preference_prompt}}`).
2. **Skip stale never-filtered rows (no LLM)** — Rows with `filtered_at` null, `filter_skipped_at` null, and **`fetched_at` older than 2 days** are bulk-updated: `filter_skipped_at` = now, `filter_skip_reason` = `stale_unfiltered`. They remain **without** `filtered_at` (never LLM-judged) and are excluded from the queue below. Response field **`skipped_stale`** is how many rows were marked this run.
3. **Build the filter queue** — Select `raw_fetched_items` where **`filtered_at` and `filter_skipped_at` are both null** (newest `fetched_at` first). Load existing `news_items` (URL + title). Drop any raw row that **duplicates** an existing story: same normalized URL (scheme/host/path, no query/hash) **or** title similarity ≥ **0.85** compared to URLs/titles already seen (including both existing `news_items` and earlier rows in this queue).
4. **LLM — `filterItem` (Claude), once per queued raw row** — See **[filterItem](#filteritem)**. After each call, **always** set `filtered_at` on that raw row. If the outcome is **EXCLUDED**, skip `news_items` insert for that row. If **INCLUDED**, insert **`news_items`** with `included_at` = now.
5. **LLM — `summarizeItem` (Claude), only for INCLUDED rows with empty `raw_content`** — If `raw_content` is missing or whitespace-only after trim, **summary** comes from **`summarizeItem`**; otherwise summary is the first **200** characters of trimmed `raw_content`. See **[summarizeItem](#summarizeitem)**.
6. **Return counts** — `filtered` = new `news_items` from steps 4–5; `skipped_stale` = rows marked in step 2.

---

### C. Rank (`runRankingJob`)

Used by: **`POST /api/run/rank`** (dashboard, third step) and **`GET /api/cron/rank-daily`**.

1. **Load preferences** — Same `preference_prompt` row as filtering.
2. **Candidate pool** — Select `news_items` (including **`raw_fetched_items.source_id`**) whose `included_at` is **≥ now minus 24 hours** (rolling window).
3. **If there are no candidates** — Log and exit; **no** changes to `daily_rankings`.
4. **LLM — `rankTop12` (Claude), once** — See **[rankTop12](#ranktop12)**. Parses up to **12** ranked `{ news_item_id, rank }` objects (sorted by `rank` in code).
5. **Digest list (≤10, max 2 per source)** — Build an ordered list (target **10**, may be **fewer**):
   - **Base:** Ranks **1–9** from the model’s top 12 (deduped in order). **Rank 10:** one **surprise** story chosen uniformly at random from the 24h pool **not** among the model’s top **12** ids (`is_surprise: true`); if none exist, use the model’s **10th** id instead (no surprise flag).
   - **Source cap:** `source_id` from `raw_fetched_items` defines the “source” (same RSS feed). While any source appears **more than twice**, remove the **lowest-ranked** (worst position) row among that source’s rows.
   - **Backfill:** Append ids from the model’s ranks **10–12** (that are not already in the list), in model order, then any remaining 24h pool ids in DB order — only if adding respects **≤2 per source**. Stop at **10** rows or when no valid replacement remains.
6. **Persist today’s ranking** — **Today** = calendar date in **`APP_TIMEZONE`**. **Delete** all `daily_rankings` for that date, then **insert** one row per slot (`news_item_id`, `rank` 1…*n*, `date`, `is_surprise`) — *n* can be **fewer than 10** if step 5 could not fill.
7. **Return count** — `ranked` = number of rows inserted (0 if step 3 skipped).

---

### D. Preference pass (`POST /api/run-preferences`)

Not the same as “fetch news”; it **updates text preferences** from votes.

1. **Gate** — Needs **10** votes since the last `preference_bullet_runs` row (or, if never run, the **10 most recent** votes on first run). Otherwise returns JSON `{ ok: true, ran: false, message: ... }` and **no** LLM calls.
2. **LLM — `preferencesToBullets`** — See **[preferencesToBullets](#preferencestobullets)**. Output is appended to `preference_prompt.content` (with newlines).
3. **LLM — `condensePrompt`** — Runs **only if** the new full `preference_prompt` word count is **> 500** after append. See **[condensePrompt](#condenseprompt)**.
4. **Persist** — Update `preference_prompt`; insert **`preference_bullet_runs`** with vote count and raw bullets string.

---

### LLM reference: prompts and responses

Placeholders `{{...}}` are string-replaced in code (`src/lib/prompts.ts`). File bodies below are the **exact** templates on disk.

#### filterItem

- **When:** Step B.4, **once per** deduplicated raw row still pending filter (`filtered_at` and `filter_skipped_at` both null).
- **User message:** `prompts/filter_item.txt` with:
  - `{{preference_prompt}}` → full `preference_prompt.content` for id `00000000-0000-0000-0000-000000000001`.
  - `{{title}}` → raw row `title`.
  - `{{raw_content}}` → raw row `raw_content` truncated to **4000** characters in code.
  - `{{url}}` → raw row `url` or empty string.
- **API params:** `max_tokens` **1024** (see `src/lib/claude.ts`).

Template:

```text
You are a curator for a personal AI news digest. 
Your task is to decide whether a given news item should be INCLUDED in the user's daily top 10.
Generally, if a news item is about AI it should be included.
If you are not sure, refer to the below preferences.
The user has the following preferences (evolving over time from their upvotes/downvotes):
---
{{preference_prompt}}
---
But again, if a news item is about AI, it should generally be included.

Given the item below, respond with exactly one word: INCLUDED or EXCLUDED.

Item title: {{title}}
Item content/snippet: {{raw_content}}
Item URL: {{url}}

Answer (INCLUDED or EXCLUDED):
```

- **Response (model):** Free text; ideally a single word **`INCLUDED`** or **`EXCLUDED`**.
- **Response (app):** The first content block’s **text** is trimmed, uppercased, and tested with **`includes("INCLUDED")`** → if true, **`INCLUDED`**, else **`EXCLUDED`**. So any reply containing that substring (including typos like `NOT_INCLUDED`) is treated as included.

#### summarizeItem

- **When:** Step B.5, **only** for an **INCLUDED** item when trimmed `raw_content` is empty.
- **User message:** `prompts/summarize_item.txt` with `{{title}}`, `{{raw_content}}` (raw body truncated to **3000** chars, may be empty).
- **API params:** `max_tokens` **256**.

Template:

```text
Summarize this AI/tech news item in exactly one short sentence (under 25 words). 
Be neutral and informative.

Title: {{title}}
Content: {{raw_content}}

One-sentence summary:
```

- **Response (model):** A short sentence.
- **Response (app):** First text block, **`.trim()`**, stored as the **`news_items.summary`** string.

#### rankTop12

- **When:** Step C.4, **once**, if the 24h candidate list is non-empty.
- **User message:** `prompts/rank_top12.txt` with:
  - `{{preference_prompt}}` → same DB field as filter.
  - `{{items}}` → each candidate rendered **exactly** as below, blocks separated by **two** newlines (`\n\n`):

    ```text
    id: <uuid>
    title: <title>
    summary: <summary or empty>
    url: <url or empty>
    ```

- **API params:** `max_tokens` **1024**.

Template:

```text
You are a curator for a personal AI news digest. Given a list of included news items and the user's preferences,
pick the TOP 12 that are most relevant and interesting to the user, and rank them with the best first
(rank 1 = most important to show first).

The app will later trim to at most 10 for the digest and enforce diversity (e.g. at most two items from the same RSS feed),
so include strong runners-up in ranks 11–12.

User preferences:
---
{{preference_prompt}}
---

Items (each has id, title, summary, url):
{{items}}

Respond with a JSON array of exactly 12 objects, each with "news_item_id" (uuid string) and "rank" (1-12).
Example:
[{"news_item_id": "uuid-1", "rank": 1}, {"news_item_id": "uuid-2", "rank": 2}, ...]

Only include ids that were in the input list. Output nothing else except the JSON array.

```

- **Response (model):** Body should contain a **JSON array** of up to 12 objects `{ "news_item_id": string, "rank": number }` as instructed (possibly surrounded by other text).
- **Response (app):** Regex **`/\[[\s\S]*\]/`** on the first text block → greedy bracket match, **`JSON.parse`**, **sort by `rank` ascending**, then **`.slice(0, 12)`**. If **no** match, **`[]`**.

#### preferencesToBullets

- **When:** Preference pass step C.2.
- **User message:** `prompts/preferences_to_bullets.txt` with `{{voted_items}}` = one line per vote, built in code as:

  `- <direction>: <title>` or `- <direction>: <title> | <summary>` if summary exists  

  where `direction` is the vote’s `direction` field (e.g. `up` / `down`), joined by newlines.

- **API params:** `max_tokens` **1024**.

Template:

```text
The user has upvoted or downvoted the following AI news items. 
From these votes, extract brief bullet points describing what the user wants MORE of 
and what they want LESS of in their AI news digest.

Format your response as:

MORE:
- bullet one
- bullet two

LESS:
- bullet one
- bullet two

Keep bullets short (one short phrase each). Be specific to the topics/themes evident from the items.

Voted items (direction = up or down):
{{voted_items}}

Respond with only the MORE and LESS sections as above.
```

- **Response (model):** `MORE:` / `LESS:` sections with bullets.
- **Response (app):** First text block, **`.trim()`**, concatenated onto stored preferences (not re-parsed structurally).

#### condensePrompt

- **When:** Preference pass step C.3, **only if** word count **> 500** after bullets append (`wordCount` = split on whitespace).
- **User message:** `prompts/condense_prompt.txt` with `{{prompt_content}}` = the **entire** post-append preference string.

- **API params:** `max_tokens` **1024**.

Template:

```text
The following text is a growing list of user preferences for an AI news curator. 
Condense it into a shorter version (under 500 words) that preserves all the 
important points: what the user wants more of and what they want less of. 
Keep the same style (bullets or short phrases). Remove redundancy only.

---
{{prompt_content}}
---

Condensed version (under 500 words):
```

- **Response (model):** Shorter preference text.
- **Response (app):** First text block, **`.trim()`**, replaces the in-memory content before saving to **`preference_prompt`**.


## Usage

- **Dashboard**: Today’s top 10 in a newspaper-style layout (after the daily job has run). Upvote/downvote; open links to mark read.
- **History**: Past days’ rankings (date picker or “Yesterday”).
- **Sources**: Add/edit/remove RSS feeds.
- **Email**: Optional daily HTML digest mirroring the dashboard layout (configure Resend env vars and deploy).

After 10 new votes, the app updates your preference prompt (and condenses it if it exceeds 500 words). Those preferences feed the next filter and rank runs.

## Prompts

Source files are in `prompts/` (substitution in `src/lib/prompts.ts`). For **full templates, variable wiring, and how each reply is parsed**, see **[LLM reference: prompts and responses](#llm-reference-prompts-and-responses)** under *What happens when a run is triggered*.
