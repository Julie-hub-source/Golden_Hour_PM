/** Alert rules (CLAUDE.md section 12.1). Pure functions. Sending and storing happen in notify.ts. */
import { workdaysAfter } from './calendar';
import { isClosed } from './schedule';
import type { Task } from './types';

export const OVERDUE_THRESHOLD_WORKDAYS = 2;
export const TODO_THRESHOLD_WORKDAYS = 2;

export interface DueAlert {
  kind: 'late' | 'todo';
  /** Working days past the deadline, or working days in To do. */
  days: number;
}

/**
 * Which alerts are due today for a task and not yet sent.
 * - late: open, and more than 2 working days past the deadline.
 * - todo: status is todo, and more than 2 working days since the last status change.
 */
export function dueAlerts(task: Pick<Task, 'status' | 'deadline' | 'sinceDate' | 'alerts'>, today: string): DueAlert[] {
  const out: DueAlert[] = [];
  if (isClosed(task)) return out;

  if (!task.alerts.includes('late') && workdaysAfter(task.deadline, today) > OVERDUE_THRESHOLD_WORKDAYS) {
    out.push({ kind: 'late', days: workdaysAfter(task.deadline, today) });
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
    return `⚠ ${task.code} "${task.name}" is ${alert.days} working days past its planned end (${formatDate(task.deadline)}). PIC: ${pic}.`;
  }
  return `⚠ ${task.code} "${task.name}" has been To do for ${alert.days} working days. PIC: ${pic}.`;
}
