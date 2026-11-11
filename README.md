# Scheduler — team calendar, project boards and meeting alerts

The planning tool in the **Kato.8 internal-tools suite**: a shared team calendar with availability and
meeting booking, kanban and art-pipeline project boards with sprints and milestones, a ticket queue,
personal tasks, a docs area, Google Calendar sync and Discord alerts ten and thirty minutes before meetings.
It is part of the suite listed in [`@kato8/core`](https://github.com/Terry-Resume/kato8-core) and reports its status to the
[`central-command`](https://github.com/Terry-Resume/central-command) hub through `GET /api/health`.

**Stack:** Next.js 16 (App Router, `proxy.ts`), React 19, Clerk, Supabase (Postgres), Tailwind.

## Run it with fictional data

```bash
npm install
cp .env.example .env.local     # add Clerk dev keys, a Supabase project URL and its service-role key
npm run seed:demo              # writes supabase/seed.demo.sql from @kato8/core's 39-person demo studio
npm run dev
```

Run `supabase/migrations/*.sql` in order, then `supabase/seed.demo.sql`, in the Supabase SQL editor.
The seed is generated from the same roster that HR, the Executive Assistant and the hub use, and is safe to re-run.

## How data access works (and why it is locked down)

All database access happens on the server, in route handlers and server components, through `lib/supabase.ts`, which uses the
**service-role key** and is marked `server-only` so a client component cannot import it. Every route checks the Clerk
session first. The browser never receives a database key.

Migration `016_lock_down_database.sql` enables row-level security on every table and revokes `anon`/`authenticated` access, so
the public API is closed even if someone finds the project URL. Earlier migrations had granted `ALL` to `anon` with RLS off while
shipping the anon key to browsers, which exposed every table to anyone who opened the site.

> **Deploy order matters.** 1) Set `SUPABASE_SERVICE_ROLE_KEY` (and `SUPABASE_URL`) and deploy this code.
> 2) Then run migration 016. Running it first breaks the live app, which would still be using the anon key.
> 3) Verify: `SUPABASE_URL=… SUPABASE_ANON_KEY=… npm run verify:rls` should report every table as closed.

## Access control

- Signed-out visitors are redirected to `/sign-in` by `proxy.ts`. Only `/`, `/sign-in`, `/sign-up`, `/api/health` and `/api/cron/*` are public.
- **Admins** are the Clerk user ids in `ADMIN_USER_IDS`. There is no built-in default, so set it before deploying.
- `/api/cron/*` is authenticated by `CRON_SECRET` and **fails closed**: with no secret configured it answers 503 (it used to be open).
- The Google connect flow uses a signed, expiring OAuth `state` bound to the signed-in user, and `/api/auth/google/callback` stores tokens only when it verifies.

## Meeting alerts

`GET /api/cron/meeting-alerts` posts to Discord for meetings starting in about 10 and 30 minutes. It is triggered every 15 minutes by
`.github/workflows/meeting-alerts.yml`, which works on any hosting plan. Set the repository variable `CRON_APP_URL` (for example
`https://calendar.kato8studiosapp.xyz`) and the repository secret `CRON_SECRET`. On a Vercel plan that allows sub-daily crons you can
use `crons` in `vercel.json` instead; Vercel sends the same `Authorization: Bearer $CRON_SECRET` header.

## Develop

```bash
npm run typecheck   # type errors now fail the build; ignoreBuildErrors was removed
npm run lint
npm test            # admin ids, cron auth, OAuth state, RLS verifier
npm run build
```

## Security notes

- Google OAuth tokens are stored on `profiles` in plain text. They are now behind RLS and server-only access; encrypting them at rest (for example with a `TOKEN_ENCRYPTION_KEY`) is the next hardening step.
- Eight moderate advisories remain in the lint toolchain (`minimatch` via `eslint-config-next`); production dependencies report none.
- The `supabase/migrations` folder starts at `001` but has gaps (`003`, `005`, `007`–`013`). A baseline dump (`supabase db dump --schema public`) should replace the gaps before this is run against a new project; the tracked migrations do apply cleanly on their own.
- The React Compiler lint rules (`set-state-in-effect`, `refs`, `immutability`) are warnings while the pages migrate off fetch-in-effect.

MIT licensed. Demo people and records are invented.
