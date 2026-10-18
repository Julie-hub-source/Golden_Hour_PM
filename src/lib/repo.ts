import 'server-only';
import { createHash } from 'node:crypto';
import { db } from './supabase';
import { simulateProd, type SimResult, happyCase, healthColor, type HealthColor, completeDate, bufferDays, isClosed } from './schedule';
import type { Member, Project, ProjectData, Task, TaskOutput, Role, Environment, Status, Priority, OutputType } from './types';

/* ---------------- Row types (snake_case from Postgres) ---------------- */

interface MemberRow { id: string; name: string; role: Role }
interface ProjectRow {
  id: string; name: string; start_date: string; commit_uat: string | null; commit_stg: string | null;
  commit_prod: string; priority: Priority; context: string; client_info: string; documents: string; task_seq: number;
}
interface TaskRow {
  id: string; project_id: string; code: string; name: string; phase: string; environment: Environment;
  role: Role | null; pic_id: string | null; status: Status; duration: number; deadline: string; blocked: boolean;
  blocker: string; description: string; since_date: string; alerts: string[]; blocked_by: string[]; sort_order: number;
}
interface OutputRow { id: string; task_id: string; type: OutputType; url: string; added_by: string | null; added_at: string }

export const mapMember = (r: MemberRow): Member => ({ id: r.id, name: r.name, role: r.role });

export const mapProject = (r: ProjectRow): Project => ({
  id: r.id,
  name: r.name,
  startDate: r.start_date,
  commitUat: r.commit_uat,
  commitStg: r.commit_stg,
  commitProd: r.commit_prod,
  priority: r.priority,
  context: r.context,
  clientInfo: r.client_info,
  documents: r.documents,
  taskSeq: r.task_seq,
});

const mapTask = (r: TaskRow, outputs: TaskOutput[]): Task => ({
  id: r.id,
  projectId: r.project_id,
  code: r.code,
  name: r.name,
  phase: r.phase,
  environment: r.environment,
  role: r.role,
  picId: r.pic_id,
  status: r.status,
  duration: r.duration,
  deadline: r.deadline,
  blockedBy: r.blocked_by ?? [],
  blocked: r.blocked,
  blocker: r.blocker,
  description: r.description,
  sinceDate: r.since_date,
  alerts: r.alerts ?? [],
  sortOrder: r.sort_order,
  outputs,
});

const mapOutput = (r: OutputRow): TaskOutput => ({ id: r.id, type: r.type, url: r.url, addedBy: r.added_by, addedAt: r.added_at });

const TASK_COLUMNS =
  'id, project_id, code, name, phase, environment, role, pic_id, status, duration, deadline, blocked, blocker, description, since_date, alerts, blocked_by, sort_order';

function must<T>(res: { data: T | null; error: { message: string } | null }): T {
  if (res.error) throw new Error(res.error.message);
  return (res.data ?? []) as T;
}

/* ---------------- Loaders ---------------- */

export async function loadMembers(): Promise<Member[]> {
  const rows = must<MemberRow[]>(await db().from('members').select('id, name, role').order('name'));
  return rows.map(mapMember);
}

export interface PortfolioProject extends ProjectData {
  /** Member ids of the project. */
  memberIds: string[];
}

/** Everything for one project, with outputs. Returns null when it does not exist. */
export async function loadProjectData(projectId: string): Promise<PortfolioProject | null> {
  const projectRes = await db().from('projects').select('*').eq('id', projectId).maybeSingle();
  if (projectRes.error) throw new Error(projectRes.error.message);
  if (!projectRes.data) return null;
  const project = mapProject(projectRes.data as ProjectRow);

  const pm = must<{ member_id: string }[]>(
    await db().from('project_members').select('member_id').eq('project_id', projectId),
  );
  const memberIds = pm.map((r) => r.member_id);

  const members = must<MemberRow[]>(await db().from('members').select('id, name, role').order('name')).map(mapMember);

  const taskRows = must<TaskRow[]>(
    await db().from('tasks').select(TASK_COLUMNS).eq('project_id', projectId).order('sort_order'),
  );
  const taskIds = taskRows.map((t) => t.id);
  const outRows = taskIds.length
    ? must<OutputRow[]>(await db().from('task_outputs').select('*').in('task_id', taskIds).order('added_at'))
    : [];
  const outputsByTask = new Map<string, TaskOutput[]>();
  for (const o of outRows) {
    const list = outputsByTask.get(o.task_id) ?? [];
    list.push(mapOutput(o));
    outputsByTask.set(o.task_id, list);
  }
  const tasks = taskRows.map((t) => mapTask(t, outputsByTask.get(t.id) ?? []));

  return { project, members, tasks, memberIds };
}

/** Lightweight portfolio: all projects (with members and tasks, no outputs). Used by lists, alerts, team. */
export interface Portfolio {
  members: Member[];
  projects: (Project & { memberIds: string[] })[];
  tasksByProject: Map<string, Task[]>;
}

export async function loadPortfolio(): Promise<Portfolio> {
  const [memberRows, projectRows, pmRows, taskRows] = await Promise.all([
    db().from('members').select('id, name, role').order('name'),
    db().from('projects').select('*').order('created_at'),
    db().from('project_members').select('project_id, member_id'),
    db().from('tasks').select(TASK_COLUMNS).order('sort_order'),
  ]);
  const members = must<MemberRow[]>(memberRows).map(mapMember);
  const pms = must<{ project_id: string; member_id: string }[]>(pmRows);
  const memberIdsByProject = new Map<string, string[]>();
  for (const r of pms) {
    const list = memberIdsByProject.get(r.project_id) ?? [];
    list.push(r.member_id);
    memberIdsByProject.set(r.project_id, list);
  }
  const projects = must<ProjectRow[]>(projectRows).map((r) => ({
    ...mapProject(r),
    memberIds: memberIdsByProject.get(r.id) ?? [],
  }));
  const tasksByProject = new Map<string, Task[]>();
  for (const r of must<TaskRow[]>(taskRows)) {
    const list = tasksByProject.get(r.project_id) ?? [];
    list.push(mapTask(r, []));
    tasksByProject.set(r.project_id, list);
  }
  return { members, projects, tasksByProject };
}

/* ---------------- Health with cached simulation (7.4) ---------------- */

export interface Health {
  color: HealthColor;
  projectedProd: string | null;
  commitProd: string;
  lateProbability: number;
  p50: string | null;
  p80: string | null;
  histogram: { date: string; count: number }[];
  /** Working-day buffer on the projected Prod completion. Negative = late. Null when Prod is Done. */
  buffer: number | null;
  happy: ReturnType<typeof happyCase>;
  completeDate: string;
  cached: boolean;
}

/** Hash of every input the simulation depends on. A change in any of them triggers a recompute. */
function simInputHash(data: PortfolioProject): string {
  const p = data.project;
  const tasks = [...data.tasks]
    .sort((a, b) => a.code.localeCompare(b.code))
    .map((t) => [t.id, t.environment, t.duration, t.status, t.blocked, [...t.blockedBy].sort()]);
  return createHash('sha256')
    .update(JSON.stringify([p.startDate, p.commitProd, tasks]))
    .digest('hex');
}

export async function getHealth(data: PortfolioProject): Promise<Health> {
  const { project, tasks } = data;
  const happy = happyCase(tasks, project.startDate);
  const hash = simInputHash(data);

  let sim: SimResult | null = null;
  let cached = false;
  const cachedRes = await db().from('sim_cache').select('input_hash, payload').eq('project_id', project.id).maybeSingle();
  if (!cachedRes.error && cachedRes.data && cachedRes.data.input_hash === hash) {
    sim = cachedRes.data.payload as SimResult;
    cached = true;
  } else {
    sim = simulateProd(tasks, project.startDate, project.commitProd);
    await db()
      .from('sim_cache')
      .upsert({ project_id: project.id, input_hash: hash, payload: sim, computed_at: new Date().toISOString() });
  }

  const projected = happy.prodCompletion;
  return {
    color: healthColor(projected, project.commitProd, sim.lateProbability),
    projectedProd: projected,
    commitProd: project.commitProd,
    lateProbability: sim.lateProbability,
    p50: sim.p50,
    p80: sim.p80,
    histogram: sim.histogram,
    buffer: projected ? bufferDays(projected, project.commitProd) : null,
    happy,
    completeDate: completeDate(tasks, project.startDate),
    cached,
  };
}

/** Progress summary for the project list card. */
export function projectSummary(tasks: Task[]) {
  const closed = tasks.filter(isClosed).length;
  return { total: tasks.length, closed };
}

export interface NotificationRow {
  id: string;
  message: string;
  projectId: string | null;
  projectName: string | null;
  createdAt: string;
  read: boolean;
}

export async function loadNotifications(memberId: string): Promise<NotificationRow[]> {
  const rows = must<{ id: string; message: string; project_id: string | null; created_at: string; read_at: string | null; projects: { name: string }[] | null }[]>(
    await db()
      .from('notifications')
      .select('id, message, project_id, created_at, read_at, projects(name)')
      .eq('member_id', memberId)
      .order('created_at', { ascending: false })
      .limit(200),
  );
  return rows.map((r) => ({
    id: r.id,
    message: r.message,
    projectId: r.project_id,
    projectName: r.projects?.[0]?.name ?? null,
    createdAt: r.created_at,
    read: r.read_at !== null,
  }));
}

export async function unreadCount(memberId: string): Promise<number> {
  const res = await db().from('notifications').select('id', { count: 'exact', head: true }).eq('member_id', memberId).is('read_at', null);
  if (res.error) throw new Error(res.error.message);
  return res.count ?? 0;
}

/** Task change log for the detail page (simple log, section 15). */
export async function loadTaskLog(taskId: string): Promise<{ id: number; action: string; createdAt: string; memberName: string | null }[]> {
  const rows = must<{ id: number; action: string; created_at: string; members: { name: string }[] | null }[]>(
    await db()
      .from('task_log')
      .select('id, action, created_at, members(name)')
      .eq('task_id', taskId)
      .order('created_at', { ascending: false })
      .limit(50),
  );
  return rows.map((r) => ({ id: r.id, action: r.action, createdAt: r.created_at, memberName: r.members?.[0]?.name ?? null }));
}
