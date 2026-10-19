-- Migration 004: a per-project switch that turns off deleting tasks.
-- Off by default. Run once in Supabase SQL Editor.
alter table projects add column if not exists task_delete_locked boolean not null default false;

-- The demo project must not allow task deletion, so people viewing it cannot delete tasks
update projects set task_delete_locked = true where name = 'Payment Gateway v2 (demo)';
