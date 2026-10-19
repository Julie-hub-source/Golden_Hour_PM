/**
 * Permission checks (CLAUDE.md section 3). This is the single place where rules live.
 * Server actions call `authorize` before every write. The UI uses the same function to hide controls.
 * When real authentication arrives, only `getActor` in session.ts needs to change.
 */
import type { Member, Role, Task } from './types';

export type Action =
  | 'project.create'
  | 'project.setStart'
  | 'project.setPriority'
  | 'project.setCommit'
  | 'project.setDescription'
  | 'project.members'
  | 'project.delete'
  | 'member.create'
  | 'task.create'
  | 'task.delete'
  | 'task.rename'
  | 'task.deadline'
  | 'task.blockedBy'
  | 'task.pic'
  | 'task.duration'
  | 'task.status'
  | 'task.description'
  | 'task.output'
  | 'task.block';

export interface Actor {
  id: string;
  role: Role;
  name: string;
}

export interface Scope {
  /** Member ids of the project. Omit for actions that are not tied to a project. */
  projectMemberIds?: Set<string>;
  /** The project has task deletion turned off. */
  taskDeleteLocked?: boolean;
  /** Task for PIC-scoped actions. */
  task?: Pick<Task, 'picId'>;
}

const isPM = (a: Actor) => a.role === 'PM';
const isPMorPO = (a: Actor) => a.role === 'PM' || a.role === 'PO';

/** Actions that only PM may perform. */
const PM_ONLY: Action[] = [
  'project.create',
  'project.setStart',
  'project.setPriority',
  'project.members',
  'project.delete',
  'member.create',
];

/** Actions that PM and PO may perform on any task of their project. */
const PM_PO: Action[] = [
  'project.setCommit',
  'project.setDescription',
  'task.create',
  'task.delete',
  'task.rename',
  'task.deadline',
  'task.blockedBy',
];

/** Actions that PM and PO may perform on any task, and any other member only on tasks where they are PIC. */
const PIC_SCOPED: Action[] = [
  'task.pic',
  'task.duration',
  'task.status',
  'task.description',
  'task.output',
  'task.block',
];

export type Decision = { ok: true } | { ok: false; reason: string };

export function can(actor: Actor | null | undefined, action: Action, scope: Scope = {}): Decision {
  if (!actor) return { ok: false, reason: 'Choose an account first.' };
  // A locked project cannot have tasks or the project itself deleted
  if ((action === 'task.delete' || action === 'project.delete') && scope.taskDeleteLocked) {
    return { ok: false, reason: 'This project is locked against deletion.' };
  }

  // Project-scoped actions need project membership. PM is the project admin and may act on any project.
  const needsProject = action !== 'project.create' && action !== 'member.create';
  if (needsProject && scope.projectMemberIds && !isPM(actor) && !scope.projectMemberIds.has(actor.id)) {
    return { ok: false, reason: 'You are not a member of this project.' };
  }

  if (PM_ONLY.includes(action)) {
    return isPM(actor) ? { ok: true } : { ok: false, reason: 'Only PM can do this.' };
  }

  if (PM_PO.includes(action)) {
    return isPMorPO(actor) ? { ok: true } : { ok: false, reason: 'Only PM or PO can do this.' };
  }

  if (PIC_SCOPED.includes(action)) {
    if (isPMorPO(actor)) return { ok: true };
    if (scope.task && scope.task.picId === actor.id) return { ok: true };
    return { ok: false, reason: 'Only the PIC of this task, PM or PO can change it.' };
  }

  return { ok: false, reason: 'Unknown action.' };
}

export function authorize(actor: Actor | null | undefined, action: Action, scope: Scope = {}): void {
  const decision = can(actor, action, scope);
  if (!decision.ok) throw new PermissionError(decision.reason);
}

export class PermissionError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'PermissionError';
  }
}

export function toActor(member: Member | null | undefined): Actor | null {
  return member ? { id: member.id, role: member.role, name: member.name } : null;
}
