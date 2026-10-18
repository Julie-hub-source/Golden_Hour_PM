import { test } from 'node:test';
import assert from 'node:assert/strict';
import { workdayDate, workdaysAfter, parseDateInput, isWeekend, workdaysBetween, formatDate, todayIso } from '../src/lib/calendar';
import { dependencySchedule, happyCase, simulateProd, canAddBlocker, downstreamIds, priorityList, whatIf, completeDate, sampleTriangular } from '../src/lib/schedule';
import { dueAlerts } from '../src/lib/alerts';
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
    blocker: '',
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
  assert.equal(parseDateInput('03/02/26'), '2026-02-03');
  assert.equal(parseDateInput('03/02/2026'), '2026-02-03');
  assert.equal(parseDateInput('2026-02-03'), '2026-02-03');
  assert.equal(parseDateInput('31/02/26'), null);
  assert.equal(parseDateInput('hello'), null);
  assert.equal(formatDate('2026-02-03'), '03/02/26');
  assert.match(todayIso(), /^\d{4}-\d{2}-\d{2}$/);
});

test('dependency schedule: chain, parallel and slack', () => {
  const tasks = [
    task({ id: 'a', duration: 3 }),
    task({ id: 'b', duration: 2, blockedBy: ['a'] }),
    task({ id: 'c', duration: 1 }),
  ];
  const s = dependencySchedule(tasks, START);
  assert.equal(s.plans.get('a')!.start, '2026-01-05');
  assert.equal(s.plans.get('a')!.end, '2026-01-07');
  assert.equal(s.plans.get('b')!.start, '2026-01-08');
  assert.equal(s.plans.get('b')!.end, '2026-01-09');
  assert.equal(s.finishIdx, 5);
  assert.equal(s.plans.get('a')!.critical, true);
  assert.equal(s.plans.get('c')!.slack, 4);
  assert.equal(s.plans.get('c')!.critical, false);
});

test('closed tasks gate nothing, complete date counts them', () => {
  const tasks = [
    task({ id: 'a', duration: 3, status: 'closed' }),
    task({ id: 'b', duration: 2, blockedBy: ['a'] }),
  ];
  assert.equal(dependencySchedule(tasks, START).plans.get('b')!.start, START);
  assert.equal(completeDate(tasks, START), '2026-01-09');
});

test('zero-duration task uses its start date for both dates', () => {
  const s = dependencySchedule([task({ id: 'z', duration: 0 })], START);
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
  // UAT: 5 days, Prod starts day 5 (Mon 12 Jan), 2 days -> ends Tue 13 Jan
  assert.equal(hc.envs[1].start, '2026-01-12');
  assert.equal(hc.prodCompletion, '2026-01-13');
});

test('happy case shows Done for environments with only closed tasks', () => {
  const tasks = [
    task({ id: 'u1', duration: 3, environment: 'UAT', status: 'closed' }),
    task({ id: 'p1', duration: 2, environment: 'Prod' }),
  ];
  const hc = happyCase(tasks, START);
  assert.equal(hc.envs[0].done, true);
  assert.equal(hc.envs[1].start, START);
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

test('priority: blocked outranks critical and both use downstream count', () => {
  const tasks = [
    task({ id: 'a', duration: 2 }),
    task({ id: 'b', duration: 2, blockedBy: ['a'] }),
    task({ id: 'x', duration: 2, blocked: true, blocker: 'waiting on vendor' }),
  ];
  const s = dependencySchedule(tasks, START);
  const list = priorityList(tasks, s);
  const x = list.find((i) => i.task.id === 'x')!;
  assert.equal(x.risk, 3);
  assert.equal(x.action, 'Clear blocker: waiting on vendor');
  const a = list.find((i) => i.task.id === 'a')!;
  assert.equal(a.downstream, 1);
  assert.equal(a.score, (1 + 1) * 2 / 2);
});

test('what-if pushes downstream tasks and reports buffer', () => {
  const tasks = [
    task({ id: 'a', duration: 2, environment: 'Prod' }),
    task({ id: 'b', duration: 2, environment: 'Prod', blockedBy: ['a'] }),
  ];
  const r = whatIf(tasks, START, '2026-01-09', 'a', 3);
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

test('alerts: overdue after more than 2 working days and to-do after 2 working days', () => {
  const today = '2026-01-12'; // Monday
  const overdue = task({ id: 'o', deadline: '2026-01-07', status: 'in_progress' }); // Wed -> 3 wd past (Thu, Fri, Mon)
  const due = dueAlerts(overdue, today);
  assert.deepEqual(due.map((d) => d.kind), ['late']);
  assert.equal(due[0].days, 3);
  const notYet = task({ id: 'n', deadline: '2026-01-08', status: 'in_progress' }); // Thu -> 2 wd past
  assert.equal(dueAlerts(notYet, today).length, 0);
  const todo = task({ id: 't', status: 'todo', sinceDate: '2026-01-05', deadline: '2026-02-27' });
  assert.deepEqual(dueAlerts(todo, today).map((d) => d.kind), ['todo']);
  assert.equal(dueAlerts({ ...todo, alerts: ['todo'] }, today).length, 0);
});

test('default flow: 32 tasks, sequential codes, correct commits', () => {
  let n = 0;
  const members = [
    { id: 'm-ba', name: 'BA', role: 'BA' as const },
    { id: 'm-po', name: 'PO', role: 'PO' as const },
    { id: 'm-qc', name: 'QC', role: 'QC' as const },
    { id: 'm-fe', name: 'FE', role: 'FE' as const },
    { id: 'm-be', name: 'BE', role: 'BE' as const },
  ];
  const r = buildDefaultFlow({ startIso: START, today: START, members, newId: () => `id-${++n}` });
  assert.equal(r.tasks.length, 32);
  assert.equal(r.tasks[0].code, 'T01');
  assert.equal(r.tasks[31].code, 'T32');
  assert.deepEqual(r.tasks[2].blockedBy, ['id-1', 'id-2'], 'step 2 blocked by all of step 1');
  assert.equal(r.tasks[0].picId, 'm-ba');
  assert.equal(r.tasks.find((t) => t.name === 'Test UAT')!.picId, 'm-qc');
  assert.equal(r.tasks.find((t) => t.name === 'Dev front-end STG')!.picId, 'm-fe');
  assert.ok(r.commitUat && r.commitStg);
  assert.ok(r.commitUat! < r.commitStg!);
  // Deadlines equal planned finish; the last Prod task ends the project
  const last = r.tasks[31];
  assert.ok(last.deadline >= r.tasks[0].deadline);
  assert.equal(new Set(r.tasks.map((t) => t.code)).size, 32);
});
