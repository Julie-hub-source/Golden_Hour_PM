import 'server-only';
import { db } from './supabase';
import { loadPortfolio, type PortfolioProject } from './repo';
import { dueAlerts, alertMessage } from './alerts';
import { dependencySchedule } from './schedule';
import { formatDate, todayIso } from './calendar';
import type { Task } from './types';

/** Insert in-app notifications for each recipient, skipping the actor. */
export async function notify(recipientIds: string[], message: string, projectId: string | null, exceptId?: string | null) {
  const ids = [...new Set(recipientIds)].filter((id) => id !== exceptId);
  if (ids.length === 0) return;
  const res = await db()
    .from('notifications')
    .insert(ids.map((member_id) => ({ member_id, project_id: projectId, message })));
  if (res.error) throw new Error(res.error.message);
}

/** PM and PO of the project, plus the PIC of the task (section 12.2). */
export function pmPoAndPic(data: PortfolioProject, task: Pick<Task, 'picId'> | null): string[] {
  const roleOf = new Map(data.members.map((m) => [m.id, m.role]));
  const pmPo = data.memberIds.filter((id) => {
    const role = roleOf.get(id);
    return role === 'PM' || role === 'PO';
  });
  return task?.picId ? [...pmPo, task.picId] : pmPo;
}

/**
 * Checks every open task for due alerts and sends them once (section 12.1).
 * Idempotent: a task's `alerts` field records what was already sent.
 * Run on app load and daily from the cron route.
 */
export async function runDueAlerts(today: string = todayIso()): Promise<{ sent: number }> {
  const pf = await loadPortfolio();
  const memberName = new Map(pf.members.map((m) => [m.id, m.name]));
  let sent = 0;

  for (const project of pf.projects) {
    const tasks = pf.tasksByProject.get(project.id) ?? [];
    // Lateness comes from the schedule, so a task that has not started yet is never reported late
    const plans = dependencySchedule(tasks, project.startDate, { today }).plans;
    for (const task of tasks) {
      const due = dueAlerts(task, today, plans.get(task.id));
      if (due.length === 0) continue;

      const picName = task.picId ? memberName.get(task.picId) ?? null : null;
      for (const alert of due) {
        const msg = alertMessage(alert, task, picName, formatDate);
        await notify(project.memberIds, msg, project.id);
        sent++;
      }
      const alerts = [...new Set([...task.alerts, ...due.map((d) => d.kind)])];
      const upd = await db().from('tasks').update({ alerts }).eq('id', task.id);
      if (upd.error) throw new Error(upd.error.message);
    }
  }
  return { sent };
}
