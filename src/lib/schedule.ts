/**
 * Scheduling engine (CLAUDE.md sections 7, 8, 11).
 * Pure functions: no I/O, no dates from the system clock. Callers pass the project start and today.
 */
import { isWeekend, todayIso, workdayDate, workdaysAfter, workdaysBetween, workIndex } from './calendar';
import { ENVIRONMENTS, type Environment, type Task } from './types';

export const isClosed = (t: Pick<Task, 'status'>) => t.status === 'closed';

/**
 * Late (section 2): an open task whose deadline is strictly before today.
 * lateWd = working days after the deadline, up to and including today.
 */
export function lateness(
  task: Pick<Task, 'status' | 'deadline'>,
  today: string,
  started = true,
): { late: boolean; lateWd: number } {
  // A task that has not started yet cannot be late. Its dates are moved by the tasks before it.
  if (!started || isClosed(task) || task.deadline >= today) return { late: false, lateWd: 0 };
  return { late: true, lateWd: workdaysAfter(task.deadline, today) };
}

export interface TaskPlan {
  id: string;
  /** Dependency-schedule indices (working days from project start). ef is the projected finish. */
  es: number;
  ef: number;
  ls: number;
  lf: number;
  slack: number;
  critical: boolean;
  /** Calendar dates. For a zero-duration task both are the same day. end is the projected end (inclusive). */
  start: string;
  end: string;
  late: boolean;
  lateWd: number;
}

export interface DependencySchedule {
  plans: Map<string, TaskPlan>;
  /** Exclusive index where the last open task finishes. */
  finishIdx: number;
  /** Date of the last working day of the schedule (or the start date when empty). */
  finishDate: string;
  /** Complete date (7.3): all tasks at planned duration, regardless of status. Computed by `completeDate`. */
  completeDate: string;
}

interface Options {
  /** Count closed tasks at their planned duration (used for the complete date). */
  includeClosed?: boolean;
  /** Override durations, keyed by task id. */
  durations?: Map<string, number>;
  /** Date used for lateness. Defaults to the real date in Asia/Ho_Chi_Minh. */
  today?: string;
  /** Plan with no late shifts (planned dates, e.g. the complete date or a new task's default deadline). */
  ignoreLate?: boolean;
}

/** Topological order: blockers come before the tasks they gate. Ignores edges to tasks outside `ids`. */
function topoOrder(ids: Set<string>, blockedBy: (id: string) => string[]): string[] {
  const order: string[] = [];
  const state = new Map<string, 1 | 2>(); // 1 = visiting, 2 = done
  const visit = (id: string) => {
    const s = state.get(id);
    if (s === 2 || s === 1) return; // 1 = cycle guard; validation prevents cycles on write
    state.set(id, 1);
    for (const b of blockedBy(id)) if (ids.has(b)) visit(b);
    state.set(id, 2);
    order.push(id);
  };
  for (const id of ids) visit(id);
  return order;
}

/**
 * Dependency schedule (7.1). Only active blockers (not closed) gate a task.
 * With includeClosed, every task counts (7.3).
 */
export function dependencySchedule(tasks: Task[], startIso: string, opts: Options = {}): DependencySchedule {
  const active = tasks.filter((t) => opts.includeClosed || !isClosed(t));
  const byId = new Map(active.map((t) => [t.id, t]));
  const ids = new Set(byId.keys());
  const dur = (id: string) => opts.durations?.get(id) ?? byId.get(id)?.duration ?? 0;

  const order = topoOrder(ids, (id) => byId.get(id)?.blockedBy ?? []);

  // Successors among active tasks, used by the backward pass
  const successors = new Map<string, string[]>();
  for (const t of active) {
    for (const b of t.blockedBy) {
      if (!ids.has(b)) continue;
      const list = successors.get(b) ?? [];
      list.push(t.id);
      successors.set(b, list);
    }
  }

  // Late tasks (section 7.6): a task is late only once it has started (its start is today or earlier).
  // A late task is still running, so its bar runs up to today and no further.
  // Successors start after the projected finish of their predecessors, so the delay is added once.
  const today = opts.today ?? todayIso();
  const lastWorkday = isWeekend(today) ? workIndex(startIso, today) - 1 : workIndex(startIso, today);

  // A Closed predecessor does not delay its successors, but an open successor still starts after the
  // planned finish of its Closed predecessors. Without this, the successor would start at project day 0.
  const closedFinish = new Map<string, number>();
  if (!opts.includeClosed) {
    const planned = dependencySchedule(tasks, startIso, { includeClosed: true, ignoreLate: true, durations: opts.durations });
    for (const t of tasks) if (isClosed(t)) closedFinish.set(t.id, planned.plans.get(t.id)?.ef ?? 0);
  }

  const es = new Map<string, number>();
  const ef = new Map<string, number>();
  const lateOf = new Map<string, { late: boolean; lateWd: number }>();
  for (const id of order) {
    const t = byId.get(id)!;
    let start = 0;
    for (const b of t.blockedBy) {
      if (ids.has(b)) start = Math.max(start, ef.get(b) ?? 0);
      else if (closedFinish.has(b)) start = Math.max(start, closedFinish.get(b)!);
    }
    es.set(id, start);
    const l = opts.ignoreLate ? { late: false, lateWd: 0 } : lateness(t, today, start <= lastWorkday);
    lateOf.set(id, l);
    ef.set(id, l.late ? Math.max(start, lastWorkday + 1) : start + dur(id));
  }

  let finishIdx = 0;
  for (const id of ids) finishIdx = Math.max(finishIdx, ef.get(id) ?? 0);

  const lf = new Map<string, number>();
  const ls = new Map<string, number>();
  for (let i = order.length - 1; i >= 0; i--) {
    const id = order[i];
    const succ = successors.get(id) ?? [];
    let latestFinish = finishIdx;
    for (const s of succ) latestFinish = Math.min(latestFinish, ls.get(s) ?? finishIdx);
    lf.set(id, latestFinish);
    ls.set(id, latestFinish - dur(id));
  }

  const plans = new Map<string, TaskPlan>();
  for (const id of order) {
    const d = dur(id);
    const start = workdayDate(startIso, es.get(id)!);
    const end = d === 0 ? start : workdayDate(startIso, ef.get(id)! - 1);
    const slack = lf.get(id)! - ef.get(id)!;
    const l = lateOf.get(id)!;
    plans.set(id, {
      id,
      es: es.get(id)!,
      ef: ef.get(id)!,
      ls: ls.get(id)!,
      lf: lf.get(id)!,
      slack,
      critical: slack <= 0,
      start,
      end,
      late: l.late,
      lateWd: l.lateWd,
    });
  }

  const finishDate = finishIdx > 0 ? workdayDate(startIso, finishIdx - 1) : startIso;
  return { plans, finishIdx, finishDate, completeDate: finishDate };
}

/** Complete date (7.3): start + longest chain of working days, all tasks at planned duration. */
export function completeDate(tasks: Task[], startIso: string): string {
  return dependencySchedule(tasks, startIso, { includeClosed: true, ignoreLate: true }).finishDate;
}

/* ---------------- Happy-case schedule (7.2) ---------------- */

export interface EnvPlan {
  env: Environment;
  /** False when the project has no tasks in this environment (STG is optional). */
  present: boolean;
  /** True when every task in the environment is closed. */
  done: boolean;
  /** Index of the first working day of the environment, relative to project start. */
  startIdx: number;
  /** Exclusive index after the last open task. */
  endIdx: number;
  /** Date the environment starts (null when done). */
  start: string | null;
  /** Date the environment completes (null when done). */
  completion: string | null;
  /** Late working days of the open tasks in this environment. Added to completion and to later environments. */
  late: number;
}

export interface HappyCase {
  envs: EnvPlan[];
  /** Happy-case start/end dates for each open task. */
  taskDates: Map<string, { start: string; end: string }>;
  prodCompletion: string | null; // null = Done or no Prod tasks
}

export const envsPresent = (tasks: Pick<Task, 'environment'>[]): Environment[] => {
  const set = new Set(tasks.map((t) => t.environment));
  return ENVIRONMENTS.filter((e) => e === 'UAT' || e === 'Prod' || set.has(e));
};

/**
 * Environments run in order. Open tasks within an environment run one after another in flow
 * order (sortOrder). Each environment starts on the working day after the previous one finishes.
 * `late` maps a late task to its late working days (section 7.6). Each environment's late days are
 * added after its tasks, so its completion moves by that many days and so does every later environment.
 */
export function happyCase(
  tasks: Task[],
  startIso: string,
  durations?: Map<string, number>,
  late?: Map<string, number>,
): HappyCase {
  const dur = (t: Task) => durations?.get(t.id) ?? t.duration;
  const sorted = [...tasks].sort((a, b) => a.sortOrder - b.sortOrder);
  const plannedClosed = closedPlanMap(tasks, startIso);
  const envs: EnvPlan[] = [];
  const taskDates = new Map<string, { start: string; end: string }>();
  let cursor = 0;

  for (const env of envsPresent(tasks)) {
    const envTasks = sorted.filter((t) => t.environment === env);
    const open = envTasks.filter((t) => !isClosed(t));
    const present = envTasks.length > 0;
    if (open.length === 0) {
      // Finished environment: show the planned dates of its tasks, and later environments start after them
      const dates = envTasks.map((t) => plannedClosed.get(t.id)).filter((d): d is { start: string; end: string } => !!d);
      const start = dates.length ? dates.map((d) => d.start).reduce((a, b) => (a < b ? a : b)) : null;
      const completion = dates.length ? dates.map((d) => d.end).reduce((a, b) => (a > b ? a : b)) : null;
      if (completion) cursor = Math.max(cursor, workIndex(startIso, completion) + 1);
      envs.push({
        env,
        present,
        done: true,
        startIdx: start ? workIndex(startIso, start) : cursor,
        endIdx: cursor,
        start,
        completion,
        late: 0,
      });
      continue;
    }

    const startIdx = cursor;
    for (const t of open) {
      const d = dur(t);
      const s = cursor;
      const e = cursor + d;
      taskDates.set(t.id, {
        start: workdayDate(startIso, s),
        end: d === 0 ? workdayDate(startIso, s) : workdayDate(startIso, e - 1),
      });
      cursor = e;
    }
    const lateDays = open.reduce((n, t) => n + (late?.get(t.id) ?? 0), 0);
    cursor += lateDays;
    const completion = cursor > startIdx ? workdayDate(startIso, cursor - 1) : workdayDate(startIso, startIdx);
    envs.push({
      env,
      present,
      done: false,
      startIdx,
      endIdx: cursor,
      start: workdayDate(startIso, startIdx),
      completion,
      late: lateDays,
    });
  }

  const prod = envs.find((e) => e.env === 'Prod');
  return {
    envs,
    taskDates,
    prodCompletion: prod && !prod.done ? prod.completion : null,
  };
}

/* ---------------- Simulation (7.4) ---------------- */

/** Inverse-CDF sample from a triangular distribution. */
export function sampleTriangular(min: number, mode: number, max: number, u: number): number {
  const c = (mode - min) / (max - min);
  if (u < c) return min + Math.sqrt(u * (max - min) * (mode - min));
  return max - Math.sqrt((1 - u) * (max - min) * (max - mode));
}

export const SIM_RUNS = 1500;

export interface SimResult {
  runs: number;
  lateProbability: number;
  /** Simulated Prod completion date -> number of runs. */
  histogram: { date: string; count: number }[];
  p50: string | null;
  p80: string | null;
}

/**
 * Monte Carlo (7.4). Each run scales open task durations, rounds them to whole days (minimum 1),
 * and recomputes the happy-case Prod completion. Closed tasks take 0 days.
 */
export function simulateProd(
  tasks: Task[],
  startIso: string,
  commitProd: string,
  opts: { runs?: number; random?: () => number } = {},
): SimResult {
  const runs = opts.runs ?? SIM_RUNS;
  const rand = opts.random ?? Math.random;
  const sorted = [...tasks].sort((a, b) => a.sortOrder - b.sortOrder);
  const envList = envsPresent(tasks);

  // Open tasks grouped by environment, in order. Env without open tasks is skipped.
  const groups = envList
    .map((env) => ({
      env,
      items: sorted.filter((t) => t.environment === env && !isClosed(t)),
    }))
    .filter((g) => g.items.length > 0);

  const prodGroup = groups.find((g) => g.env === 'Prod');
  if (!prodGroup) {
    return { runs, lateProbability: 0, histogram: [], p50: null, p80: null };
  }

  const counts = new Map<string, number>();
  let late = 0;
  const completions: string[] = [];

  for (let r = 0; r < runs; r++) {
    let cursor = 0;
    let prodEnd = 0;
    for (const g of groups) {
      let total = 0;
      for (const t of g.items) {
        const factor = t.blocked
          ? sampleTriangular(1.0, 1.5, 2.2, rand())
          : sampleTriangular(0.9, 1.05, 1.4, rand());
        total += Math.max(1, Math.round(t.duration * factor));
      }
      cursor += total;
      if (g.env === 'Prod') prodEnd = cursor;
    }
    const completion = workdayDate(startIso, prodEnd - 1);
    counts.set(completion, (counts.get(completion) ?? 0) + 1);
    completions.push(completion);
    if (completion > commitProd) late++;
  }

  const sortedDates = [...completions].sort();
  const pick = (p: number) => sortedDates[Math.min(sortedDates.length - 1, Math.floor(p * sortedDates.length))] ?? null;

  return {
    runs,
    lateProbability: late / runs,
    histogram: [...counts.entries()].sort(([a], [b]) => (a < b ? -1 : 1)).map(([date, count]) => ({ date, count })),
    p50: pick(0.5),
    p80: pick(0.8),
  };
}

/* ---------------- Health (7.4 and 8) ---------------- */

export type HealthColor = 'red' | 'amber' | 'green';

export function healthColor(projectedProd: string | null, commitProd: string, lateProbability: number): HealthColor {
  if (projectedProd && projectedProd > commitProd) return 'red';
  if (lateProbability > 0.3) return 'amber';
  return 'green';
}

/**
 * Working-day buffer between a completion and a commit date.
 * Positive = days to spare, negative = late. Matches section 8 ("Buffer").
 */
export function bufferDays(completion: string, commit: string): number {
  return workdaysBetween(completion, commit);
}

/* ---------------- Dependencies (validation and downstream) ---------------- */

/** True if `candidate` depends on `taskId` directly or indirectly (following blockedBy). */
export function dependsOn(candidate: string, taskId: string, tasks: Pick<Task, 'id' | 'blockedBy'>[]): boolean {
  const byId = new Map(tasks.map((t) => [t.id, t]));
  const seen = new Set<string>();
  const stack = [candidate];
  while (stack.length) {
    const id = stack.pop()!;
    if (id === taskId) return true;
    if (seen.has(id)) continue;
    seen.add(id);
    for (const b of byId.get(id)?.blockedBy ?? []) stack.push(b);
  }
  return false;
}

/** Reject a new dependency if it would create a loop or points at the task itself. */
export function canAddBlocker(taskId: string, blockerId: string, tasks: Pick<Task, 'id' | 'blockedBy'>[]): string | null {
  if (taskId === blockerId) return 'A task cannot depend on itself.';
  if (dependsOn(blockerId, taskId, tasks)) return 'That would create a loop: that task already depends on this one.';
  return null;
}

/**
 * Open tasks that depend on `taskId`, directly or indirectly (the "Blocks / downstream" list).
 * Closed tasks gate nothing, so the walk does not pass through them.
 */
export function downstreamIds(taskId: string, tasks: Task[]): string[] {
  const open = tasks.filter((t) => !isClosed(t));
  const successors = new Map<string, string[]>();
  for (const t of open) {
    for (const b of t.blockedBy) {
      const list = successors.get(b) ?? [];
      list.push(t.id);
      successors.set(b, list);
    }
  }
  const out = new Set<string>();
  const stack = [...(successors.get(taskId) ?? [])];
  while (stack.length) {
    const id = stack.pop()!;
    if (out.has(id)) continue;
    out.add(id);
    for (const s of successors.get(id) ?? []) stack.push(s);
  }
  return [...out];
}

/* ---------------- Priority (11) ---------------- */

export type PriorityLevel = 'Late' | 'Highest' | 'High' | 'Medium' | 'Low';
const LEVELS: PriorityLevel[] = ['Late', 'Highest', 'High', 'Medium', 'Low'];

export interface PriorityItem {
  task: Task;
  level: PriorityLevel;
  /** Short reason shown next to the level */
  why: string;
  downstream: number;
  /** Risk factor: late 4, open struggle 3, critical path 2, otherwise 1 */
  risk: 1 | 2 | 3 | 4;
  score: number;
  action: string;
}

/**
 * Task priority from today's date (working days):
 * - Late: the task is late (section 2). Always the top level.
 * - Highest: today falls inside the planned window.
 * - High: starts 1 to 3 working days from today.
 * - Medium: starts 4 to 5 working days from today.
 * - Low: starts more than 5 working days from today.
 * A task with more than 2 open struggles moves up one level. Late stays Late.
 */
export function priorityOf(task: Task, plan: TaskPlan | undefined, today: string): { level: PriorityLevel; why: string } {
  // Use the schedule's view when there is one, so Priority agrees with the Gantt
  const l = plan ? { late: plan.late, lateWd: plan.lateWd } : lateness(task, today);
  if (l.late) return { level: 'Late', why: `late by ${l.lateWd} working day${l.lateWd === 1 ? '' : 's'}` };

  let level: PriorityLevel;
  let why: string;
  if (!plan) {
    level = 'Low';
    why = 'not scheduled';
  } else if (plan.start <= today && plan.end >= today) {
    level = 'Highest';
    why = 'planned for today';
  } else if (plan.start < today) {
    level = 'Highest';
    why = 'planned window has started';
  } else {
    const days = workdaysBetween(today, plan.start);
    level = days <= 3 ? 'High' : days <= 5 ? 'Medium' : 'Low';
    why = `starts in ${days} working day${days === 1 ? '' : 's'}`;
  }

  const open = task.issues.filter((i) => !i.solvedAt).length;
  if (open > 2) {
    level = LEVELS[Math.max(0, LEVELS.indexOf(level) - 1)];
    why += `; ${open} open struggles, raised one level`;
  }
  return { level, why };
}

/**
 * Open tasks, sorted by level, then by score (highest first), then by planned start.
 * Score = (dependents + 1) × risk ÷ max(duration, 1). Risk: late 4, open struggle 3, critical path 2, otherwise 1.
 */
export function priorityList(tasks: Task[], schedule: DependencySchedule, today: string): PriorityItem[] {
  const items = tasks
    .filter((t) => !isClosed(t))
    .map((task): PriorityItem => {
      const plan = schedule.plans.get(task.id);
      const { level, why } = priorityOf(task, plan, today);
      const downstream = downstreamIds(task.id, tasks).length;
      const hasOpenStruggle = task.issues.some((i) => !i.solvedAt);
      const risk: 1 | 2 | 3 | 4 = plan?.late ? 4 : hasOpenStruggle ? 3 : plan?.critical ? 2 : 1;
      const score = ((downstream + 1) * risk) / Math.max(task.duration, 1);
      const openStruggle = task.issues.find((i) => !i.solvedAt);
      const action = openStruggle
        ? `Solve struggle: ${openStruggle.reason}`
        : plan?.critical
          ? 'Prioritise resources, do not let it slip'
          : 'Monitor and be ready to help';
      return { task, level, why, downstream, risk, score, action };
    });
  return items.sort(
    (a, b) =>
      LEVELS.indexOf(a.level) - LEVELS.indexOf(b.level) ||
      b.score - a.score ||
      (schedule.plans.get(a.task.id)?.start ?? '').localeCompare(schedule.plans.get(b.task.id)?.start ?? ''),
  );
}

/* ---------------- What-if (10.4) ---------------- */

export interface WhatIfResult {
  baselineFinishIdx: number;
  newFinishIdx: number;
  /** Working days the project finish moves by. */
  shift: number;
  newProdCompletion: string | null;
  buffer: number | null;
  pushed: { id: string; oldStart: string; newStart: string; days: number }[];
}

export function whatIf(
  tasks: Task[],
  startIso: string,
  commitProd: string,
  taskId: string,
  extraDays: number,
  today?: string,
): WhatIfResult {
  const base = dependencySchedule(tasks, startIso, { today });
  const durations = new Map<string, number>();
  const target = tasks.find((t) => t.id === taskId);
  if (target && !isClosed(target)) durations.set(taskId, target.duration + extraDays);
  const next = dependencySchedule(tasks, startIso, { durations, today });

  const pushed: WhatIfResult['pushed'] = [];
  for (const [id, plan] of next.plans) {
    if (id === taskId) continue;
    const old = base.plans.get(id);
    if (!old) continue;
    if (plan.es > old.es) {
      pushed.push({ id, oldStart: old.start, newStart: plan.start, days: plan.es - old.es });
    }
  }
  pushed.sort((a, b) => b.days - a.days);

  // Happy-case Prod completion with the new duration, for the buffer comparison
  const hc = happyCase(tasks, startIso, durations, lateMap(base));
  const buffer = hc.prodCompletion ? bufferDays(hc.prodCompletion, commitProd) : null;

  return {
    baselineFinishIdx: base.finishIdx,
    newFinishIdx: next.finishIdx,
    shift: next.finishIdx - base.finishIdx,
    newProdCompletion: hc.prodCompletion,
    buffer,
    pushed,
  };
}


/** Late working days per late task, for happyCase (section 6). */
export function lateMap(schedule: DependencySchedule): Map<string, number> {
  const out = new Map<string, number>();
  for (const [id, p] of schedule.plans) if (p.late) out.set(id, p.lateWd);
  return out;
}

/**
 * Planned dates of Closed tasks, for the timeline (no late shifts). Closed tasks are not part of the
 * live schedule, so their dates come from a planned pass over every task.
 */
export function closedPlanMap(tasks: Task[], startIso: string): Map<string, { start: string; end: string }> {
  const planned = dependencySchedule(tasks, startIso, { includeClosed: true, ignoreLate: true });
  const out = new Map<string, { start: string; end: string }>();
  for (const t of tasks) {
    if (!isClosed(t)) continue;
    const p = planned.plans.get(t.id);
    if (p) out.set(t.id, { start: p.start, end: p.end });
  }
  return out;
}
