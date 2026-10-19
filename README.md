# Golden Hour

**Golden Hour** is an early-warning tool for project delivery. It shows where each project is heading against the client's Prod commitment, which tasks are stuck or late, who owns them, and what to fix first.

**Try it:** https://golden-hour-pm.vercel.app/

The app is a shared demo. There is no login: use the **Signed in as** menu at the top right to act as any team member. Permissions still apply to whichever member you pick, so you can see what each role is allowed to do.

---

## Start here

1. Open the **Projects** page. Each card shows the project's complete date, Prod commitment, member count, and progress.
2. Open **Payment Gateway v2 (demo)**. It is halfway through a 35-task flow, so the screens already show late tasks, struggles and a few finished steps.
3. Switch between the three project tabs:
   - **Dashboard and Estimation**: is the project on track?
   - **Task Board**: what is each task doing right now?
   - **Settings**: dates, commitments, description, members.

The demo project is locked: tasks cannot be deleted in it, and the project itself cannot be deleted. Projects you create yourself can be deleted.

---

## How to test with different accounts

The app has **no sign-in yet**. Instead, you can switch to any team member at any time, so you can check what each role is allowed to do.

1. Look at the **Signed in as** menu in the top-right corner. It lists every member with their role, for example `Alex.PM` or `Ben.PO`.
2. Pick a member. The current account is saved in your browser, so it stays the same until you switch again.
3. Open a project and try an action: change a status, a commitment date, or a deadline. Some controls will be disabled, which is the permission rule at work.
4. Switch to another member and try the same action again.

Suggested test order:

| Account | What to check |
|---|---|
| `Alex.PM` (PM) | Everything: create a project, change the start date and priority, add or remove members, delete an unlocked project |
| `Ben.PO` (PO) | Edit commitments, description, tasks and dependencies. Cannot change the start date, priority or members |
| `Chloe.BA`, `Emma.FE`, `Frank.BE`, `Grace.QC` (team) | Only change the tasks they own: status, duration, PIC, output links, struggles |

Notes for testing:
- Permissions are checked on the server, so a disabled control cannot be bypassed by a direct request.
- The **Payment Gateway v2 (demo)** project is locked: its tasks and the project itself cannot be deleted, even by PM.
- Changes are shared: everyone who opens the app sees the same data. Please leave the demo project in a reasonable state for the next person.

## Key ideas

### Projects and the default flow
Every new project gets the same 13-step flow with 35 tasks, from **Prepare documents** through **Dev**, **Test & Debug**, **Internal acceptance** and **Customer acceptance** in UAT, STG and Prod. Each step depends on all tasks of the step before it. Tasks in the same step run in parallel. Each task has an owner (PIC) chosen by role.

### Dates
Every date in the app uses one format: weekday, then day/month/year, with no zero padding. For example `Tue 1/1/2027`.
- Click a date field to open a calendar and pick a day, or type the date as `D/M/YYYY`.
- Typed text that is not a real date shows an error under the field and is not saved.
- Dates are working days only: Monday to Friday. No public holidays are set.

### Tasks, dependencies and status
- **Depends on** means one task must finish before another can start.
- **Status** is one of To do, In progress, In test (UAT), In test (STG), In test (Prod), or Closed.
- **Closed** tasks keep their planned dates and do not hold up the tasks after them.

### Struggles (🔥)
A **struggle** is something outside the team's control that holds a task up, such as a vendor API that has not arrived. Each struggle has a reason and appears as a 🔥 on the Task Board, the Gantt chart and the dependency tree.
- An **open** struggle is a bright flame.
- A **solved** struggle is a flame with a line through it.
- A task can have several struggles, and it is blocked while any of them is open.

### Late tasks
A task is **late** when all of these are true:
- it is not Closed,
- its deadline is before today,
- and it has started.

A late task's bar on the Gantt chart ends today. Tasks after it move later by the same number of working days. A task that has not started yet is never late, even if its original deadline has passed. Each late task sends one notification to the project members.

### Priority
The **Priority** table tells you what to look at first. Its level is based on today's date:

- **Late**: the deadline has passed. Always the top level.
- **Highest**: overdue, or planned for today.
- **High**: starts in 1 to 3 working days.
- **Medium**: starts in 4 to 5 working days.
- **Low**: starts in more than 5 working days.
- A task with more than 2 open struggles moves up one level.

Within a level, tasks are ordered by a score:

`Score = (dependents + 1) × risk ÷ duration`

Risk is 4 for a late task, 3 for a task with an open struggle, 2 for a task on the critical path, and 1 otherwise. Dependents are the open tasks that depend on this one, directly or indirectly.

---

## The pages

### Dashboard and Estimation
- **Project description** at the top: context, client information, and related documents.
- **Four key figures**, each in its own colour:
  - Projected Prod completion (the end date of the current plan),
  - Client commitment (Prod),
  - Buffer (working days between the commitment and the projection; negative means late),
  - Progress (closed tasks out of total tasks).
- **Environment timeline**: for UAT, STG and Prod, the start date, projected completion, late working days, the client commitment, and the buffer. Change a commitment date and it saves straight away.
- **Workload by person** across all projects: role, number of projects, and open tasks.
- **Task timeline** (Gantt chart): one lane per person, the whole project from first task to last. Closed tasks use their planned dates. Late tasks show a red **Late** tag. Stripes mark the part of a bar that runs past its deadline. The red dashed line is the Prod commitment, and the blue line is today. Click a bar to open the task.
- **Dependency tree**: tasks flow left to right. Tasks in the same column run in parallel. Late tasks are shaded red with a "Late +N wd" label.
- **What-if**: pick an open task and add 0–10 working days of delay to see how the finish date and the buffer change.
- **Priority**: the ranked list described above, with each task's status colour.

### Task Board
Six columns, one per status. Each card shows the task code and name, its environment, its deadline, the tasks it depends on, its owner, duration and status, and one 🔥 per struggle. Use the filters at the top to narrow the board by PIC, environment or status. Click a card to open the task.

### Task detail (popup)
Shows the task's owner, duration, status, deadline, description and dependencies, the tasks that depend on it, its projected dates and slack, its struggles, and any output links. Here you can:
- add a struggle with a reason, and mark it solved or reopen it,
- add an output link (PRD, SRS, test evidence, code, and so on),
- delete the task, unless the project is locked.

### Settings
- Start date, priority, and client commitment dates (UAT, STG, Prod).
- Project description, including related documents (one per line, as `Name | https://link`).
- Members: add or remove people from the project (PM only).
- Delete project (PM only, hidden for locked projects).

### Team
Everyone in the team, their role, and their open tasks across all projects. PM can add a new member here.

### Notifications
In-app notifications for changes in your projects, with a bell and an unread count in the header.

---

## Who can do what

| Action | PM | PO | Other members |
|---|---|---|---|
| Create project, change start date or priority, delete project | ✅ | ❌ | ❌ |
| Change client commitment dates, description, dependencies | ✅ | ✅ | ❌ |
| Create or delete tasks, rename tasks, change deadlines | ✅ | ✅ | ❌ |
| Change owner, duration, status, description, output links, struggles | ✅ | ✅ | Only on tasks they own |
| Add or remove project members | ✅ | ❌ | ❌ |

Permissions are checked on the server, so they hold even if a control is hidden or a request is changed.

---

## Improvement plan

Ideas for the next iterations, roughly in priority order:

1. **Authentication.** Replace the "Signed in as" menu with real sign-in (email and password, or SSO such as Google Workspace). Use Supabase Auth and Row Level Security so each person only reads and writes the projects they belong to. Permission checks already live in one module (`src/lib/permissions.ts`), so they can be bound to the session without rewriting the rules.
2. **Jira sync.** Import epics and stories as tasks, map Jira statuses to Golden Hour statuses, and push status and deadline changes back. Start with a one-way import, then add two-way sync with conflict rules (Jira wins for status, Golden Hour wins for commitments).
3. **Notifications outside the app.** Send the LATE and To-do alerts to Slack or Microsoft Teams, and to email as a daily digest. Today they are in-app only.
4. **Change history.** Keep a full audit trail per task and per project (who changed what, and when), with the before and after values. Today there is a simple activity log per task.
5. **Scenario comparison.** Let the what-if tab save several scenarios side by side, for example "slip Dev back-end by 3 days" against "add a second developer", and show each one's finish date and buffer.
6. **Weekly snapshots.** Store the projected finish and buffer once a week, so the dashboard can show whether a project is getting better or worse over time.

## For developers

### Stack
Next.js 16 (App Router, TypeScript) · Supabase Postgres · Vercel. The database is in the **ap-northeast-2 (Seoul)** region, and the functions run in Vercel's **icn1 (Seoul)** region.

### Repository layout
| Path | What it is |
|---|---|
| `src/lib/calendar.ts` | Working days, date parsing and formatting, Asia/Ho_Chi_Minh "today" |
| `src/lib/schedule.ts` | Dependency schedule, lateness, happy case, simulation, priority, what-if |
| `src/lib/permissions.ts` | All permission rules in one place |
| `src/lib/repo.ts` | Database reads (cached per request) |
| `src/app/actions.ts` | All writes, as server actions |
| `src/components/` | Timeline, dependency tree, task detail, date field, and other UI parts |
| `supabase/schema.sql` | Full schema for a new database, with the seed members |
| `supabase/migrations/` | Changes for databases created from earlier schemas |
| `scripts/seed-demo.ts` | Creates the demo project |
| `tests/engine.test.ts` | Tests for the scheduling engine, permissions and alerts |
| `CLAUDE.md` | The business rules this app implements |

### Run it locally
1. Create a Supabase project.
2. Run `supabase/schema.sql` in the SQL Editor. Then run the migrations in order: `002_task_issues.sql`, `003_member_names.sql`, `004_lock_task_delete.sql`.
3. Copy `.env.example` to `.env.local` and fill in:
   - `NEXT_PUBLIC_SUPABASE_URL`: the Project URL,
   - `SUPABASE_SERVICE_ROLE_KEY`: the `service_role` key (server only, never prefixed with `NEXT_PUBLIC_`),
   - `CRON_SECRET`: any long random string.
4. Install and start:

```bash
npm install
npm run dev        # http://localhost:3000
```

Other commands:

```bash
npm test           # scheduling, permission and alert tests
npm run typecheck  # TypeScript check
npm run seed:demo  # create or recreate the demo project
```

### Deploy on Vercel
1. Push the repository to GitHub.
2. In Vercel, choose **Add New → Project** and import the repository. Next.js is detected automatically.
3. Add the three environment variables above for Production.
4. Deploy. `vercel.json` sets the function region and a daily cron at 01:00 UTC (08:00 in Vietnam) that sends the alert notifications.

### Notes
- There is no sign-in yet. Anyone with the link can act as any member. Use this for demos and internal review only.
- Supabase's free tier pauses projects after about a week without activity. The first load after a pause can be slow.
