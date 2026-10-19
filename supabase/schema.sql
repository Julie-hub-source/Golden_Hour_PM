-- Golden Hour database schema. Run once in Supabase: SQL Editor -> New query -> paste -> Run.
-- The app talks to Postgres only from the server (service role key), so RLS is left
-- disabled. Permissions are enforced in src/lib/permissions.ts. When real auth is added,
-- turn RLS on and bind policies to the signed-in member.

create table if not exists members (
  id          uuid primary key default gen_random_uuid(),
  name        text not null,
  role        text not null check (role in ('PM','PO','BA','Designer','FE','BE','QC')),
  created_at  timestamptz not null default now()
);

create table if not exists projects (
  id            uuid primary key default gen_random_uuid(),
  name          text not null,
  start_date    date not null,
  commit_uat    date,
  commit_stg    date,
  commit_prod   date not null,
  priority      text not null default 'Medium' check (priority in ('Highest','High','Medium','Low','Lowest')),
  context       text not null default '',
  client_info   text not null default '',
  documents     text not null default '',   -- one per line: "Name | link"
  task_seq      integer not null default 0, -- last issued task number (IDs are never reused)
  created_at    timestamptz not null default now()
);

create table if not exists project_members (
  project_id  uuid not null references projects(id) on delete cascade,
  member_id   uuid not null references members(id) on delete cascade,
  primary key (project_id, member_id)
);

create table if not exists tasks (
  id          uuid primary key default gen_random_uuid(),
  project_id  uuid not null references projects(id) on delete cascade,
  code        text not null,                       -- T01, T02, ...
  name        text not null,
  phase       text not null default 'Custom',
  environment text not null check (environment in ('UAT','STG','Prod')),
  role        text check (role in ('PM','PO','BA','Designer','FE','BE','QC')),
  pic_id      uuid references members(id) on delete set null,
  status      text not null default 'todo' check (status in ('todo','in_progress','uat','stg','prod','closed')),
  duration    integer not null default 0 check (duration between 0 and 20),
  deadline    date not null,
  description text not null default '',
  since_date  date not null default current_date,  -- date of last status change
  alerts      text[] not null default '{}',        -- subset of {late, todo}
  blocked_by  uuid[] not null default '{}',        -- task ids that must finish first (cycles checked in app)
  sort_order  integer not null default 0,
  created_at  timestamptz not null default now(),
  unique (project_id, code)
);

-- Struggles on a task (shown as flames). A task can have many. solved_at is set when it is solved.
create table if not exists task_issues (
  id          uuid primary key default gen_random_uuid(),
  task_id     uuid not null references tasks(id) on delete cascade,
  reason      text not null check (length(trim(reason)) > 0),
  created_by  uuid references members(id) on delete set null,
  created_at  timestamptz not null default now(),
  solved_at   timestamptz
);
create index if not exists task_issues_task_idx on task_issues(task_id);

create table if not exists task_outputs (
  id          uuid primary key default gen_random_uuid(),
  task_id     uuid not null references tasks(id) on delete cascade,
  type        text not null check (type in ('PRD','SRS','Test case','Test evidence','Design','Meeting notes','Code / PR','Other')),
  url         text not null,
  added_by    uuid references members(id) on delete set null,
  added_at    timestamptz not null default now()
);

-- Simple change log per task (who, what, when). Full audit is out of scope.
create table if not exists task_log (
  id          bigint generated always as identity primary key,
  task_id     uuid references tasks(id) on delete cascade,
  project_id  uuid not null references projects(id) on delete cascade,
  member_id   uuid references members(id) on delete set null,
  action      text not null,
  created_at  timestamptz not null default now()
);

create table if not exists notifications (
  id          uuid primary key default gen_random_uuid(),
  member_id   uuid not null references members(id) on delete cascade,
  project_id  uuid references projects(id) on delete cascade,
  message     text not null,
  read_at     timestamptz,
  created_at  timestamptz not null default now()
);
create index if not exists notifications_member_idx on notifications(member_id, created_at desc);

-- Cached Monte Carlo result per project. Recomputed when input_hash changes.
create table if not exists sim_cache (
  project_id  uuid primary key references projects(id) on delete cascade,
  input_hash  text not null,
  payload     jsonb not null,
  computed_at timestamptz not null default now()
);

-- Seed the member list (edit to match your team). Each member is also a login account.
insert into members (name, role)
select v.name, v.role from (values
  ('Alex', 'PM'),
  ('Ben', 'PO'),
  ('Chloe', 'BA'),
  ('Daniel', 'Designer'),
  ('Emma', 'FE'),
  ('Frank', 'BE'),
  ('Grace', 'QC')
) as v(name, role)
where not exists (select 1 from members);
