/** Alert rules (CLAUDE.md section 12.1 and section 2 of the late rules). Pure functions. Sending and storing happen in notify.ts. */
import { workdaysAfter } from './calendar';
import { isClosed, lateness } from './schedule';
import type { Task } from './types';

export const TODO_THRESHOLD_WORKDAYS = 2;

export interface DueAlert {
  kind: 'late' | 'todo';
  /** Late: working days after the deadline, up to today. To do: working days in To do. */
  days: number;
}

/**
 * Which alerts are due today for a task and not yet sent.
 * - late: the task is late (open and deadline strictly before today). Sent once per deadline and per reopen.
 * - todo: status is todo, and more than 2 working days since the last status change.
 */
export function dueAlerts(
  task: Pick<Task, 'status' | 'deadline' | 'sinceDate' | 'alerts'>,
  today: string,
  plan?: { late: boolean; lateWd: number },
): DueAlert[] {
  const out: DueAlert[] = [];
  if (isClosed(task)) return out;

  // The schedule knows whether the task has started; without it, fall back to the deadline rule alone
  const late = plan ?? lateness(task, today);
  if (late.late && !task.alerts.includes('late')) {
    out.push({ kind: 'late', days: late.lateWd });
  }
  if (task.status === 'todo' && !task.alerts.includes('todo') && workdaysAfter(task.sinceDate, today) > TODO_THRESHOLD_WORKDAYS) {
    out.push({ kind: 'todo', days: workdaysAfter(task.sinceDate, today) });
  }
  return out;
}

export function alertMessage(
  alert: DueAlert,
  task: Pick<Task, 'code' | 'name' | 'deadline'>,
  picName: string | null,
  formatDate: (iso: string) => string,
): string {
  const pic = picName ?? 'unassigned';
  if (alert.kind === 'late') {
    return `LATE: ${task.code} "${task.name}" passed its deadline (${formatDate(task.deadline)}) by ${alert.days} working day(s). PIC: ${pic}.`;
  }
  return `⚠ ${task.code} "${task.name}" has been To do for ${alert.days} working days. PIC: ${pic}.`;
}
