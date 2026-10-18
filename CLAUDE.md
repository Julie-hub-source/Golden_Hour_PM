# CLAUDE.md — Pulse (Early Warning System)

Business logic specification for building Pulse as a real web app. This file describes WHAT the system must do. The HTML prototype (`pulse_prototype_v9.html`) shows the intended UI and can be used as a visual reference, but its code is not an architecture template.

Items marked **[DEFAULT]** were not explicitly confirmed. Implement the default and flag it in the pull request. Items marked **[OPEN]** must be asked before implementation (see section 16).

---

## 1. Purpose

Projects slip one blocked task at a time, and managers learn about it at the deadline. Pulse shows:

1. Where each project is heading: projected completion against the client commitment, and how likely a late finish is.
2. Which tasks are blocked or late, who owns them, and what they block.
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
| Create / delete task | ✅ | ✅ | ❌ |
| Rename task, edit task deadline | ✅ | ✅ | ❌ |
| Edit Blocked by (dependencies) | ✅ | ✅ | ❌ |
| Change PIC of a task | ✅ | ✅ | Only tasks where they are PIC (confirmed) |
| Change duration of a task | ✅ | ✅ | Only tasks where they are PIC |
| Change status | ✅ | ✅ | Only tasks where they are PIC |
| Edit task description | ✅ | ✅ | Only tasks where they are PIC |
| Add output link on a task | ✅ | ✅ | Only tasks where they are PIC |
| Flag / clear "blocked" issue | ✅ | ✅ | Only tasks where they are PIC |

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
- **Blocked by**: tasks that must finish before this task can start. Stored as a list of task IDs.
- **Closed**: final status. A closed task takes 0 days and does not block its successors.
- **Today**: the real system date in the project's timezone, **Asia/Ho_Chi_Minh** [DEFAULT]. Not user-editable.

---

## 5. Default flow (created with every project)

Thirteen steps. Every task in a step is blocked by **all** tasks of the previous step. Tasks inside one step run in parallel.

| # | Phase | Environment | Tasks (role, default working days) |
|---|---|---|---|
| 1 | Prepare documents | UAT | Prepare business documents (BA, 3); Prepare product documents (PO, 3) |
| 2 | Dev UAT | UAT | Dev front-end UAT (FE, 4); Dev back-end UAT (BE, 5) |
| 3 | Test & Debug UAT | UAT | Test UAT (QC, 2); Debug UAT (BE, 2) |
| 4 | Internal acceptance UAT | UAT | QC, BA, PO (1 each) |
| 5 | Customer acceptance UAT | UAT | QC, BA, PO (2 each) |
| 6 | Dev STG | STG | Dev front-end STG (FE, 4); Dev back-end STG (BE, 5) |
| 7 | Test & Debug STG | STG | Test STG (QC, 2); Debug STG (BE, 2) |
| 8 | Internal acceptance STG | STG | QC, BA, PO (1 each) |
| 9 | Customer acceptance STG | STG | QC, BA, PO (2 each) |
| 10 | Dev Prod | Prod | Dev front-end Prod (FE, 2); Dev back-end Prod (BE, 2) |
| 11 | Test & Debug Prod | Prod | Test Prod (QC, 2); Debug Prod (BE, 2) |
| 12 | Internal acceptance Prod | Prod | QC, BA, PO (1 each) |
| 13 | Customer acceptance Prod | Prod | QC, BA, PO (2 each) |

Creation rules:
- Each task gets an owner: the first project member whose role matches the task role. If none, the task is unassigned.
- Task IDs are sequential per project (`T01`, `T02`, …). New tasks take the next number. Deleted IDs are not reused.
- Each task's **deadline** is set to its planned finish at creation time.
- Each environment's **client commit** defaults to the happy-case completion of that environment (section 8). The Prod commit defaults to the date entered at creation.
- Creation form: name, start date (dd/mm/yy), Prod commit date (dd/mm/yy), member checkboxes. Priority defaults to Medium.

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
| blockedBy | list of task ids | must not create a cycle |
| blocked | bool | issue flag, independent of blockedBy |
| blocker | string | required when blocked = true |
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

- Only **active** blockers count: a blocker is active if it is not closed.
- For each open task `t`:
  - `ES(t) = max(EF(d))` over active blockers `d`; 0 if none
  - `EF(t) = ES(t) + duration(t)` (exclusive index)
- Closed tasks: `ES = EF = 0`, and they gate nothing.
- `finishIdx = max(EF)`.
- Backward pass: `LF(t) = min(LS(s))` over open successors `s`, or `finishIdx` if none; `LS(t) = LF(t) − duration(t)`; `slack(t) = LF(t) − EF(t)`.
- A task is **on the critical path** when it is open and `slack ≤ 0`.
- Dates: start date of `t` = calendar date of working day `ES(t)`. End date (inclusive) = calendar date of working day `EF(t) − 1`. A zero-duration task uses its start date for both.

### 7.2 Happy-case schedule

Used for: the environment timeline table and the client commitment comparison.

- Environments run in order: UAT, then STG (only if the project has STG tasks), then Prod.
- Within an environment, open tasks run **one after another** in flow order, regardless of parallelism. The total is the sum of their durations.
- Each environment starts on the working day after the previous environment finishes. The first starts at index 0.
- Completion of an environment = last working day of its last open task. If all its tasks are closed, show "Done".
- Closed tasks take no time.

### 7.3 Complete date (project list)

- Complete date = start date + longest chain of working days through blocked-by links.
- Tasks in parallel are counted once.
- **All tasks count at their planned duration, regardless of status** (confirmed). It is a planned date, not a projection.

### 7.4 Projected completion and late probability

- Projected Prod completion = happy-case completion of Prod.
- **Late probability** (kept, confirmed): run 1,500 simulations. In each run, multiply the duration of every open task by a random factor, then round to a whole day with a minimum of 1:
  - blocked tasks: triangular(min 1.0, mode 1.5, max 2.2)
  - other open tasks: triangular(min 0.9, mode 1.05, max 1.4)
  - closed tasks: 0
  Recompute the happy-case Prod completion for each run. Late probability = share of runs finishing after the Prod commit.
- Health colour: red if projected Prod completion is after the Prod commit; amber if late probability > 30%; green otherwise.
- Run the simulation server-side and cache it per project. Recompute when tasks, durations, statuses, blockers, or commits change.

### 7.5 Changing the start date

- Only PM may change it.
- Task deadlines shift by the same number of working days... [DEFAULT: calendar days, same as the prototype].
- Client commit dates keep their **calendar** dates. Their stored offsets are recalculated.

---

## 8. Timeline by environment (Health)

- Columns: UAT, STG (only if the project has STG tasks), Prod.
- Row "0) Start": start of the environment in the happy case, or "Done".
- Row "1) Task completion (projected)": happy-case completion, or "Done".
- Row "2) Client commitment": editable date per environment (PM/PO).
- Row "Buffer / late": commit minus completion, in working days. Green if buffer, red if late, "Done" if the environment is complete.

---

## 9. Task timeline (dashboard tab)

- **One lane per person** (confirmed). Each lane is labelled with name and role. Lanes are ordered by role: BA, PO, Designer, FE, BE, QC. Unassigned tasks go in a last lane labelled "Unassigned".
- Each open task is a **coloured segment** from its dependency-schedule start date to its inclusive end date. Colour is fixed per person.
- Overlapping tasks of the same person stack into extra sub-rows in that lane.
- Hover: code and name, phase and environment, start → end, working-day duration, status, blocker text if blocked. The title appears only on hover.
- Click: opens the task detail popup.
- Marks: critical path (amber outline), blocked (red outline), dashed red line at the Prod commit date.
- **Weekends** (Saturday and Sunday) are shaded grey in every lane. No task occupies a weekend.
- Horizontal scrolling. Fixed width per calendar day (26 px). Lane labels stay visible while scrolling. A date label appears at every Monday (dd/mm). Closed tasks are hidden.

---

## 10. Views

### 10.1 Projects list
- Card per project: name, priority dropdown (PM edits), start date (PM edits), complete date (7.3), client commit (Prod), member count, task count, progress (closed / total).
- Clicking a card opens the project board.

### 10.2 Task board
- Project description panel (collapsible): Context, Client info, Related documents (one per line, "Name | link").
- Filters: PIC, environment (only environments present in the project), status. Combined with AND.
- Six status columns. Card shows code, name, environment, phase, active blockers, deadline, PIC dropdown, duration dropdown, status dropdown, blocked reason.
- Clicking a card opens the task detail popup.

### 10.3 Task detail popup
In order:
1. Task ID, phase, environment
2. PIC (dropdown) and PIC role
3. Duration (dropdown 0–20 working days)
4. Status (dropdown)
5. Task deadline (text, dd/mm/yy)
6. Description (textarea)
7. Blocked by (multi-select of tasks; shows active blockers; closed ones labelled "closed, not blocking")
8. Blocks (downstream): open tasks blocked directly or indirectly. First 3 shown, rest behind "Show more"
9. Projected start → finish (dependency schedule)
10. Slack in working days, or the critical-path marker
11. Issue: "Mark as blocked" checkbox and reason text
12. Outputs (optional): list of links with type, added by and time. Add form: type dropdown, URL field, Add button
Buttons: Delete (PM/PO), Create (drafts only).

### 10.4 Bottleneck dashboard (tabs)
- **Health & workload**: banner (state, projected Prod completion vs commit, late probability, blocked tasks); KPI cards (late probability, blocked open tasks); environment timeline (section 8); histogram of simulated Prod completion dates (bars at or after the commit date in red); workload by person across all projects (name, role, projects, open tasks, total open duration).
- **Task timeline**: section 9.
- **What-if**: pick an open task and an extra delay of 0–10 working days. Shows new projected finish, added delay, buffer or lateness vs Prod commit, and the list of pushed-back tasks.
- **Priority**: section 11.
- No "Today" control: the date is the system date.

### 10.5 Team
- Team table with open-task count per member. PM can add existing members, remove members (their open tasks become unassigned), and create new members (name + role). Creating a member also creates their account.

### 10.6 Notifications
- Per account: list with time and project, unread highlight, "Mark all as read". Header bell with unread count.

---

## 11. Priority score

For each open task:
- `downstream` = number of open tasks that depend on it, directly or indirectly.
- `risk` = 3 if blocked; 2 if on the critical path; otherwise 1.
- `score = (downstream + 1) × risk / max(duration, 1)`.
- Show the top 8, descending by score.
- Suggested action: blocked → "Clear blocker: <reason>"; critical path → "Prioritise resources, do not let it slip"; otherwise → "Monitor and be ready to help".

Project priority (Highest, High, Medium, Low, Lowest) is a label only **[DEFAULT]**. It does not affect ordering or scoring.

---

## 12. Alerts and notifications

### 12.1 Alert rules (confirmed)
Checked daily against the real system date (Asia/Ho_Chi_Minh), and also each time the app loads. Each alert is sent once per task until the relevant field changes.

1. **Overdue**: an open task is more than **2 working days** past its planned end (deadline). Count working days only. Duration is **not** part of this rule [DEFAULT: see Q1]. Send to every member of the project, then set `alerts.late`.
   Message: `⚠ {code} "{name}" is {n} working days past its planned end ({deadline}). PIC: {pic}.`
2. **To do too long**: status is `todo` and more than 2 working days have passed since `sinceMs`. Send to every member, then set `alerts.todo`.
   Message: `⚠ {code} "{name}" has been To do for {n} working days. PIC: {pic}.`

Reset `alerts` when status or deadline changes.

### 12.2 Other notifications
Sent to PM, PO and the PIC, excluding the actor:
- Status change, PIC change (also to the new PIC directly), duration change, deadline change, block flag change, blockedBy change, output link added, description change.

Sent to every member of the project:
- Task added, renamed or deleted.
- Project description, client commit, priority or start date changed.

Sent to that member only: added to or removed from a project.

Delivery: in-app only for now [DEFAULT].

---

## 13. Validation

- Dates typed as dd/mm/yy (or dd/mm/yyyy). Invalid dates are rejected with a message.
- Task name required. Blocker reason required when blocked.
- Duration integer 0–20.
- Blocked-by must not create a cycle. Reject with a message if a candidate blocker already depends on the task, directly or indirectly.
- A task cannot be its own blocker.
- Output URL must be an absolute http or https URL.
- Project needs a start date and a Prod commit date.

---

## 14. Calendar

- Working days: Monday to Friday.
- Start date can be any calendar date. Index 0 is the first working day on or after it.
- No public holidays.
- Timezone for "today": Asia/Ho_Chi_Minh [DEFAULT].

---

## 15. Non-functional notes

- The prototype keeps data in browser memory only. The real build needs persistence (PostgreSQL recommended), an API, and server-side permission checks.
- Store dates as calendar dates. Store `sinceMs` as a date, not a timestamp.
- The simulation must return quickly for interactive use. Compute it server-side and cache it.
- Audit trail: [DEFAULT] keep a simple change log per task (who, what, when). Full audit is open (Q6).

---

## 16. Open questions

**Confirmed:**

- **Q1. Overdue threshold:** more than 2 working days past the planned end. Duration is not part of the rule.
- **Q2. Complete date:** ignores task status and uses planned durations.
- **Q3. Team edits:** every member can change PIC and duration on their own tasks only. If a PIC hands a task to someone else, they lose access to it.

**Still open (default in brackets):**

- **Q4. Half-day durations?** [No, whole working days.]
- **Q5. Notification channels beyond in-app (email, Slack, Teams)?** [In-app only.]
- **Q6. Audit trail:** full history, or the simple change log? [Simple change log.]
- **Q7. Blocked-by editing by PIC:** should a PIC be able to add a blocker when they discover one? [No, PM/PO only.]
- **Q8. Reopening a Closed task:** allowed? If yes, should its successors become blocked again? [Allowed; the link is kept, so successors are blocked again.]
- **Q9. Task deadline change:** should it move successor deadlines? [No, only that task.]
- **Q10. Cross-project dependencies:** needed? [No.]
- **Q11. Workload threshold:** the previous 15-day "overloaded" flag is not used in v9. Keep it, and at what value? [Not shown.]

---

## 17. Glossary

- **Blocked by / blockedBy**: upstream tasks that must finish first.
- **Blocks / downstream**: tasks that depend on this one, directly or indirectly.
- **Critical path**: open tasks with zero slack. Any delay on them delays the project.
- **Slack**: working days a task can slip without moving the project finish.
- **Happy case**: sequential estimate per environment (7.2).
- **Client commitment**: date promised to the client for an environment.
- **Buffer**: working days between projected completion and the commitment. Negative means late.
- **PIC**: person in charge of a task.
- **Draft**: a task that has not yet been created.