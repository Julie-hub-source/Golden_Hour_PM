-- Migration 005: task status is now To do, In progress or Closed only.
-- The In test (UAT / STG / Prod) statuses are gone; those tasks become In progress.
-- Run once in Supabase SQL Editor, before the new version of the app is deployed.
update tasks set status = 'in_progress' where status in ('uat', 'stg', 'prod');

alter table tasks drop constraint if exists tasks_status_check;
alter table tasks add constraint tasks_status_check check (status in ('todo', 'in_progress', 'closed'));
