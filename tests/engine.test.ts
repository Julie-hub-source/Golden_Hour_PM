import { test } from 'node:test';
import assert from 'node:assert/strict';
import { workdayDate, workdaysAfter, parseDateInput, isWeekend, workdaysBetween, formatDate, todayIso } from '../src/lib/calendar';
import { dependencySchedule, happyCase, simulateProd, canAddBlocker, downstreamIds, whatIf, completeDate, sampleTriangular, priorityOf, lateness } from '../src/lib/schedule';
import { dueAlerts, alertMessage } from '../src/lib/alerts';
import { buildDefaultFlow } from '../src/lib/project-setup';
import { can } from '../src/lib/permissions';
import type { Task } from '../src/lib/types';

// Monday 2026-01-05
const START = '2026-01-05';

function task(partial: Partial<Task> & { id: string }): Task {
  return {
    projectId: 'p',
    code: partial.id.toUpperCase(),
    name: partial.id,
    phase: 'x',
    environment: 'UAT',
    role: null,
    picId: null,
    status: 'todo',
    duration: 1,
    deadline: START,
    blockedBy: [],
    blocked: false,
    issues: [],
    description: '',
    sinceDate: START,
    alerts: [],
    sortOrder: 0,
    outputs: [],
    ...partial,
  };
}

test('working-day calendar', () => {
  assert.equal(isWeekend('2026-01-03'), true);
  assert.equal(workdayDate('2026-01-03', 0), '2026-01-05'); // Saturday start -> Monday
  assert.equal(workdayDate(START, 4), '2026-01-09');
  assert.equal(workdayDate(START, 5), '2026-01-12');
  assert.equal(workdaysAfter('2026-01-09', '2026-01-12'), 1); // Mon is one working day after Fri
  assert.equal(workdaysAfter(START, '2026-01-09'), 4);
  assert.equal(workdaysBetween('2026-01-05', '2026-01-12'), 5);
});

test('date input parsing and formatting', () => {
  assert.equal(parseDateInput('3/2/2026'), '2026-02-03');
  assert.equal(parseDateInput('03/02/2026'), '2026-02-03');
  assert.equal(parseDateInput('Tue 3/2/2026'), '2026-02-03');
  assert.equal(parseDateInput('2026-02-03'), '2026-02-03');
  assert.equal(parseDateInput('31/02/2026'), null, 'not a real day');
  assert.equal(parseDateInput('03/02/26'), null, 'two-digit years are not accepted');
  assert.equal(parseDateInput('hello'), null);
  assert.equal(formatDate('2027-01-01'), 'Fri 1/1/2027', 'no zero padding, English weekday');
  assert.equal(formatDate('2026-02-03'), 'Tue 3/2/2026');
  assert.equal(parseDateInput(formatDate('2026-11-25')), '2026-11-25', 'displayed value parses back');
  assert.match(todayIso(), /^\d{4}-\d{2}-\d{2}$/);
});

test('dependency schedule: chain, parallel and slack', () => {
  const tasks = [
    task({ id: 'a', duration: 3 }),
    task({ id: 'b', duration: 2, blockedBy: ['a'] }),
    task({ id: 'c', duration: 1 }),
  ];
  const s = dependencySchedule(tasks, START, { today: START });
  assert.equal(s.plans.get('a')!.start, '2026-01-05');
  assert.equal(s.plans.get('a')!.end, '2026-01-07');
  assert.equal(s.plans.get('b')!.start, '2026-01-08');
  assert.equal(s.plans.get('b')!.end, '2026-01-09');
  assert.equal(s.finishIdx, 5);
  assert.equal(s.plans.get('a')!.critical, true);
  assert.equal(s.plans.get('c')!.slack, 4);
  assert.equal(s.plans.get('c')!.critical, false);
});

test('closed task does not delay its successor, but the successor starts after its planned finish', () => {
  const tasks = [
    task({ id: 'a', duration: 3, status: 'closed' }),
    task({ id: 'b', duration: 2, blockedBy: ['a'] }),
  ];
  assert.equal(dependencySchedule(tasks, START, { today: START }).plans.get('b')!.start, '2026-01-08', 'a planned to finish Thu 8 Jan (3 working days)');
  assert.equal(completeDate(tasks, START), '2026-01-09');
});

test('zero-duration task uses its start date for both dates', () => {
  const s = dependencySchedule([task({ id: 'z', duration: 0 })], START, { today: START });
  assert.equal(s.plans.get('z')!.start, s.plans.get('z')!.end);
});

test('happy case runs environments in order and skips STG when absent', () => {
  const tasks = [
    task({ id: 'u1', duration: 3, environment: 'UAT', sortOrder: 1 }),
    task({ id: 'u2', duration: 2, environment: 'UAT', sortOrder: 2 }),
    task({ id: 'p1', duration: 2, environment: 'Prod', sortOrder: 3 }),
  ];
  const hc = happyCase(tasks, START);
  assert.deepEqual(hc.envs.map((e) => e.env), ['UAT', 'Prod']);
  // u1 (3 days) and u2 (2 days) are not linked, so they run in parallel: UAT takes 3 days.
  // Prod starts on day 3 (Thu 8 Jan) and takes 2 days, ending Fri 9 Jan
  assert.equal(hc.envs[1].start, '2026-01-08');
  assert.equal(hc.prodCompletion, '2026-01-09');
});

test('happy case: a finished environment keeps its planned dates, and the next one starts after them', () => {
  const tasks = [
    task({ id: 'u1', duration: 3, environment: 'UAT', status: 'closed' }),
    task({ id: 'p1', duration: 2, environment: 'Prod' }),
  ];
  const hc = happyCase(tasks, START);
  assert.equal(hc.envs[0].done, true);
  assert.equal(hc.envs[0].start, START, 'planned start of the closed UAT tasks');
  assert.equal(hc.envs[0].completion, '2026-01-07', 'planned completion: 3 working days');
  assert.equal(hc.envs[1].start, '2026-01-08');
});

test('simulation: late when commit is before the plan, on time when far away', () => {
  const tasks = [task({ id: 'p1', duration: 5, environment: 'Prod' })];
  const late = simulateProd(tasks, START, '2026-01-02', { runs: 300 });
  assert.equal(late.lateProbability, 1);
  const early = simulateProd(tasks, START, '2030-01-01', { runs: 300 });
  assert.equal(early.lateProbability, 0);
  assert.ok(early.histogram.reduce((n, h) => n + h.count, 0) === 300);
});

test('simulation: closed tasks take zero time', () => {
  const tasks = [
    task({ id: 'p1', duration: 5, environment: 'Prod', status: 'closed' }),
    task({ id: 'p2', duration: 1, environment: 'Prod' }),
  ];
  const sim = simulateProd(tasks, START, '2026-01-06', { runs: 200 });
  // Only p2 (one day, scaled to at least 1) remains: finishes on Mon 5 Jan at the latest with factor <= 1.4 -> 1 day
  assert.equal(sim.histogram.every((h) => h.date === '2026-01-05' || h.date === '2026-01-06' || h.date === '2026-01-07'), true);
});

test('triangular sampler stays inside bounds', () => {
  for (const u of [0, 0.25, 0.5, 0.9, 0.9999]) {
    const v = sampleTriangular(0.9, 1.05, 1.4, u);
    assert.ok(v >= 0.9 && v <= 1.4, `value ${v} for u ${u}`);
  }
});

test('cycle detection for blockers', () => {
  const tasks = [
    task({ id: 'a' }),
    task({ id: 'b', blockedBy: ['a'] }),
    task({ id: 'c', blockedBy: ['b'] }),
  ];
  assert.ok(canAddBlocker('a', 'c', tasks), 'a cannot be blocked by c (c depends on a)');
  assert.ok(canAddBlocker('a', 'a', tasks), 'self block rejected');
  assert.equal(canAddBlocker('c', 'a', tasks), null, 'c blocked by a is fine');
});

test('downstream walks open successors only', () => {
  const tasks = [
    task({ id: 'a' }),
    task({ id: 'b', blockedBy: ['a'] }),
    task({ id: 'c', blockedBy: ['b'] }),
    task({ id: 'd', blockedBy: ['a'], status: 'closed' }),
  ];
  assert.deepEqual(downstreamIds('a', tasks).sort(), ['b', 'c']);
});

test('priority level follows the distance from today, and open struggles raise it', () => {
  const today = '2026-01-07'; // Wednesday
  const plan = (start: string, end: string) => ({
    id: 'x', es: 0, ef: 1, ls: 0, lf: 1, slack: 0, critical: false, start, end, late: false, lateWd: 0,
  });
  const t = task({ id: 'x', deadline: '2026-02-27' });
  const struggle = (n: number) =>
    Array.from({ length: n }, (_, i) => ({ id: 's' + i, reason: 'r', createdBy: null, createdAt: '', solvedAt: null }));
  assert.equal(priorityOf(t, plan('2026-01-06', '2026-01-08'), today).level, 'Highest'); // today is inside the window
  assert.equal(priorityOf(t, plan('2026-01-08', '2026-01-09'), today).level, 'High'); // 1 working day away
  assert.equal(priorityOf(t, plan('2026-01-12', '2026-01-13'), today).level, 'High'); // 3 working days away
  assert.equal(priorityOf(t, plan('2026-01-13', '2026-01-14'), today).level, 'Medium'); // 4 working days away
  assert.equal(priorityOf(t, plan('2026-01-19', '2026-01-20'), today).level, 'Low'); // 8 working days away
  const busy = task({ id: 'y', deadline: '2026-02-27', issues: struggle(3) });
  assert.equal(priorityOf(busy, plan('2026-01-19', '2026-01-20'), today).level, 'Medium'); // Low raised one level
  assert.equal(priorityOf(task({ id: 'z', deadline: '2026-02-27', issues: struggle(2) }), plan('2026-01-19', '2026-01-20'), today).level, 'Low'); // two is not more than two
});

test('late tasks are always the top priority level, and open struggles do not change that', () => {
  const today = '2026-01-12';
  const late = task({ id: 'L', deadline: '2026-01-07', status: 'in_progress', issues: [] });
  const p = priorityOf(late, undefined, today);
  assert.equal(p.level, 'Late');
  assert.equal(priorityOf({ ...late, issues: [{ id: 'i', reason: 'r', createdBy: null, createdAt: '', solvedAt: null }] }, undefined, today).level, 'Late');
  assert.equal(priorityOf(task({ id: 'T', deadline: '2026-01-12', status: 'in_progress' }), undefined, today).level, 'Low', 'deadline today is not late');
  assert.equal(priorityOf(task({ id: 'C', deadline: '2026-01-07', status: 'closed' }), undefined, today).level, 'Low', 'closed is never late');
});

test('late: deadline strictly before today, working days after the deadline', () => {
  const today = '2026-01-12'; // Monday
  assert.deepEqual(lateness(task({ id: 'a', deadline: '2026-01-12', status: 'in_progress' }), today), { late: false, lateWd: 0 });
  assert.deepEqual(lateness(task({ id: 'b', deadline: '2026-01-07', status: 'in_progress' }), today), { late: true, lateWd: 3 });
  assert.deepEqual(lateness(task({ id: 'c', deadline: '2026-01-07', status: 'closed' }), today), { late: false, lateWd: 0 });
});

test('a late predecessor pushes each successor by its late working days, once, and closed predecessors push nothing', () => {
  const today = '2026-01-12';
  // a: planned to end on its deadline Tue 6 Jan, 4 working days late today
  const tasks = [
    task({ id: 'a', duration: 2, deadline: '2026-01-06', status: 'in_progress' }),
    task({ id: 'b', duration: 2, blockedBy: ['a'], deadline: '2026-02-27' }),
    task({ id: 'c', duration: 2, blockedBy: ['b'], deadline: '2026-02-27' }),
  ];
  const planned = dependencySchedule(tasks, START, { today: START });
  const late = dependencySchedule(tasks, START, { today });
  assert.equal(late.plans.get('a')!.late, true);
  assert.equal(late.plans.get('a')!.lateWd, 4);
  assert.equal(late.plans.get('a')!.end, '2026-01-12', 'projected end = deadline + late working days');
  assert.equal(late.plans.get('b')!.start, '2026-01-13');
  assert.equal(late.plans.get('b')!.es - planned.plans.get('b')!.es, 4, 'pushed by exactly 4');
  assert.equal(late.plans.get('c')!.es - planned.plans.get('c')!.es, 4, 'the same 4 days, not added again');

  // Closed predecessor gates nothing
  const closedTasks = [
    task({ id: 'a', duration: 2, deadline: '2026-01-06', status: 'closed' }),
    task({ id: 'b', duration: 2, blockedBy: ['a'], deadline: '2026-02-27' }),
  ];
  assert.equal(dependencySchedule(closedTasks, START, { today }).plans.get('b')!.start, '2026-01-07');
});

test('what-if pushes downstream tasks and reports buffer', () => {
  const tasks = [
    task({ id: 'a', duration: 2, environment: 'Prod' }),
    task({ id: 'b', duration: 2, environment: 'Prod', blockedBy: ['a'] }),
  ];
  const r = whatIf(tasks, START, '2026-01-09', 'a', 3, START);
  assert.equal(r.shift, 3);
  assert.equal(r.pushed.length, 1);
  assert.equal(r.pushed[0].id, 'b');
  assert.ok(r.buffer !== null && r.buffer < 0, 'commit should now be missed');
});

test('permissions: PIC-scoped and PM/PO rules', () => {
  const pm = { id: 'pm', role: 'PM' as const, name: 'pm' };
  const po = { id: 'po', role: 'PO' as const, name: 'po' };
  const fe = { id: 'fe', role: 'FE' as const, name: 'fe' };
  const members = new Set(['pm', 'po', 'fe']);
  const own = { picId: 'fe' };
  const other = { picId: 'someone' };
  assert.equal(can(fe, 'task.status', { projectMemberIds: members, task: own }).ok, true);
  assert.equal(can(fe, 'task.status', { projectMemberIds: members, task: other }).ok, false);
  assert.equal(can(fe, 'task.blockedBy', { projectMemberIds: members, task: own }).ok, false);
  assert.equal(can(po, 'task.create', { projectMemberIds: members }).ok, true);
  assert.equal(can(po, 'project.members', { projectMemberIds: members }).ok, false);
  assert.equal(can(pm, 'project.members', { projectMemberIds: members }).ok, true);
  assert.equal(can(fe, 'project.setCommit', { projectMemberIds: new Set(['pm']) }).ok, false, 'non-member blocked');
});

test('alerts: late once when the deadline has passed, not again until the deadline or status changes', () => {
  const today = '2026-01-12'; // Monday
  const overdue = task({ id: 'o', deadline: '2026-01-07', status: 'in_progress' });
  const due = dueAlerts(overdue, today);
  assert.deepEqual(due.map((d) => d.kind), ['late']);
  assert.equal(due[0].days, 3);
  const msg = alertMessage(due[0], overdue, 'Binh', formatDate);
  assert.equal(msg, 'LATE: O "o" passed its deadline (Wed 7/1/2026) by 3 working day(s). PIC: Binh.');
  assert.equal(dueAlerts({ ...overdue, alerts: ['late'] }, today).length, 0, 'already sent');
  assert.equal(dueAlerts(task({ id: 'n', deadline: '2026-01-12', status: 'in_progress' }), today).length, 0, 'deadline is today');
  const todo = task({ id: 't', status: 'todo', sinceDate: '2026-01-05', deadline: '2026-02-27' });
  assert.deepEqual(dueAlerts(todo, today).map((d) => d.kind), ['todo']);
  assert.equal(dueAlerts({ ...todo, alerts: ['todo'] }, today).length, 0);
});

test('default flow: 35 tasks, sequential codes, correct commits', () => {
  let n = 0;
  const members = [
    { id: 'm-ba', name: 'BA', role: 'BA' as const },
    { id: 'm-po', name: 'PO', role: 'PO' as const },
    { id: 'm-qc', name: 'QC', role: 'QC' as const },
    { id: 'm-fe', name: 'FE', role: 'FE' as const },
    { id: 'm-be', name: 'BE', role: 'BE' as const },
  ];
  const r = buildDefaultFlow({ startIso: START, today: START, members, newId: () => `id-${++n}` });
  assert.equal(r.tasks.length, 35);
  assert.equal(r.tasks[0].code, 'T01');
  assert.equal(r.tasks[34].code, 'T35');
  assert.deepEqual(r.tasks[2].blockedBy, ['id-1', 'id-2'], 'step 2 blocked by all of step 1');
  assert.equal(r.tasks[0].picId, 'm-ba');
  assert.equal(r.tasks.find((t) => t.name === 'Test UAT')!.picId, 'm-qc');
  assert.equal(r.tasks.find((t) => t.name === 'Dev front-end STG')!.picId, 'm-fe');
  assert.ok(r.commitUat && r.commitStg);
  assert.ok(r.commitUat! < r.commitStg!);
  // Deadlines equal planned finish; the last Prod task ends the project
  const last = r.tasks[34];
  assert.ok(last.deadline >= r.tasks[0].deadline);
  assert.equal(new Set(r.tasks.map((t) => t.code)).size, 35);
});

test('a late task runs up to today and no further, even if its planned duration is longer', () => {
  const today = '2026-01-12'; // Monday
  const tasks = [task({ id: 'a', duration: 10, deadline: '2026-01-06', status: 'in_progress' })];
  const s = dependencySchedule(tasks, START, { today });
  assert.equal(s.plans.get('a')!.late, true);
  assert.equal(s.plans.get('a')!.end, '2026-01-12', 'bar ends today');
});

test('a successor that has not started yet is pushed back but is not late', () => {
  const today = '2026-01-12';
  const tasks = [
    task({ id: 'a', duration: 2, deadline: '2026-01-06', status: 'in_progress' }),
    task({ id: 'b', duration: 2, blockedBy: ['a'], deadline: '2026-01-07' }),
  ];
  const s = dependencySchedule(tasks, START, { today });
  assert.equal(s.plans.get('a')!.late, true);
  assert.equal(s.plans.get('b')!.start, '2026-01-13', 'starts after today');
  assert.equal(s.plans.get('b')!.late, false, 'not started, so not late even though its deadline passed');
});

test('environment late days move that environment and every later one', () => {
  const tasks = [
    task({ id: 'u1', duration: 2, environment: 'UAT', sortOrder: 1 }),
    task({ id: 'p1', duration: 2, environment: 'Prod', sortOrder: 2 }),
  ];
  const plain = happyCase(tasks, START);
  const late = happyCase(tasks, START, undefined, new Map([['u1', 3]]));
  const uat = late.envs.find((e) => e.env === 'UAT')!;
  const prod = late.envs.find((e) => e.env === 'Prod')!;
  assert.equal(uat.late, 3);
  assert.equal(uat.completion, '2026-01-09', 'UAT completion moves 3 working days (Thu 8 -> Fri 9 after 2 + 3 days)');
  assert.equal(prod.start, '2026-01-12', 'Prod starts after the moved UAT completion');
  assert.equal(plain.envs.find((e) => e.env === 'Prod')!.start, '2026-01-07');
});

test('task deletion can be turned off per project, for everyone including PM', () => {
  const pm = { id: 'pm', role: 'PM' as const, name: 'pm' };
  const members = new Set(['pm']);
  assert.equal(can(pm, 'task.delete', { projectMemberIds: members }).ok, true);
  assert.equal(can(pm, 'task.delete', { projectMemberIds: members, taskDeleteLocked: true }).ok, false);
});
