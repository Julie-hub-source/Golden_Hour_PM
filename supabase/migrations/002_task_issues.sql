-- Migration 002: struggles (flames) replace the single blocked flag on tasks.
-- Run once in Supabase SQL Editor, BEFORE deploying the matching app code.
-- Only for a database created from the PREVIOUS schema (which has tasks.blocked and tasks.blocker).
-- A brand-new database should run supabase/schema.sql only.

create table if not exists task_issues (
  id          uuid primary key default gen_random_uuid(),
  task_id     uuid not null references tasks(id) on delete cascade,
  reason      text not null check (length(trim(reason)) > 0),
  created_by  uuid references members(id) on delete set null,
  created_at  timestamptz not null default now(),
  solved_at   timestamptz
);
create index if not exists task_issues_task_idx on task_issues(task_id);

-- Keep existing blocked tasks: each becomes one unsolved struggle with its old reason
insert into task_issues (task_id, reason)
select t.id, t.blocker
from tasks t
where t.blocked
  and length(trim(t.blocker)) > 0
  and not exists (select 1 from task_issues i where i.task_id = t.id);

alter table tasks drop constraint if exists blocked_needs_reason;
alter table tasks drop column if exists blocked;
alter table tasks drop column if exists blocker;
