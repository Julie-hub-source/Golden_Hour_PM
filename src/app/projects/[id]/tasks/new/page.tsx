import Link from 'next/link';
import { notFound } from 'next/navigation';
import { loadProjectData } from '@/lib/repo';
import { currentAccount } from '@/lib/session';
import { can } from '@/lib/permissions';
import { isClosed } from '@/lib/schedule';
import { formatDate } from '@/lib/calendar';
import { ENVIRONMENTS, ROLES } from '@/lib/types';
import { ProjectNav } from '@/components/ProjectNav';
import { ActionForm } from '@/components/ActionForm';
import { memberLabel } from '@/lib/types';
import { DateField } from '@/components/DateField';
import { createTask } from '@/app/actions';

export const dynamic = 'force-dynamic';

const DRAFT_PLACEHOLDER = 'New task';

export default async function NewTaskPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const { actor } = await currentAccount();
  const data = await loadProjectData(id);
  if (!data) notFound();
  const { project, tasks, members, memberIds } = data;
  const projectMembers = members.filter((m) => memberIds.includes(m.id));

  if (!can(actor, 'task.create', { projectMemberIds: new Set(memberIds) }).ok) {
    return (
      <>
        <ProjectNav projectId={id} name={project.name} active="board" />
        <p className="empty">Only PM and PO can add tasks.</p>
      </>
    );
  }

  const openTasks = tasks.filter((t) => !isClosed(t));

  return (
    <>
      <ProjectNav projectId={id} name={project.name} active="board" />
      <div style={{ maxWidth: 720 }}>
        <div className="section">
          <h2>New task (draft)</h2>
          <p className="small muted" style={{ marginBottom: 14 }}>
            Nothing is saved until you press Create. Closing this page discards the draft.
          </p>
          <ActionForm action={createTask} submitLabel="Create" hidden={{ projectId: id }}>
            <label className="field">
              Name
              <input type="text" name="name" defaultValue={DRAFT_PLACEHOLDER} required />
            </label>
            <div className="two-col">
              <label className="field">
                Phase
                <input type="text" name="phase" defaultValue="Custom" />
              </label>
              <label className="field">
                Environment
                <select name="environment" defaultValue="UAT">
                  {ENVIRONMENTS.map((e) => (
                    <option key={e} value={e}>
                      {e}
                    </option>
                  ))}
                </select>
              </label>
              <label className="field">
                Role (optional)
                <select name="role" defaultValue="">
                  <option value="">—</option>
                  {ROLES.map((r) => (
                    <option key={r} value={r}>
                      {r}
                    </option>
                  ))}
                </select>
              </label>
              <label className="field">
                PIC
                <select name="picId" defaultValue="">
                  <option value="">Unassigned</option>
                  {projectMembers.map((m) => (
                    <option key={m.id} value={m.id}>
                      {memberLabel(m)}
                    </option>
                  ))}
                </select>
              </label>
              <label className="field">
                Duration (working days, 0–20)
                <select name="duration" defaultValue="1">
                  {Array.from({ length: 21 }, (_, i) => (
                    <option key={i} value={i}>
                      {i}
                    </option>
                  ))}
                </select>
              </label>
              <label className="field">
                Deadline (optional; blank = planned finish)
                <DateField name="deadline" />
              </label>
            </div>
            <label className="field">
              Description
              <textarea name="description" />
            </label>
            <fieldset style={{ border: '1px solid var(--border)', borderRadius: 6, padding: 12, margin: '0 0 10px' }}>
              <legend className="small muted">Depends on (these must finish first)</legend>
              {openTasks.length === 0 && <p className="small muted">No open tasks to depend on.</p>}
              {openTasks.map((t) => (
                <label key={t.id} className="check small">
                  <input type="checkbox" name="blockedBy" value={t.id} />
                  {t.code} {t.name}
                </label>
              ))}
            </fieldset>
            <p className="small muted" style={{ marginBottom: 8 }}>
              Project start: {formatDate(project.startDate)}. <Link href={`/projects/${id}`}>Discard draft</Link>
            </p>
          </ActionForm>
        </div>
      </div>
    </>
  );
}
