/**
 * Creates the demo project "Payment Gateway v2 (demo)" with a fixed scenario:
 * - all 35 tasks of the default flow;
 * - today is inside "Internal acceptance STG" (test internal STG);
 * - two tasks before today are 1 and 2 working days late;
 * - struggles spread from the start to the end: past ones are solved, today's are mixed, later ones are open.
 *
 *   npm run seed:demo
 *
 * Running it again replaces only this demo project. Other projects are not touched.
 */
import { createClient } from '@supabase/supabase-js';
import { randomUUID } from 'node:crypto';
import { buildDefaultFlow } from '../src/lib/project-setup';
import { dependencySchedule, happyCase } from '../src/lib/schedule';
import { addDays, isWeekend, todayIso, workdayDate, workIndex } from '../src/lib/calendar';
import type { Member, Status, Task } from '../src/lib/types';

const DEMO_NAME = 'Payment Gateway v2 (demo)';

/** Tasks that are open and past their deadline, with how many working days late they are. */
const LATE: Record<string, number> = { 'Test STG': 1, 'Debug STG': 2 };

/**
 * Struggles per task name: [reason, solved]. Past tasks are solved, today's tasks are mixed,
 * and the later tasks are open.
 */
const STRUGGLES: Record<string, [string, boolean][]> = {
  'Dev front-end UAT': [['Design sign-off took three extra days', true]],
  'Dev back-end UAT': [
    ['Vendor sandbox credentials delayed', true],
    ['Payment-intent API contract not final', true],
  ],
  'Test UAT': [['Test data missing refund scenarios', true]],
  'Debug UAT': [
    ['Refund endpoint times out under load', true],
    ['Duplicate charge on retry', true],
  ],
  'Customer acceptance UAT (PO)': [['Client has not signed off the refund policy', true]],
  'Dev front-end STG': [['Waiting for STG environment access from client IT', true]],
  'Dev back-end STG': [
    ['Vendor webhook signature changed', true],
    ['Staging database migration needed a rerun', true],
  ],
  'Test STG': [['QA found a rounding issue in refunds', true]],
  'Debug STG': [['Idempotency key missing on retry', true]],
  'Internal acceptance STG (QC)': [
    ['Two test cases failing on partial refunds', true],
    ['Reconciliation totals off by one day', false],
  ],
  'Internal acceptance STG (BA)': [['Business rule for refund cut-off changed', true]],
  'Internal acceptance STG (PO)': [['Client wants a clearer refund status message', false]],
  'Dev front-end Prod': [['Payment button styling not approved', false]],
  'Test Prod': [['Prod test data not ready', false]],
};

const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!url || !key) throw new Error('Set NEXT_PUBLIC_SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY in .env.local first.');
const db = createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false } });

function check<T>(res: { data: T | null; error: { message: string } | null }): T {
  if (res.error) throw new Error(res.error.message);
  return res.data as T;
}

/** Planned windows (no late shifts) for a given start date. */
function windows(tasks: Task[], start: string) {
  return dependencySchedule(
    tasks.map((t) => ({ ...t, status: 'todo' as Status })),
    start,
    { ignoreLate: true },
  );
}

async function main() {
  // Stop before writing anything if migration 002 has not been run yet
  const probe = await db.from('task_issues').select('id').limit(1);
  if (probe.error) throw new Error('Table task_issues is missing. Run supabase/migrations/002_task_issues.sql in the Supabase SQL Editor first.');

  const today = todayIso();
  const members = check<Member[]>(await db.from('members').select('id, name, role'));
  if (members.length === 0) throw new Error('The members table is empty. Run supabase/schema.sql first.');

  // Find a start date so that today falls inside "Internal acceptance STG (QC)"
  const template = buildDefaultFlow({ startIso: today, today, members, newId: randomUUID }).tasks;
  const qcStg = template.find((t) => t.name === 'Internal acceptance STG (QC)')!;
  let startDate = '';
  for (let back = 1; back <= 200 && !startDate; back++) {
    const s = addDays(today, -back);
    const w = windows(template, s).plans.get(qcStg.id)!;
    if (w.start <= today && today <= w.end) startDate = s;
  }
  if (!startDate) throw new Error('Could not place today inside Internal acceptance STG.');

  // Replace the previous demo project, if any (tasks and struggles go with it)
  check(await db.from('projects').delete().eq('name', DEMO_NAME));

  const built = buildDefaultFlow({ startIso: startDate, today, members, newId: randomUUID });
  const plan = windows(built.tasks, startDate);
  const lastWorkday = isWeekend(today) ? workIndex(startDate, today) - 1 : workIndex(startDate, today);

  const tasks: Task[] = built.tasks.map((t) => {
    const p = plan.plans.get(t.id)!;
    let status: Status = 'todo';
    let deadline = t.deadline;
    if (LATE[t.name] !== undefined) {
      // Open and started; its deadline is LATE[name] working days before today
      status = 'in_progress';
      deadline = workdayDate(startDate, lastWorkday - LATE[t.name]);
    } else if (p.end < today) {
      status = 'closed';
    } else if (p.start <= today && today <= p.end) {
      status = t.environment === 'STG' ? 'stg' : 'in_progress';
    }
    return { ...t, status, deadline, sinceDate: status === 'todo' ? today : addDays(today, -2) };
  });

  // Commit 2 working days before the projection, so the demo shows a small late buffer
  const hc = happyCase(tasks, startDate);
  const projected = hc.prodCompletion ?? today;
  const commitProd = workdayDate(startDate, workIndex(startDate, projected) - 2);

  const project = check<{ id: string }>(
    await db
      .from('projects')
      .insert({
        name: DEMO_NAME,
        start_date: startDate,
        commit_uat: built.commitUat,
        commit_stg: built.commitStg,
        commit_prod: commitProd,
        priority: 'High',
        context:
          'Extend the checkout service to accept card and e-wallet payments, with refunds and a daily reconciliation report. Demo project: today is in internal acceptance STG.',
        client_info: 'Client: ACME Retail\nBusiness owner: Mr. Tran (Head of E-commerce)',
        documents: 'Requirement spec v1.2 | https://example.com/req-spec',
        task_seq: tasks.length,
        task_delete_locked: true,
      })
      .select('id')
      .single(),
  );

  check(await db.from('project_members').insert(members.map((m) => ({ project_id: project.id, member_id: m.id }))));

  check(
    await db.from('tasks').insert(
      tasks.map((t) => ({
        id: t.id,
        project_id: project.id,
        code: t.code,
        name: t.name,
        phase: t.phase,
        environment: t.environment,
        role: t.role,
        pic_id: t.picId,
        status: t.status,
        duration: t.duration,
        deadline: t.deadline,
        description: '',
        since_date: t.sinceDate,
        alerts: [],
        blocked_by: t.blockedBy,
        sort_order: t.sortOrder,
      })),
    ),
  );

  // Struggles. Solved ones before today get an earlier timestamp; solved today gets an hour ago.
  const now = Date.now();
  const issueRows = tasks.flatMap((t) => {
    const p = plan.plans.get(t.id)!;
    const onToday = p.start <= today && today <= p.end;
    return (STRUGGLES[t.name] ?? []).map(([reason, solved], i) => ({
      task_id: t.id,
      reason,
      created_by: members.find((m) => m.role === 'PM')?.id ?? null,
      created_at: new Date(now - (6 + i) * 86_400_000).toISOString(),
      solved_at: solved ? new Date(onToday ? now - (i + 1) * 3_600_000 : now - (2 + i) * 86_400_000).toISOString() : null,
    }));
  });
  if (issueRows.length) check(await db.from('task_issues').insert(issueRows));

  const count = (s: Status) => tasks.filter((t) => t.status === s).length;
  const late = tasks.filter((t) => LATE[t.name] !== undefined).map((t) => `${t.code} ${t.name} (${LATE[t.name]} wd)`);
  const solved = issueRows.filter((i) => i.solved_at).length;
  console.log(`Created "${DEMO_NAME}" (id ${project.id}), start ${startDate}.`);
  console.log(`Today ${today} is in Internal acceptance STG.`);
  console.log(`Tasks: ${tasks.length}. Closed ${count('closed')}. In test STG ${count('stg')}. In progress ${count('in_progress')}. To do ${count('todo')}.`);
  console.log(`Late: ${late.join(', ')}.`);
  console.log(`Struggles: ${issueRows.length} total, ${solved} solved, ${issueRows.length - solved} open.`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
