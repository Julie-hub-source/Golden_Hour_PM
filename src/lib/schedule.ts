/**
 * Scheduling engine (CLAUDE.md sections 7, 8, 11).
 * Pure functions: no I/O, no dates from the system clock. Callers pass the project start and today.
 */
import { workdayDate, workdaysBetween } from './calendar';
import { ENVIRONMENTS, type Environment, type Task } from './types';

export const isClosed = (t: Pick<Task, 'status'>) => t.status === 'closed';

export interface TaskPlan {
  id: string;
  /** Dependency-schedule indices (working days from project start). */
  es: number;
  ef: number;
  ls: number;
  lf: number;
  slack: number;
  critical: boolean;
  /** Calendar dates. For a zero-duration task both are the same day. */
  start: string;
  end: string;
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

  const es = new Map<string, number>();
  const ef = new Map<string, number>();
  for (const id of order) {
    const t = byId.get(id)!;
    let start = 0;
    for (const b of t.blockedBy) if (ids.has(b)) start = Math.max(start, ef.get(b) ?? 0);
    es.set(id, start);
    ef.set(id, start + dur(id));
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
    });
  }

  const finishDate = finishIdx > 0 ? workdayDate(startIso, finishIdx - 1) : startIso;
  return { plans, finishIdx, finishDate, completeDate: finishDate };
}

/** Complete date (7.3): start + longest chain of working days, all tasks at planned duration. */
export function completeDate(tasks: Task[], startIso: string): string {
  return dependencySchedule(tasks, startIso, { includeClosed: true }).finishDate;
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
 */
export function happyCase(tasks: Task[], startIso: string, durations?: Map<string, number>): HappyCase {
  const dur = (t: Task) => durations?.get(t.id) ?? t.duration;
  const sorted = [...tasks].sort((a, b) => a.sortOrder - b.sortOrder);
  const envs: EnvPlan[] = [];
  const taskDates = new Map<string, { start: string; end: string }>();
  let cursor = 0;

  for (const env of envsPresent(tasks)) {
    const envTasks = sorted.filter((t) => t.environment === env);
    const open = envTasks.filter((t) => !isClosed(t));
    const present = envTasks.length > 0;
    if (open.length === 0) {
      envs.push({ env, present, done: true, startIdx: cursor, endIdx: cursor, start: null, completion: null });
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
    const completion = cursor > startIdx ? workdayDate(startIso, cursor - 1) : workdayDate(startIso, startIdx);
    envs.push({
      env,
      present,
      done: false,
      startIdx,
      endIdx: cursor,
      start: workdayDate(startIso, startIdx),
      completion,
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
 * Positive = days to spare, negative = late. Matches section 8 ("Buffer / late").
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

/** Reject a new blocker if it would create a cycle or is the task itself. */
export function canAddBlocker(taskId: string, blockerId: string, tasks: Pick<Task, 'id' | 'blockedBy'>[]): string | null {
  if (taskId === blockerId) return 'A task cannot be its own blocker.';
  if (dependsOn(blockerId, taskId, tasks)) return 'That would create a cycle: the blocker already depends on this task.';
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

export interface PriorityItem {
  task: Task;
  downstream: number;
  risk: 1 | 2 | 3;
  score: number;
  action: string;
}

export function priorityList(tasks: Task[], schedule: DependencySchedule, limit = 8): PriorityItem[] {
  const open = tasks.filter((t) => !isClosed(t));
  const items = open.map((task) => {
    const downstream = downstreamIds(task.id, tasks).length;
    const plan = schedule.plans.get(task.id);
    const risk: 1 | 2 | 3 = task.blocked ? 3 : plan?.critical ? 2 : 1;
    const score = ((downstream + 1) * risk) / Math.max(task.duration, 1);
    const action = task.blocked
      ? `Clear blocker: ${task.blocker}`
      : risk === 2
        ? 'Prioritise resources, do not let it slip'
        : 'Monitor and be ready to help';
    return { task, downstream, risk, score, action } as PriorityItem;
  });
  return items.sort((a, b) => b.score - a.score).slice(0, limit);
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
): WhatIfResult {
  const base = dependencySchedule(tasks, startIso);
  const durations = new Map<string, number>();
  const target = tasks.find((t) => t.id === taskId);
  if (target && !isClosed(target)) durations.set(taskId, target.duration + extraDays);
  const next = dependencySchedule(tasks, startIso, { durations });

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
  const hc = happyCase(tasks, startIso, durations);
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

