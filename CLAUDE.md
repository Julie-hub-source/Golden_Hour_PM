# CLAUDE.md — Golden Hour (formerly Pulse)

Slides: [Golden Hour walkthrough (Google Drive)](https://drive.google.com/file/d/1GIioVXvIGZQnRBGiSX-N0d4D8qqeCaUZ/view?usp=sharing) · also in the repo as [GOLDEN_HOUR_SLIDES.pdf](GOLDEN_HOUR_SLIDES.pdf).

Business logic specification for Golden Hour (formerly Pulse), a web app for tracking project delivery. This file describes WHAT the system must do. The implementation lives in this repository (Next.js, Supabase, Vercel); the spec and the code must agree.

Items marked **[DEFAULT]** were not explicitly confirmed, so the default is the working rule. Items marked **[OPEN]** still need a decision before implementation.

---

## 1. Purpose

Projects slip one stuck task at a time, and managers learn about it at the deadline. Golden Hour shows:

1. Where each project is heading: projected completion against the client commitment, and how likely a late finish is.
2. Which tasks have open struggles or are late, who owns them, and which tasks depend on them.
3. What to fix first.

---

## 2. Accounts and access

- **No authentication in this phase.** Each team member has one account, seeded from the member list. Account = member (name + global role).
- A **user switcher** in the header lets anyone switch to any account. This is for demo and internal use. It is not security.
- Real authentication (SSO or email/password) is out of scope for now. Keep the permission checks in one place so they can later be bound to a real session.
- Because there is no login, permissions must still be modelled per account so that the behaviour can be demonstrated correctly.

Global roles: `PM`, `PO`, `BA`, `Designer`, `FE`, `BE`, `QC`. A member can belong to several projects. Their role is the same in all of them.

---

## 3. Roles and permissions

| Action | PM | PO | Other members (BA, Designer, FE, BE, QC) |
|---|---|---|---|
| Create project | ✅ | ❌ | ❌ |
| Edit project start date | ✅ | ❌ | ❌ |
| Change project priority | ✅ | ❌ | ❌ |
| Edit client commit dates (UAT / STG / Prod) | ✅ | ✅ | ❌ |
| Edit project description (context, client info, documents) | ✅ | ✅ | ❌ |
| Add / remove members of a project | ✅ | ❌ | ❌ |
| Delete project | ✅ | ❌ | ❌ |
| Create / delete task | ✅ | ✅ | ❌ |
| Rename task, edit task deadline | ✅ | ✅ | ❌ |
| Edit depends on (task dependencies) | ✅ | ✅ | ❌ |
| Change PIC of a task | ✅ | ✅ | Only tasks where they are PIC (confirmed) |
| Change duration of a task | ✅ | ✅ | Only tasks where they are PIC |
| Change status | ✅ | ✅ | Only tasks where they are PIC |
| Edit task description | ✅ | ✅ | Only tasks where they are PIC |
| Add output link on a task | ✅ | ✅ | Only tasks where they are PIC |
| Add a struggle, or mark it solved | ✅ | ✅ | Only tasks where they are PIC |

A project can be locked against deletion (projects.task_delete_locked, migration 004). A locked project cannot have its tasks deleted, and the project itself cannot be deleted; Settings shows a note instead of the delete button. Locking applies to everyone, including PM. The demo project is locked; projects created later are not.

Notes:
- Permissions are enforced on the server as well as in the UI.
- A PIC who hands a task to someone else loses edit rights on it. Handover is therefore a PM/PO or PIC action.
- Confirmed: every member can change PIC and duration on their own tasks only. This replaces the earlier rule that all members can change them on any task.

---

## 4. Core concepts

- **Project**: name, start date, client commitment dates, priority, description (context, client info, related documents), member list, task list.
- **Member / account**: name, global role.
- **Task**: see section 6.
- **Environment**: an explicit field on each task: `UAT`, `STG` or `Prod`. It is set when the task is created from the flow, and can be set for custom tasks. It is **not** derived from the phase name.
- **Working day**: Monday to Friday. Saturday and Sunday are never working days. **No public holidays** are configured.
- **Duration**: whole working days, integer 0–20 in the UI. Zero means the task takes no time. (Half days: [DEFAULT] not supported.)
- **Depends on**: an upstream task that must finish before this task can start. Stored as a list of task IDs (field `blockedBy`). Use "depends on" only for task-to-task links.
- **Struggle**: something outside the team's control that holds a task up (for example, a vendor API not delivered). It needs a reason. A task can have many struggles. Each one is shown as a flame 🔥 on the timeline, the dependency tree and the board. Marking it solved crosses the flame out. A task is **blocked** while it has at least one unsolved struggle.
- **Closed**: final status. A closed task takes 0 days and does not block its successors.
- **Today**: the real system date in the project's timezone, **Asia/Ho_Chi_Minh** [DEFAULT]. Not user-editable.

---

## 5. Default flow (created with every project)

Thirteen steps, 35 tasks. Every task in a step depends on **all** tasks of the previous step. Tasks inside one step run in parallel. In each Test & Debug step, the QC test task, the BE debug task and the FE debug task all run in parallel.

| # | Phase | Environment | Tasks (role, default working days) |
|---|---|---|---|
| 1 | Prepare documents | UAT | Prepare business documents (BA, 3); Prepare product documents (PO, 3) |
| 2 | Dev UAT | UAT | Dev front-end UAT (FE, 4); Dev back-end UAT (BE, 5) |
| 3 | Test & Debug UAT | UAT | Test UAT (QC, 2); Debug UAT (BE, 2); Debug front-end UAT (FE, 2) |
| 4 | Internal acceptance UAT | UAT | QC, BA, PO (1 each) |
| 5 | Customer acceptance UAT | UAT | QC, BA, PO (2 each) |
| 6 | Dev STG | STG | Dev front-end STG (FE, 4); Dev back-end STG (BE, 5) |
| 7 | Test & Debug STG | STG | Test STG (QC, 2); Debug STG (BE, 2); Debug front-end STG (FE, 2) |
| 8 | Internal acceptance STG | STG | QC, BA, PO (1 each) |
| 9 | Customer acceptance STG | STG | QC, BA, PO (2 each) |
| 10 | Dev Prod | Prod | Dev front-end Prod (FE, 2); Dev back-end Prod (BE, 2) |
| 11 | Test & Debug Prod | Prod | Test Prod (QC, 2); Debug Prod (BE, 2); Debug front-end Prod (FE, 2) |
| 12 | Internal acceptance Prod | Prod | QC, BA, PO (1 each) |
| 13 | Customer acceptance Prod | Prod | QC, BA, PO (2 each) |

Creation rules:
- Each task gets an owner: the first project member whose role matches the task role. If none, the task is unassigned.
- Task IDs are sequential per project (`T01`, `T02`, …). New tasks take the next number. Deleted IDs are not reused.
- Each task's **deadline** is set to its planned finish at creation time.
- Each environment's **client commit** defaults to the happy-case completion of that environment (section 8). The Prod commit defaults to the date entered at creation.
- Creation form: name, start date, Prod commit date (both use the date field below), member checkboxes. Priority defaults to Medium.

---

## 6. Task data

| Field | Type | Rules |
|---|---|---|
| id | uuid | internal |
| code | string | `T` + 2-digit sequence, unique per project |
| name | string | required, non-empty |
| phase | string | one of the flow phases, or `Custom` |
| environment | enum | `UAT`, `STG`, `Prod`. Explicit, not derived |
| role | enum | role the task was designed for. Blank for custom tasks |
| pic | member id or null | any project member |
| status | enum | `todo`, `in_progress`, `uat`, `stg`, `prod`, `closed`. Labels: To do, In progress, In test (UAT), In test (STG), In test (Prod), Closed |
| duration | int 0–20 | working days |
| deadline | date | planned end for this task (inclusive) |
| blockedBy | list of task ids | depends on: must not create a cycle |
| blocked | bool | derived: true while at least one struggle is unsolved |
| struggles | list of {reason, createdBy, createdAt, solvedAt} | one flame each. Reason required. Solved when solvedAt is set |
| description | text | optional |
| outputs | list | optional. Each item: type (PRD, SRS, Test case, Test evidence, Design, Meeting notes, Code / PR, Other), **URL**, added by, added at |
| sinceMs | date | date of the last status change. Used for the To-do alert |
| alerts | set | alerts already sent for this task: `late`, `todo`. Reset when status or deadline changes |

Notes:
- Status and environment are independent. A task in environment UAT can have status "In test (STG)". Allow it and do not auto-correct.
- Outputs are **links only** (URL). No file upload and no file storage. The link is validated as an absolute http(s) URL.
- Deleting a task removes it from other tasks' blockedBy lists. Its outputs are deleted with it [DEFAULT].

### 6.1 Creating a task (draft flow)

- "+ Add task" opens a draft. Nothing is saved yet.
- The popup shows **Delete** and **Create** side by side. Delete discards the draft. Create saves it, assigns the next ID, and notifies the project.
- Closing the popup without Create discards the draft.
- A draft needs a name that is not the default placeholder before it can be created.

---

## 7. Scheduling engine

Both calculations use working days only.

### 7.1 Dependency schedule

Used for: timeline lanes, critical path, slack, what-if, priority.

Work on a working-day index: index 0 is the first working day on or after the project start date.

- Only **active** dependencies count: a dependency is active if it is not closed.
- For each open task `t`:
  - `ES(t) = max(EF(d))` over active dependencies `d`; 0 if none
  - `EF(t) = ES(t) + duration(t)` (exclusive index)
- Closed tasks do not delay their successors. An open task still starts after the planned finish of its Closed predecessors (the date the Closed task was planned to finish), not on project day 0.
- `finishIdx = max(EF)`.
- Backward pass: `LF(t) = min(LS(s))` over open successors `s`, or `finishIdx` if none; `LS(t) = LF(t) − duration(t)`; `slack(t) = LF(t) − EF(t)`.
- A task is **on the critical path** when it is open and `slack ≤ 0`.
- Dates: start date of `t` = calendar date of working day `ES(t)`. End date (inclusive) = calendar date of working day `EF(t) − 1`. A zero-duration task uses its start date for both.

### 7.2 Happy-case schedule

Used for: the environment timeline table and the client commitment comparison.

- Environments run in order: UAT, then STG (only if the project has STG tasks), then Prod.
- Within an environment, open tasks run **one after another** in flow order, regardless of parallelism. The total is the sum of their durations.
- Each environment starts on the working day after the previous environment finishes. The first starts at index 0.
- Completion of an environment = last working day of its last open task. If all its tasks are closed, the environment is finished: it still shows its planned start and completion dates, and its column header reads "UAT (done)". Later environments start after those planned dates.
- Closed tasks take no time.

### 7.3 Complete date (project list)

- Complete date = start date + longest chain of working days through depends-on links.
- Tasks in parallel are counted once.
- **All tasks count at their planned duration, regardless of status** (confirmed). It is a planned date, not a projection.

### 7.4 Projected completion and late probability

- Projected Prod completion = happy-case completion of Prod.
- **Late probability** (kept, confirmed): run 1,500 simulations. In each run, multiply the duration of every open task by a random factor, then round to a whole day with a minimum of 1:
  - tasks with an open struggle: triangular(min 1.0, mode 1.5, max 2.2)
  - other open tasks: triangular(min 0.9, mode 1.05, max 1.4)
  - closed tasks: 0
  Recompute the happy-case Prod completion for each run. Late probability = share of runs finishing after the Prod commit.
- Health colour: red if projected Prod completion is after the Prod commit; amber if late probability > 30%; green otherwise.
- Run the simulation server-side and cache it per project. Recompute when tasks, durations, statuses, dependencies, struggles, or commits change.

### 7.5 Changing the start date

- Only PM may change it.
- Task deadlines shift by the same number of working days... [DEFAULT: calendar days].
- Client commit dates keep their **calendar** dates. Their stored offsets are recalculated.

---

### 7.6 Late tasks

- A task is **late** only when all hold: its status is not Closed, its deadline is strictly before today (Asia/Ho_Chi_Minh), and it has started (its projected start is today or earlier). A deadline of today or later is never late. A task that has not started yet is never late, even if its original deadline has passed.
- **Late working days** = working days after the deadline, up to and including today.
- When a task first becomes late, one notification goes to every member of the project:
  `LATE: T04 "Dev back-end UAT" passed its deadline (Mon 13/10/2026) by 4 working day(s). PIC: Binh.`
  It is sent once per task. It is sent again only if the deadline changes or the task is reopened.
- **Late task bars end today.** A late task is still running, so its projected finish is today (the last working day on or before today), not later. Its bar covers the start up to today.
- **Shifted successors.** A task that has not started yet has its start and end moved by the late working days of the tasks before it. It is not late, so it shows no Late tag. If its end passes its own deadline, it shows red stripes.
- Each successor starts after the projected finish of all its open predecessors. A late predecessor therefore pushes each successor by exactly its late working days, once. The delay is not added again at each step down a chain. Closed predecessors push nothing.
- The happy-case environment timeline (7.2) and the Monte Carlo (7.4) are not changed by late tasks. Only the dependency schedule (Gantt, dependency tree, what-if, priority) is.

---

## 8. Timeline by environment (Health)

- Columns: UAT, STG (only if the project has STG tasks), Prod.
- Row "0) Start": start of the environment in the happy case (planned start if finished).
- Row "1) Task completion (projected)": happy-case completion (planned completion if finished).
- Row "Late (working days)": total late working days of the open tasks in that environment, shown as +N (section 7.6). Late days are added to the environment the task belongs to: its completion moves by the same number, and every following environment moves by the same number.
- Row "2) Client commitment": editable date per environment (PM/PO). Saved automatically: picking a day in the calendar, or typing a valid date and leaving the field, saves it. There is no Save button.
- Dates in these rows use the app date format (see section 14).
- Row "Buffer": commit minus completion, in working days. Green if buffer, red if late. Shown for finished environments too.

---

## 9. Task timeline (dashboard tab)

- **One lane per person** (confirmed). Each lane is labelled with name and role. Lanes are ordered by role: PO, BA, Designer, FE, BE, QC (PM has no lane of its own). Unassigned tasks go in a last lane labelled "Unassigned".
- Each open task is a **coloured segment** from its dependency-schedule start date to its inclusive end date. Colour is fixed per person.
- Overlapping tasks of the same person stack into extra sub-rows in that lane.
- Hover: code and name, phase and environment, start → end, working-day duration, status, each struggle reason with its flame, if any. The title appears only on hover.
- Click: opens the task detail popup.
- Each bar is split at the deadline: the person's colour up to the deadline, then red diagonal stripes (background #FCEBEB, stripes #E24B4A at about 45% opacity, 45°) from the day after the deadline to the projected finish. Any task pushed past its own deadline shows stripes, late or not. A late task also shows a small "Late" tag. A task that has not started yet (its start is after today) is drawn in its normal colour, with no stripes and no Late tag, even if its deadline has passed.
- Marks: critical path (amber outline), open struggle (red outline, one 🔥 per struggle, crossed out when solved), dashed red line at the Prod commit date, solid blue line at today's date (Asia/Ho_Chi_Minh) labelled "Today".
- **Weekends** (Saturday and Sunday) are shaded grey in every lane. No task occupies a weekend.
- Horizontal scrolling. Fixed width per calendar day (26 px). Lane labels stay visible while scrolling. A date label appears at every Monday (app date format, section 14). The timeline shows the whole project from the first task to the last: Closed tasks are included, greyed out with a tick, and use their planned dates.
- **Size follows the content.** The timeline has one lane per person, so its height grows and shrinks with the team size. Its width grows and shrinks with the plan length (from the Monday on or before the earliest date, including today, to a week after the latest date, including the Prod commit). No fixed height, and no extra padding below the lanes.
- The hover card is drawn above the page, so it is never clipped by the scroll area.

---

## 10. Views

### 10.1 Projects list
- Card per project: name, priority dropdown (PM edits), complete date (7.3), client commit (Prod), member count, task count, progress (closed / total). The start date is edited in Settings, not on the card.
- Clicking a card opens the project's Dashboard and Estimation tab.

### 10.2 Task Board
- The project description panel is not on the Task Board. It moved to the top of Dashboard and Estimation (Health tab).
- Filters: PIC, environment (only environments present in the project), status. Combined with AND.
- Six status columns. Card shows code, name, environment, phase, unfinished dependencies, deadline, PIC dropdown, duration dropdown, status dropdown, and a 🔥 for each struggle.
- Clicking a card opens the task detail popup.

### 10.3 Task detail popup
In order:
1. Task ID, phase, environment
2. PIC (dropdown) and PIC role
3. Duration (dropdown 0–20 working days)
4. Status (dropdown)
5. Task deadline (date field, section 14)
6. Description (textarea)
7. Depends on (multi-select of tasks; closed ones labelled "closed, not blocking")
8. Tasks that depend on this one (downstream): open tasks that depend on it directly or indirectly. First 3 shown, rest behind "Show more"
9. Projected start → finish (dependency schedule)
10. Slack in working days, or the critical-path marker
11. Struggles: one row per struggle with a 🔥, its reason, and a Solved / Reopen button. Add form with a required reason.
12. Outputs (optional): list of links with type, added by and time. Add form: type dropdown, URL field, Add button
Buttons: Delete (PM/PO), Create (drafts only).

### 10.4 Dashboard and Estimation (tabs)
- **Health & workload**: project description panel first (collapsible: Context, Client info, Related documents, one per line "Name | link"), then banner (state, projected Prod completion vs commit, late probability); four key figures shown as boxes in a row: projected Prod completion (happy case), client commitment (Prod), buffer (working days between commitment and projection, positive = spare, negative = late, 0 = right at the deadline), and progress (Closed tasks / total, with %). Labels are in English; environment timeline (section 8); workload by person across all projects (name, role, projects, open tasks). The simulated Prod completion histogram is not shown. The simulation still runs for the late probability and the P50/P80 range.
- **Task timeline**: section 9.
- **What-if**: pick an open task and an extra delay of 0–10 working days. Shows new projected finish, added delay, buffer or lateness vs Prod commit, and the list of pushed-back tasks.
- **Priority**: section 11.
- No "Today" control: the date is the system date.

### 10.5 Team
- Team table with open-task count per member. PM creates new members (name + role); creating a member also creates their account. Adding existing members to a project, and removing members (their open tasks become unassigned), is done in that project's Settings.

### 10.6 Notifications
- Per account: list with time and project, unread highlight, "Mark all as read". Header bell with unread count.

---

## 11. Priority level

Each open task gets a level from today's date (system date in Asia/Ho_Chi_Minh), counted in working days:
- **Highest**: the task is overdue (its planned end has passed), or today falls inside its planned window.
- **High**: it starts 1 to 3 working days from today.
- **Medium**: it starts 4 to 5 working days from today.
- **Low**: it starts more than 5 working days from today.
- **Struggles**: a task with more than 2 open struggles moves up one level. Highest stays Highest. "Open" means not solved.

Tasks are listed by level, then by score (highest first), then by planned start.
- **Late**: a task that is late (section 7.6) is always the top level, above Highest. Open struggles do not change it.
- **Score** = (downstream + 1) × risk ÷ max(duration, 1). Risk: late 4, open struggle 3, critical path 2, otherwise 1. Downstream = open tasks that depend on it, directly or indirectly. Each row also gives the reason for its level and a suggested action: open struggle → "Solve struggle: <reason>"; critical path → "Prioritise resources, do not let it slip"; otherwise → "Monitor and be ready to help".

Project priority (Highest, High, Medium, Low, Lowest) is a label only **[DEFAULT]**. It does not affect ordering or scoring.

---

## 12. Alerts and notifications

### 12.1 Alert rules (confirmed)
Checked daily by the cron job against the real system date (Asia/Ho_Chi_Minh). The app also checks when a project page loads, at most once every 10 minutes per server instance. Each alert is sent once per task until the relevant field changes.

1. **Late**: an open task whose deadline is strictly before today (section 7.6). Send to every member of the project, then set `alerts.late`. Reset `alerts.late` only when the deadline changes or the task is reopened.
   Message: `LATE: {code} "{name}" passed its deadline ({deadline}) by {n} working day(s). PIC: {pic}.`
2. **To do too long**: status is `todo` and more than 2 working days have passed since `sinceMs`. Send to every member, then set `alerts.todo`.
   Message: `⚠ {code} "{name}" has been To do for {n} working days. PIC: {pic}.`

Reset `alerts` when status or deadline changes.

### 12.2 Other notifications
Sent to PM, PO and the PIC, excluding the actor:
- Status change, PIC change (also to the new PIC directly), duration change, deadline change, struggle added or solved, depends-on change, output link added, description change.

Sent to every member of the project:
- Task added, renamed or deleted.
- Project description, client commit, priority or start date changed.

Sent to that member only: added to or removed from a project.

Delivery: in-app only for now [DEFAULT].

---

## 13. Validation

- Dates use the date field in section 14. Typed text that is not a real date shows an inline error under the field and is not saved.
- Task name required. A reason is required when adding a struggle.
- Duration integer 0–20.
- Depends-on must not create a loop. Reject with a message if the new dependency already depends on the task, directly or indirectly.
- A task cannot depend on itself.
- Output URL must be an absolute http or https URL.
- Project needs a start date and a Prod commit date.

---

## 14. Calendar

- **Display format** everywhere in the app (timeline, tables, popups, notifications, complete date): English three-letter weekday, then D/M/YYYY, with no zero padding. Example: `Tue 1/1/2027`.
- **Date input**: clicking a date field opens a month calendar; clicking a day fills the field. The field can also be typed in D/M/YYYY. Both produce the same stored value. Text that is not a valid date shows an inline error under the field and is not saved.
- Apply this to: project start date, client commitment dates (UAT, STG, Prod), task deadlines, complete date, timeline axis labels, the environment timeline, notifications and popups. Permissions for editing dates stay as in section 3.
- Demo data: `npm run seed:demo` creates a demo project halfway through its flow, with struggles on several tasks. Today is taken from the system date, so the project stays mid-flow when it is run.
- Working days: Monday to Friday.
- Start date can be any calendar date. Index 0 is the first working day on or after it.
- No public holidays.
- Timezone for "today": Asia/Ho_Chi_Minh [DEFAULT].

---

## 15. Non-functional notes

- Data is stored in Supabase (PostgreSQL). All reads and writes go through server code with server-side permission checks.
- Store dates as calendar dates. Store `sinceMs` as a date, not a timestamp.
- The simulation must return quickly for interactive use. Compute it server-side and cache it.
- Audit trail: [DEFAULT] keep a simple change log per task (who, what, when). Full audit is open (Q6).

---

## 16. Glossary

- **Depends on / blockedBy**: an upstream task that must finish before this one starts.
- **Downstream**: tasks that depend on this one, directly or indirectly.
- **Struggle**: an external blocker with a reason, shown as a flame. Solved struggles are crossed out.
- **Critical path**: open tasks with zero slack. Any delay on them delays the project.
- **Slack**: working days a task can slip without moving the project finish.
- **Happy case**: sequential estimate per environment (7.2).
- **Client commitment**: date promised to the client for an environment.
- **Buffer**: working days between projected completion and the commitment. Negative means late.
- **PIC**: person in charge of a task.
- **Draft**: a task that has not yet been created.
## Naming

- Member names are plain English first names with no role in the name (for example Alex, Ben). The role is shown after a dot, as **Name.Role**, for example `Alex.PM`, in dropdowns, lists, the timeline and the dependency tree.
