# Golden Hour

Early-warning view for projects: where each project is heading against the client commitment, which tasks are blocked or late, and what to fix first. Business rules are in [CLAUDE.md](CLAUDE.md).

**Stack:** Next.js 16 (App Router, TypeScript) · Supabase Postgres (free tier) · Vercel (free tier).

## Run locally

1. Create a free Supabase project.
2. In Supabase: **SQL Editor → New query**, paste [supabase/schema.sql](supabase/schema.sql), run it. This creates the tables and seeds 7 sample members. Edit the seed list to match your team, or change members later in the **Team** page.
3. Copy `.env.example` to `.env.local` and fill in:
   - `NEXT_PUBLIC_SUPABASE_URL` and `SUPABASE_SERVICE_ROLE_KEY` (Supabase → Project Settings → API).
   - `CRON_SECRET`: any long random string.
4. Install and start:

```bash
npm install
npm run dev        # http://localhost:3000
npm test           # scheduling engine and permission tests
npm run typecheck
```

There is no login. Use the **Acting as** dropdown in the header to switch accounts. Permissions are enforced on the server for every write.

## Deploy to Vercel

1. Push this folder to a Git repo (GitHub, GitLab or Bitbucket).
2. In Vercel: **Add New → Project**, import the repo. Framework: Next.js (auto-detected).
3. Under **Environment Variables**, add the four values from `.env.local` (`NEXT_PUBLIC_SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY`, `CRON_SECRET`). Keep the service role key server-side only; never prefix it with `NEXT_PUBLIC_`.
4. Deploy. [vercel.json](vercel.json) schedules `/api/cron/alerts` daily at 01:00 UTC (08:00 in Vietnam). Vercel sends `CRON_SECRET` as the Bearer token. The Hobby plan allows one cron run per day, which matches the spec. Alerts are also checked every time a project list or project page loads.

## Where things live

| Concern | File |
|---|---|
| Working-day calendar, D/M/YYYY date format, Asia/Ho_Chi_Minh "today" | [src/lib/calendar.ts](src/lib/calendar.ts) |
| Dependency schedule, happy case, complete date, Monte Carlo, priority, what-if | [src/lib/schedule.ts](src/lib/schedule.ts) |
| Default 13-step flow and project creation | [src/lib/flow.ts](src/lib/flow.ts), [src/lib/project-setup.ts](src/lib/project-setup.ts) |
| **All permission rules** (single place) | [src/lib/permissions.ts](src/lib/permissions.ts) |
| Alert rules (overdue, to-do too long) | [src/lib/alerts.ts](src/lib/alerts.ts), [src/lib/notify.ts](src/lib/notify.ts) |
| Every write (server actions) | [src/app/actions.ts](src/app/actions.ts) |
| Current account (cookie) | [src/lib/session.ts](src/lib/session.ts) |
| Database access (service role, server only) | [src/lib/supabase.ts](src/lib/supabase.ts), [src/lib/repo.ts](src/lib/repo.ts) |

The Monte Carlo result (1,500 runs) is cached per project in `sim_cache`. It recomputes only when tasks, durations, statuses, blockers, or commits change.

## Defaults I chose (flagged per CLAUDE.md)

These were marked **[DEFAULT]** or left open in the spec. Each is a one-line change if you want it different.

- **Project membership is required** for project actions, except PM, who can act on any project as admin. A PO or member not in a project sees it as read-only.
- **Zero-duration open tasks** count as 1 day in the Monte Carlo runs (the spec's minimum-1 rule applied literally). They take 0 days in the deterministic schedule.
- **Changing the start date** shifts every task deadline by the same calendar days and clears their alert flags. Commit dates keep their calendar dates.
- **Creating a custom task with no deadline** sets the deadline to its planned finish.
- **Deleting a task** removes it from other tasks' blocked-by lists and deletes its links.
- **Project priority** is a label only. It does not affect scoring.
- **Start date on the project card** is shown read-only. PMs edit it in Settings, not inline.
- **Notifications** are in-app only. Times are shown in Asia/Ho_Chi_Minh.
- **Change log** is a simple per-task activity list, not a full audit.

## Not built yet

- Real login (SSO or email/password). The account cookie is the only identity today. [src/lib/session.ts](src/lib/session.ts) is the single place to change.
- Row Level Security. The app reads and writes through the server with the service role key, so the browser never touches the tables. Turn on RLS and bind policies to the signed-in member when real auth arrives.
- Email, Slack or Teams delivery.

## Free-tier notes

- Supabase free projects pause after about a week without activity. Open the app to wake it, or upgrade if the team needs it always on.
- Vercel Hobby is fine for a small team. Cron is limited to once a day, which is what the alert rules need.

## Demo project

To see the dashboard with realistic data, run the migration first, then:

    npm run seed:demo

This creates "Payment Gateway v2 (demo)", halfway through its flow, with struggles on several tasks. Running it again replaces only the demo project.
