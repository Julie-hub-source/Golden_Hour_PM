'use server';

import { randomUUID } from 'node:crypto';
import { revalidatePath } from 'next/cache';
import { cookies } from 'next/headers';
import { db } from '@/lib/supabase';
import { ACCOUNT_COOKIE, currentAccount } from '@/lib/session';
import { authorize, PermissionError, type Action, type Actor } from '@/lib/permissions';
import { loadMembers, loadProjectData, type PortfolioProject } from '@/lib/repo';
import { notify, pmPoAndPic } from '@/lib/notify';
import { addDays, diffDays, formatDate, parseDateInput, todayIso } from '@/lib/calendar';
import { buildDefaultFlow } from '@/lib/project-setup';
import { canAddBlocker, dependencySchedule, isClosed } from '@/lib/schedule';
import { OUTPUT_TYPES, PRIORITIES, ROLES, STATUS_LABEL, STATUSES, ENVIRONMENTS, type Environment, type Role, type Status, type Task } from '@/lib/types';

/* ---------------- Plumbing ---------------- */

export type ActionResult = { ok: true; redirect?: string } | { ok: false; error: string };

class UserError extends Error {}

/** Wraps every action: permission and validation errors go back to the form, the rest is logged. */
async function run(fn: () => Promise<ActionResult>): Promise<ActionResult> {
  try {
    const result = await fn();
    if (result.ok) revalidatePath('/', 'layout');
    return result;
  } catch (e) {
    if (e instanceof PermissionError || e instanceof UserError) return { ok: false, error: e.message };
    console.error(e);
    return { ok: false, error: 'Something went wrong. Please try again.' };
  }
}

const str = (fd: FormData, key: string) => String(fd.get(key) ?? '').trim();
const strs = (fd: FormData, key: string) => fd.getAll(key).map(String).map((s) => s.trim()).filter(Boolean);
const has = (fd: FormData, key: string) => fd.has(key);

function requireActor(actor: Actor | null): Actor {
  if (!actor) throw new UserError('Choose an account first.');
  return actor;
}

async function loadOrFail(projectId: string): Promise<PortfolioProject> {
  const data = await loadProjectData(projectId);
  if (!data) throw new UserError('Project not found.');
  return data;
}

function taskOrFail(data: PortfolioProject, taskId: string): Task {
  const task = data.tasks.find((t) => t.id === taskId);
  if (!task) throw new UserError('Task not found in this project.');
  return task;
}

const scopeOf = (data: PortfolioProject, task?: Pick<Task, 'picId'>) => ({
  projectMemberIds: new Set(data.memberIds),
  task,
});

const nameOf = (data: PortfolioProject, id: string | null) =>
  (id && data.members.find((m) => m.id === id)?.name) || 'unassigned';

async function logChange(taskId: string, projectId: string, memberId: string, action: string) {
  const res = await db().from('task_log').insert({ task_id: taskId, project_id: projectId, member_id: memberId, action });
  if (res.error) throw new Error(res.error.message);
}

function parseDateOrFail(value: string, label: string): string {
  const iso = parseDateInput(value);
  if (!iso) throw new UserError(`${label} must be a real date in D/M/YYYY format.`);
  return iso;
}

function parseOptionalDate(value: string, label: string): string | null {
  if (!value) return null;
  return parseDateOrFail(value, label);
}

function isHttpUrl(value: string): boolean {
  try {
    const u = new URL(value);
    return u.protocol === 'http:' || u.protocol === 'https:';
  } catch {
    return false;
  }
}

function parseDuration(value: string): number {
  if (!/^\d+$/.test(value)) throw new UserError('Duration must be a whole number of working days, 0 to 20.');
  const n = Number(value);
  if (n < 0 || n > 20) throw new UserError('Duration must be a whole number of working days, 0 to 20.');
  return n;
}

/* ---------------- Account ---------------- */

export async function switchAccount(fd: FormData): Promise<ActionResult> {
  return run(async () => {
    const id = str(fd, 'memberId');
    const members = await loadMembers();
    if (!members.some((m) => m.id === id)) throw new UserError('Unknown account.');
    const jar = await cookies();
    jar.set(ACCOUNT_COOKIE, id, { path: '/', sameSite: 'lax', maxAge: 60 * 60 * 24 * 365 });
    return { ok: true };
  });
}

export async function markAllNotificationsRead(): Promise<ActionResult> {
  return run(async () => {
    const { actor } = await currentAccount();
    requireActor(actor);
    const res = await db()
      .from('notifications')
      .update({ read_at: new Date().toISOString() })
      .eq('member_id', actor!.id)
      .is('read_at', null);
    if (res.error) throw new Error(res.error.message);
    return { ok: true };
  });
}

/* ---------------- Projects ---------------- */

export async function createProject(fd: FormData): Promise<ActionResult> {
  return run(async () => {
    const { actor, members } = await currentAccount();
    authorize(actor, 'project.create');

    const name = str(fd, 'name');
    if (!name) throw new UserError('Project name is required.');
    const startDate = parseDateOrFail(str(fd, 'startDate'), 'Start date');
    const commitProd = parseDateOrFail(str(fd, 'commitProd'), 'Prod commit date');
    const memberIds = strs(fd, 'members');
    const selected = members.filter((m) => memberIds.includes(m.id));

    const built = buildDefaultFlow({ startIso: startDate, today: todayIso(), members: selected, newId: randomUUID });

    const projectRes = await db()
      .from('projects')
      .insert({
        name,
        start_date: startDate,
        commit_uat: built.commitUat,
        commit_stg: built.commitStg,
        commit_prod: commitProd,
        priority: 'Medium',
        task_seq: built.tasks.length,
      })
      .select('id')
      .single();
    if (projectRes.error) throw new Error(projectRes.error.message);
    const projectId = projectRes.data.id as string;

    if (selected.length) {
      const pm = await db().from('project_members').insert(selected.map((m) => ({ project_id: projectId, member_id: m.id })));
      if (pm.error) throw new Error(pm.error.message);
    }

    const taskRes = await db().from('tasks').insert(
      built.tasks.map((t) => ({
        id: t.id,
        project_id: projectId,
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
    );
    if (taskRes.error) throw new Error(taskRes.error.message);

    return { ok: true, redirect: `/projects/${projectId}` };
  });
}

/** Start date (PM only). Deadlines shift by the same number of calendar days. Commits keep their dates. */
export async function setProjectStart(fd: FormData): Promise<ActionResult> {
  return run(async () => {
    const { actor } = await currentAccount();
    const projectId = str(fd, 'projectId');
    const data = await loadOrFail(projectId);
    authorize(actor, 'project.setStart', scopeOf(data));
    const newStart = parseDateOrFail(str(fd, 'startDate'), 'Start date');
    const old = data.project.startDate;
    if (newStart === old) return { ok: true };

    const delta = diffDays(old, newStart);
    await db().from('projects').update({ start_date: newStart }).eq('id', projectId);
    await Promise.all(
      data.tasks.map((t) =>
        db().from('tasks').update({ deadline: addDays(t.deadline, delta), alerts: [] }).eq('id', t.id),
      ),
    );
    await notify(data.memberIds, `${actor!.name} changed the start date of ${data.project.name} to ${formatDate(newStart)}.`, projectId);
    return { ok: true };
  });
}

export async function setProjectPriority(fd: FormData): Promise<ActionResult> {
  return run(async () => {
    const { actor } = await currentAccount();
    const projectId = str(fd, 'projectId');
    const data = await loadOrFail(projectId);
    authorize(actor, 'project.setPriority', scopeOf(data));
    const priority = str(fd, 'priority');
    if (!(PRIORITIES as readonly string[]).includes(priority)) throw new UserError('Unknown priority.');
    if (priority === data.project.priority) return { ok: true };
    await db().from('projects').update({ priority }).eq('id', projectId);
    await notify(data.memberIds, `${actor!.name} changed the priority of ${data.project.name} to ${priority}.`, projectId);
    return { ok: true };
  });
}

/** Client commit dates (PM, PO). Prod is required. */
export async function setProjectCommits(fd: FormData): Promise<ActionResult> {
  return run(async () => {
    const { actor } = await currentAccount();
    const projectId = str(fd, 'projectId');
    const data = await loadOrFail(projectId);
    authorize(actor, 'project.setCommit', scopeOf(data));

    const commitUat = parseOptionalDate(str(fd, 'commitUat'), 'UAT commit date');
    const commitStg = parseOptionalDate(str(fd, 'commitStg'), 'STG commit date');
    const commitProd = parseDateOrFail(str(fd, 'commitProd'), 'Prod commit date');

    const p = data.project;
    if (commitUat === p.commitUat && commitStg === p.commitStg && commitProd === p.commitProd) return { ok: true };
    await db().from('projects').update({ commit_uat: commitUat, commit_stg: commitStg, commit_prod: commitProd }).eq('id', projectId);
    await notify(data.memberIds, `${actor!.name} changed the client commit dates of ${p.name}.`, projectId);
    return { ok: true };
  });
}

/** Description: context, client info, related documents, one per line as "Name | link" (PM, PO). */
export async function setProjectDescription(fd: FormData): Promise<ActionResult> {
  return run(async () => {
    const { actor } = await currentAccount();
    const projectId = str(fd, 'projectId');
    const data = await loadOrFail(projectId);
    authorize(actor, 'project.setDescription', scopeOf(data));

    const documents = str(fd, 'documents');
    for (const line of documents.split('\n').map((l) => l.trim()).filter(Boolean)) {
      const parts = line.split('|');
      if (parts.length < 2 || !parts[0].trim() || !isHttpUrl(parts[parts.length - 1].trim())) {
        throw new UserError(`Each document must look like "Name | https://link". Problem line: "${line}"`);
      }
    }

    await db()
      .from('projects')
      .update({ context: str(fd, 'context'), client_info: str(fd, 'clientInfo'), documents })
      .eq('id', projectId);
    await notify(data.memberIds, `${actor!.name} updated the description of ${data.project.name}.`, projectId);
    return { ok: true };
  });
}

/* ---------------- Members ---------------- */

export async function addProjectMember(fd: FormData): Promise<ActionResult> {
  return run(async () => {
    const { actor } = await currentAccount();
    const projectId = str(fd, 'projectId');
    const data = await loadOrFail(projectId);
    authorize(actor, 'project.members', scopeOf(data));
    const memberId = str(fd, 'memberId');
    if (!data.members.some((m) => m.id === memberId)) throw new UserError('Unknown member.');
    if (data.memberIds.includes(memberId)) return { ok: true };
    const res = await db().from('project_members').insert({ project_id: projectId, member_id: memberId });
    if (res.error) throw new Error(res.error.message);
    await notify([memberId], `${actor!.name} added you to ${data.project.name}.`, projectId);
    return { ok: true };
  });
}

/** Removing a member unassigns their open tasks (section 10.5). */
export async function removeProjectMember(fd: FormData): Promise<ActionResult> {
  return run(async () => {
    const { actor } = await currentAccount();
    const projectId = str(fd, 'projectId');
    const data = await loadOrFail(projectId);
    authorize(actor, 'project.members', scopeOf(data));
    const memberId = str(fd, 'memberId');

    const res = await db().from('project_members').delete().eq('project_id', projectId).eq('member_id', memberId);
    if (res.error) throw new Error(res.error.message);
    await Promise.all(
      data.tasks
        .filter((t) => t.picId === memberId && !isClosed(t))
        .map((t) => db().from('tasks').update({ pic_id: null }).eq('id', t.id)),
    );
    await notify([memberId], `${actor!.name} removed you from ${data.project.name}.`, projectId);
    return { ok: true };
  });
}

/** Team-wide: create a member, which also creates their account (PM only). */
export async function createMember(fd: FormData): Promise<ActionResult> {
  return run(async () => {
    const { actor } = await currentAccount();
    authorize(actor, 'member.create');
    const name = str(fd, 'name');
    const role = str(fd, 'role');
    if (!name) throw new UserError('Name is required.');
    if (!(ROLES as readonly string[]).includes(role)) throw new UserError('Choose a valid role.');
    const res = await db().from('members').insert({ name, role });
    if (res.error) throw new Error(res.error.message);
    return { ok: true };
  });
}

/* ---------------- Tasks ---------------- */

const DRAFT_PLACEHOLDER = 'new task';

/**
 * Creates a task from the draft form. Nothing is saved until this runs.
 * The deadline defaults to the planned finish of the new task.
 */
export async function createTask(fd: FormData): Promise<ActionResult> {
  return run(async () => {
    const { actor } = await currentAccount();
    const projectId = str(fd, 'projectId');
    const data = await loadOrFail(projectId);
    authorize(actor, 'task.create', scopeOf(data));

    const name = str(fd, 'name');
    if (!name || name.toLowerCase() === DRAFT_PLACEHOLDER) throw new UserError('Give the task a name before creating it.');
    const phase = str(fd, 'phase') || 'Custom';
    const environment = str(fd, 'environment') as Environment;
    if (!(ENVIRONMENTS as readonly string[]).includes(environment)) throw new UserError('Choose an environment.');
    const roleValue = str(fd, 'role');
    if (roleValue && !(ROLES as readonly string[]).includes(roleValue)) throw new UserError('Choose a valid role.');
    const picId = str(fd, 'picId') || null;
    if (picId && !data.memberIds.includes(picId)) throw new UserError('The PIC must be a project member.');
    const duration = parseDuration(str(fd, 'duration') || '0');
    const blockedBy = strs(fd, 'blockedBy');
    const taskIds = new Set(data.tasks.map((t) => t.id));
    if (blockedBy.some((b) => !taskIds.has(b))) throw new UserError('A dependency is not a task in this project.');

    const newId = randomUUID();
    const deadlineInput = str(fd, 'deadline');
    let deadline = parseOptionalDate(deadlineInput, 'Deadline');
    if (!deadline) {
      const withNew: Task[] = [
        ...data.tasks,
        { ...blankTask(newId, projectId), name, environment, duration, blockedBy },
      ];
      // Planned finish for the default deadline: no late shifts, the task is new
      const plan = dependencySchedule(withNew, data.project.startDate, { ignoreLate: true });
      deadline = plan.plans.get(newId)?.end ?? data.project.startDate;
    }

    const seq = data.project.taskSeq + 1;
    const code = `T${String(seq).padStart(2, '0')}`;
    const sortOrder = Math.max(0, ...data.tasks.map((t) => t.sortOrder)) + 1;
    const today = todayIso();

    const pRes = await db().from('projects').update({ task_seq: seq }).eq('id', projectId);
    if (pRes.error) throw new Error(pRes.error.message);
    const tRes = await db().from('tasks').insert({
      id: newId,
      project_id: projectId,
      code,
      name,
      phase,
      environment,
      role: (roleValue || null) as Role | null,
      pic_id: picId,
      status: 'todo',
      duration,
      deadline,
      description: str(fd, 'description'),
      since_date: today,
      alerts: [],
      blocked_by: blockedBy,
      sort_order: sortOrder,
    });
    if (tRes.error) throw new Error(tRes.error.message);

    await logChange(newId, projectId, actor!.id, 'created');
    await notify(data.memberIds, `${actor!.name} added ${code} "${name}".`, projectId);
    return { ok: true, redirect: `/projects/${projectId}/tasks/${newId}` };
  });
}

function blankTask(id: string, projectId: string): Task {
  return {
    id,
    projectId,
    code: '',
    name: '',
    phase: 'Custom',
    environment: 'UAT',
    role: null,
    picId: null,
    status: 'todo',
    duration: 0,
    deadline: '',
    blockedBy: [],
    blocked: false,
    issues: [],
    description: '',
    sinceDate: '',
    alerts: [],
    sortOrder: 0,
    outputs: [],
  };
}

const FIELD_ACTION: Record<string, Action> = {
  name: 'task.rename',
  deadline: 'task.deadline',
  blockedBy: 'task.blockedBy',
  picId: 'task.pic',
  duration: 'task.duration',
  status: 'task.status',
  description: 'task.description',
  block: 'task.block',
};

/**
 * Updates any subset of task fields in one call. Each changed field is checked against its own
 * permission (section 3). Sends the notifications from section 12.2.
 */
export async function updateTask(fd: FormData): Promise<ActionResult> {
  return run(async () => {
    const { actor } = await currentAccount();
    const projectId = str(fd, 'projectId');
    const data = await loadOrFail(projectId);
    const task = taskOrFail(data, str(fd, 'taskId'));
    const scope = scopeOf(data, task);

    const patch: Record<string, unknown> = {};
    const changes: { field: keyof typeof FIELD_ACTION; text: string }[] = [];
    const who = actor!.name;

    // Name
    if (has(fd, 'name')) {
      const name = str(fd, 'name');
      if (!name) throw new UserError('Task name is required.');
      if (name !== task.name) {
        authorize(actor, FIELD_ACTION.name, scope);
        patch.name = name;
        changes.push({ field: 'name', text: `${who} renamed ${task.code} to "${name}".` });
      }
    }

    // Deadline (resets alerts)
    if (has(fd, 'deadline')) {
      const deadline = parseOptionalDate(str(fd, 'deadline'), 'Deadline');
      if (!deadline) throw new UserError('Deadline is required.');
      if (deadline !== task.deadline) {
        authorize(actor, FIELD_ACTION.deadline, scope);
        patch.deadline = deadline;
        patch.alerts = [];
        changes.push({ field: 'deadline', text: `${who} changed the deadline of ${task.code} to ${formatDate(deadline)}.` });
      }
    }

    // Duration
    if (has(fd, 'duration')) {
      const duration = parseDuration(str(fd, 'duration'));
      if (duration !== task.duration) {
        authorize(actor, FIELD_ACTION.duration, scope);
        patch.duration = duration;
        changes.push({ field: 'duration', text: `${who} changed the duration of ${task.code} to ${duration} working days.` });
      }
    }

    // PIC (empty = unassigned)
    if (has(fd, 'picId')) {
      const picId = str(fd, 'picId') || null;
      if (picId && !data.memberIds.includes(picId)) throw new UserError('The PIC must be a project member.');
      if (picId !== task.picId) {
        authorize(actor, FIELD_ACTION.picId, scope);
        patch.pic_id = picId;
        changes.push({ field: 'picId', text: `${who} set the PIC of ${task.code} to ${nameOf(data, picId)}.` });
      }
    }

    // Status (sets since_date and resets alerts)
    if (has(fd, 'status')) {
      const status = str(fd, 'status') as Status;
      if (!(STATUSES as readonly string[]).includes(status)) throw new UserError('Unknown status.');
      if (status !== task.status) {
        authorize(actor, FIELD_ACTION.status, scope);
        patch.status = status;
        patch.since_date = todayIso();
        // The To-do alert resets on any status change. The late alert resets only when the task is reopened.
        const reopened = task.status === 'closed' && status !== 'closed';
        patch.alerts = reopened ? [] : task.alerts.filter((a) => a !== 'todo');
        changes.push({ field: 'status', text: `${who} changed the status of ${task.code} to ${STATUS_LABEL[status]}.` });
      }
    }

    // Description
    if (has(fd, 'description')) {
      const description = str(fd, 'description');
      if (description !== task.description) {
        authorize(actor, FIELD_ACTION.description, scope);
        patch.description = description;
        changes.push({ field: 'description', text: `${who} updated the description of ${task.code}.` });
      }
    }

    // Depends on: cycle check against the graph with this task's new list
    if (has(fd, 'blockedBy')) {
      const next = [...new Set(strs(fd, 'blockedBy'))];
      const prev = [...task.blockedBy].sort().join(',');
      if (next.sort().join(',') !== prev) {
        authorize(actor, FIELD_ACTION.blockedBy, scope);
        const ids = new Set(data.tasks.map((t) => t.id));
        const graph = data.tasks.map((t) => (t.id === task.id ? { ...t, blockedBy: next } : t));
        for (const b of next) {
          if (!ids.has(b)) throw new UserError('A dependency is not a task in this project.');
          const err = canAddBlocker(task.id, b, graph);
          if (err) throw new UserError(err);
        }
        patch.blocked_by = next;
        changes.push({ field: 'blockedBy', text: `${who} changed what ${task.code} depends on.` });
      }
    }

    if (changes.length === 0) return { ok: true };

    const up = await db().from('tasks').update(patch).eq('id', task.id);
    if (up.error) throw new Error(up.error.message);

    // Recipients: PM, PO and the PIC after the change (12.2). Renames go to every member.
    const newPicId = has(fd, 'picId') ? (str(fd, 'picId') || null) : task.picId;
    const recipients = pmPoAndPic(data, { picId: newPicId });
    for (const c of changes) {
      if (c.field === 'name') await notify(data.memberIds, c.text, projectId, actor!.id);
      else await notify(recipients, c.text, projectId, actor!.id); // recipients already include the new PIC
      await logChange(task.id, projectId, actor!.id, c.text);
    }

    return { ok: true };
  });
}

/* ---------------- Struggles (shown as flames) ---------------- */

/** Adds a struggle to a task. Each one is a flame until it is solved. PIC, PM and PO can add one. */
export async function addTaskIssue(fd: FormData): Promise<ActionResult> {
  return run(async () => {
    const { actor } = await currentAccount();
    const projectId = str(fd, 'projectId');
    const data = await loadOrFail(projectId);
    const task = taskOrFail(data, str(fd, 'taskId'));
    authorize(actor, FIELD_ACTION.block, scopeOf(data, task));
    const reason = str(fd, 'reason');
    if (!reason) throw new UserError('Describe the struggle before adding it.');

    const res = await db().from('task_issues').insert({ task_id: task.id, reason, created_by: actor!.id });
    if (res.error) throw new Error(res.error.message);
    const text = `${actor!.name} flagged a struggle on ${task.code} "${task.name}": ${reason}`;
    await notify(pmPoAndPic(data, task), text, projectId, actor!.id);
    await logChange(task.id, projectId, actor!.id, text);
    return { ok: true };
  });
}

/** Marks a struggle as solved, or reopens it. A solved flame is shown with a strike-through. */
export async function setTaskIssueSolved(fd: FormData): Promise<ActionResult> {
  return run(async () => {
    const { actor } = await currentAccount();
    const projectId = str(fd, 'projectId');
    const data = await loadOrFail(projectId);
    const task = taskOrFail(data, str(fd, 'taskId'));
    authorize(actor, FIELD_ACTION.block, scopeOf(data, task));
    const issue = task.issues.find((i) => i.id === str(fd, 'issueId'));
    if (!issue) throw new UserError('Struggle not found on this task.');

    const solve = str(fd, 'solved') !== 'false';
    if (solve === !!issue.solvedAt) return { ok: true };
    const res = await db().from('task_issues').update({ solved_at: solve ? new Date().toISOString() : null }).eq('id', issue.id);
    if (res.error) throw new Error(res.error.message);
    const text = solve
      ? `${actor!.name} solved a struggle on ${task.code} "${task.name}": ${issue.reason}`
      : `${actor!.name} reopened a struggle on ${task.code} "${task.name}": ${issue.reason}`;
    await notify(pmPoAndPic(data, task), text, projectId, actor!.id);
    await logChange(task.id, projectId, actor!.id, text);
    return { ok: true };
  });
}

export async function deleteTask(fd: FormData): Promise<ActionResult> {
  return run(async () => {
    const { actor } = await currentAccount();
    const projectId = str(fd, 'projectId');
    const data = await loadOrFail(projectId);
    const task = taskOrFail(data, str(fd, 'taskId'));
    authorize(actor, 'task.delete', scopeOf(data, task));

    // Remove this task from other tasks' depends-on lists first
    await Promise.all(
      data.tasks
        .filter((t) => t.blockedBy.includes(task.id))
        .map((t) => db().from('tasks').update({ blocked_by: t.blockedBy.filter((b) => b !== task.id) }).eq('id', t.id)),
    );
    const del = await db().from('tasks').delete().eq('id', task.id);
    if (del.error) throw new Error(del.error.message);
    await notify(data.memberIds, `${actor!.name} deleted ${task.code} "${task.name}".`, projectId, actor!.id);
    return { ok: true, redirect: `/projects/${projectId}` };
  });
}

/* ---------------- Outputs ---------------- */

export async function addTaskOutput(fd: FormData): Promise<ActionResult> {
  return run(async () => {
    const { actor } = await currentAccount();
    const projectId = str(fd, 'projectId');
    const data = await loadOrFail(projectId);
    const task = taskOrFail(data, str(fd, 'taskId'));
    authorize(actor, 'task.output', scopeOf(data, task));

    const type = str(fd, 'type');
    if (!(OUTPUT_TYPES as readonly string[]).includes(type)) throw new UserError('Choose an output type.');
    const url = str(fd, 'url');
    if (!isHttpUrl(url)) throw new UserError('The link must be an absolute http or https URL.');

    const res = await db().from('task_outputs').insert({ task_id: task.id, type, url, added_by: actor!.id });
    if (res.error) throw new Error(res.error.message);
    const text = `${actor!.name} added a ${type} link to ${task.code}.`;
    await notify(pmPoAndPic(data, task), text, projectId, actor!.id);
    await logChange(task.id, projectId, actor!.id, text);
    return { ok: true };
  });
}

export async function removeTaskOutput(fd: FormData): Promise<ActionResult> {
  return run(async () => {
    const { actor } = await currentAccount();
    const projectId = str(fd, 'projectId');
    const data = await loadOrFail(projectId);
    const task = taskOrFail(data, str(fd, 'taskId'));
    authorize(actor, 'task.output', scopeOf(data, task));
    const res = await db().from('task_outputs').delete().eq('id', str(fd, 'outputId')).eq('task_id', task.id);
    if (res.error) throw new Error(res.error.message);
    return { ok: true };
  });
}
