# Moving off Supabase to Cloudflare

Supabase does four jobs here. Each one moves on its own, in this order, so the site keeps working the whole time.

| Job | Today | Moves to | State |
|---|---|---|---|
| Files (part DXF/STL/STEP, robot logs, Linear imports) | Supabase Storage | **R2**: 10 GB free, egress free | Code done (`lib/storage.ts`). Needs the bucket and keys. |
| Hosting | Vercel | **Workers** via `@opennextjs/cloudflare` | Not started. Free Workers allow 10 ms CPU per request, so it has to be measured first. |
| Sign-in | Supabase Auth (Google) | Google OAuth called directly, with our own signed cookie | Not started |
| "Something changed" pings | Supabase Realtime (`realtime.send` triggers) | A Durable Object that holds the WebSockets | Not started |
| Database | Supabase Postgres | **D1** (SQLite, 500 MB per DB, 5M rows read and 100k written per day) | Not started. Needs hosting on Workers first, since D1 has no fast way in from Vercel. |

## Step 1: files to R2

1. Cloudflare dashboard → R2 → **Create bucket**. Name it, for example, `warriorb-files`. Location: Automatic. Leave public access **off**.
2. Bucket → Settings → **CORS policy** → paste `docs/r2-cors.json`. This lets the browser PUT uploads and fetch robot logs.
3. R2 → **Manage API tokens** → Create API token. Choose **Object Read & Write** and limit it to that bucket. Copy the Access Key ID, the Secret Access Key, and your Account ID.
4. Add `R2_ACCOUNT_ID`, `R2_ACCESS_KEY_ID`, `R2_SECRET_ACCESS_KEY` and `R2_BUCKET` to `.env.local` only, not Vercel yet. Then run:
   ```
   node --env-file=.env.local scripts/copy-storage-to-r2.mjs --dry   # what it will copy
   node --env-file=.env.local scripts/copy-storage-to-r2.mjs         # copy (re-run until 0 failed)
   ```
5. Add the same four vars to Vercel (Production and Preview), then redeploy. From then on, uploads and downloads use R2.
6. Check: open a part's file, upload a DXF, open a robot log, and upload one from Mayhem. Mayhem needs no update because it just PUTs to the URL the site returns.
7. After a week with no problems, empty the Supabase buckets to free that quota.

Rolling back means removing the R2 vars from Vercel. Anything uploaded to R2 in the meantime would then be missing from Supabase.

## Later steps (planned, not built)

- **Hosting:** add `wrangler.jsonc` and `@opennextjs/cloudflare`, then deploy to a `*.workers.dev` URL and watch CPU time per route. Heavy server work, such as DXF parsing, the Onshape sync and robot-log routes, may need the $5/mo Workers Paid plan (30 s CPU) or to move into the browser. Move the domain over only after that.
- **Sign-in:** create a Google OAuth client. The callback swaps the code for the Google email, then `work_accounts` is checked exactly as now. The session becomes a signed cookie, reusing the `SESSION_SECRET` pattern in `lib/auth.ts`.
- **Pings:** one Durable Object called `board`. Writes POST to it, and it fans a `changed` message out to connected browsers. `components/realtime.tsx` and `work-provider.tsx` switch from a Supabase channel to a WebSocket.
- **Database:**
  - Convert the schema to SQLite. uuid becomes text, jsonb becomes JSON text, enums become `CHECK` constraints, and timestamptz becomes ISO text.
  - Add a small query builder with the same `.from().select().eq()…` shape the app uses, so the ~200 call sites barely change. No call site uses embedded relations, which keeps this simple.
  - Port the plpgsql functions (`mutate_work`, `advance_work`, `claim_work_account`, `set_work_access`, `import_linear_work`) to TypeScript using `db.batch()`.
  - Export the data and load it with `wrangler d1 execute`.
  - D1 free limits to design around: 100 bound parameters per query (chunk big `.in()` lists and inserts) and 50 queries per request.
