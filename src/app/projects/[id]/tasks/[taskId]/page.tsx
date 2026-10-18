import Link from 'next/link';
import { notFound } from 'next/navigation';
import { loadProjectData, loadTaskLog } from '@/lib/repo';
import { currentAccount } from '@/lib/session';
import { can, type Action } from '@/lib/permissions';
import { dependencySchedule, downstreamIds, isClosed } from '@/lib/schedule';
import { formatDate, weekdayShort } from '@/lib/calendar';
import { OUTPUT_TYPES, STATUSES, STATUS_LABEL, type Task } from '@/lib/types';
import { ProjectNav } from '@/components/ProjectNav';
import { ActionForm } from '@/components/ActionForm';
import { updateTask, deleteTask, addTaskOutput, removeTaskOutput } from '@/app/actions';

export const dynamic = 'force-dynamic';

const DURATIONS = Array.from({ length: 21 }, (_, i) => i);

export default async function TaskDetailPage({ params }: { params: Promise<{ id: string; taskId: string }> }) {
  const { id, taskId } = await params;
  const { actor } = await currentAccount();
  const data = await loadProjectData(id);
  if (!data) notFound();
  const { project, tasks, members, memberIds } = data;
  const task = tasks.find((t) => t.id === taskId);
  if (!task) notFound();

  const log = await loadTaskLog(task.id);
  const scope = { projectMemberIds: new Set(memberIds), task };
  const allowed = (action: Action) => can(actor, action, scope).ok;
  const projectMembers = members.filter((m) => memberIds.includes(m.id));
  const taskById = new Map(tasks.map((t) => [t.id, t]));
  const schedule = dependencySchedule(tasks, project.startDate);
  const plan = schedule.plans.get(task.id);

  const activeBlockers = task.blockedBy.map((b) => taskById.get(b)).filter((b): b is Task => !!b && !isClosed(b));
  const blocksAll = downstreamIds(task.id, tasks).map((d) => taskById.get(d)).filter((d): d is Task => !!d);
  const otherTasks = tasks.filter((t) => t.id !== task.id);

  const canEditDetails = allowed('task.rename') || allowed('task.deadline') || allowed('task.blockedBy') || allowed('task.pic') || allowed('task.duration') || allowed('task.status') || allowed('task.description') || allowed('task.block');
  const canEditBlockedBy = allowed('task.blockedBy');
  const canDelete = allowed('task.delete');
  const canOutput = allowed('task.output');

  return (
    <>
      <ProjectNav projectId={id} name={project.name} active="board" />

      <div className="detail-grid">
        <div>
          <div className="section">
            <p className="small muted" style={{ marginBottom: 4 }}>
              {task.code} · {task.phase} · {task.environment}
              {task.role ? ` · designed for ${task.role}` : ''}
            </p>
            <h2 style={{ fontSize: 18 }}>{task.name}</h2>
            {task.alerts.length > 0 && (
              <p className="small">
                <span className="pill amber">alerts sent: {task.alerts.join(', ')}</span>
              </p>
            )}

            <ActionForm action={updateTask} submitLabel="Save changes" hidden={{ projectId: id, taskId: task.id }}>
              <fieldset disabled={!canEditDetails} style={{ border: 0, padding: 0, margin: 0, minWidth: 0 }}>
                <label className="field">
                  Task name
                  <input type="text" name="name" defaultValue={task.name} disabled={!allowed('task.rename')} />
                </label>
                <div className="two-col">
                  <label className="field">
                    PIC
                    <select name="picId" defaultValue={task.picId ?? ''} disabled={!allowed('task.pic')}>
                      <option value="">Unassigned</option>
                      {projectMembers.map((m) => (
                        <option key={m.id} value={m.id}>
                          {m.name} ({m.role})
                        </option>
                      ))}
                    </select>
                  </label>
                  <label className="field">
                    Duration (working days)
                    <select name="duration" defaultValue={String(task.duration)} disabled={!allowed('task.duration')}>
                      {DURATIONS.map((d) => (
                        <option key={d} value={d}>
                          {d}
                        </option>
                      ))}
                    </select>
                  </label>
                  <label className="field">
                    Status
                    <select name="status" defaultValue={task.status} disabled={!allowed('task.status')}>
                      {STATUSES.map((s) => (
                        <option key={s} value={s}>
                          {STATUS_LABEL[s]}
                        </option>
                      ))}
                    </select>
                  </label>
                  <label className="field">
                    Task deadline (dd/mm/yy)
                    <input type="text" name="deadline" defaultValue={formatDate(task.deadline)} disabled={!allowed('task.deadline')} />
                  </label>
                </div>
                <label className="field">
                  Description
                  <textarea name="description" defaultValue={task.description} disabled={!allowed('task.description')} />
                </label>

                <fieldset style={{ border: '1px solid var(--border)', borderRadius: 6, padding: 12, margin: '0 0 10px' }}>
                  <legend className="small muted">Blocked by</legend>
                  {canEditBlockedBy && <input type="hidden" name="blockedBy" value="" />}
                  {otherTasks.length === 0 && <p className="small muted">No other tasks.</p>}
                  {otherTasks.map((t) => (
                    <label key={t.id} className="check small">
                      <input
                        type="checkbox"
                        name="blockedBy"
                        value={t.id}
                        defaultChecked={task.blockedBy.includes(t.id)}
                        disabled={!canEditBlockedBy}
                      />
                      {t.code} {t.name}
                      {isClosed(t) && <span className="muted"> — closed, not blocking</span>}
                    </label>
                  ))}
                </fieldset>

                <fieldset style={{ border: '1px solid var(--border)', borderRadius: 6, padding: 12, margin: '0 0 10px' }}>
                  <legend className="small muted">Issue</legend>
                  <label className="field">
                    Blocked?
                    <select name="blocked" defaultValue={task.blocked ? 'true' : 'false'} disabled={!allowed('task.block')}>
                      <option value="false">No</option>
                      <option value="true">Yes, mark as blocked</option>
                    </select>
                  </label>
                  <label className="field">
                    Reason (required when blocked)
                    <input type="text" name="blocker" defaultValue={task.blocker} disabled={!allowed('task.block')} />
                  </label>
                </fieldset>
              </fieldset>
              {!canEditDetails && <p className="small muted">You can only change tasks where you are the PIC.</p>}
            </ActionForm>
          </div>

          <div className="section">
            <h2>Outputs (links)</h2>
            {task.outputs.length === 0 && <p className="muted small">No links yet.</p>}
            <ul style={{ paddingLeft: 18, margin: '0 0 12px' }}>
              {task.outputs.map((o) => {
                const who = members.find((m) => m.id === o.addedBy)?.name ?? 'unknown';
                return (
                  <li key={o.id} style={{ marginBottom: 6 }}>
                    <span className="pill">{o.type}</span>{' '}
                    <a href={o.url} target="_blank" rel="noreferrer">
                      {o.url}
                    </a>{' '}
                    <span className="small muted">
                      by {who}, {formatDate(o.addedAt.slice(0, 10))}
                    </span>
                    {canOutput && (
                      <ActionForm action={removeTaskOutput} submitLabel="Remove" hidden={{ projectId: id, taskId: task.id, outputId: o.id }} className="inline-form">
                        {null}
                      </ActionForm>
                    )}
                  </li>
                );
              })}
            </ul>
            {canOutput && (
              <ActionForm action={addTaskOutput} submitLabel="Add link" hidden={{ projectId: id, taskId: task.id }}>
                <div className="two-col">
                  <label className="field">
                    Type
                    <select name="type" defaultValue="Other">
                      {OUTPUT_TYPES.map((t) => (
                        <option key={t} value={t}>
                          {t}
                        </option>
                      ))}
                    </select>
                  </label>
                  <label className="field">
                    URL (https://…)
                    <input type="url" name="url" required placeholder="https://" />
                  </label>
                </div>
              </ActionForm>
            )}
          </div>

          {canDelete && (
            <div className="section">
              <h2>Delete task</h2>
              <p className="small muted">Removes it from other tasks&apos; blocked-by lists. Its links are deleted too.</p>
              <ActionForm action={deleteTask} submitLabel="Delete task" danger hidden={{ projectId: id, taskId: task.id }} confirm={`Delete ${task.code} "${task.name}"?`}>
                {null}
              </ActionForm>
            </div>
          )}
        </div>

        <aside>
          <div className="section">
            <h2>Schedule</h2>
            {plan ? (
              <dl className="facts small">
                <dt>Projected start</dt>
                <dd>
                  {weekdayShort(plan.start)} {formatDate(plan.start)}
                </dd>
                <dt>Projected finish</dt>
                <dd>
                  {weekdayShort(plan.end)} {formatDate(plan.end)}
                </dd>
                <dt>Slack</dt>
                <dd>{plan.critical ? <span className="pill amber">Critical path</span> : `${plan.slack} working days`}</dd>
                <dt>Deadline</dt>
                <dd>{formatDate(task.deadline)}</dd>
              </dl>
            ) : (
              <p className="muted small">Closed tasks take no time and are not scheduled.</p>
            )}
          </div>

          <div className="section">
            <h2>Blocked by</h2>
            {task.blockedBy.length === 0 && <p className="muted small">Nothing. This task can start right away.</p>}
            <ul className="log">
              {task.blockedBy.map((b) => {
                const t = taskById.get(b);
                if (!t) return null;
                return (
                  <li key={b}>
                    <Link href={`/projects/${id}/tasks/${t.id}`}>
                      {t.code} {t.name}
                    </Link>{' '}
                    {isClosed(t) ? <span className="muted small">(closed, not blocking)</span> : <span className="pill">open</span>}
                  </li>
                );
              })}
            </ul>
            {activeBlockers.length > 0 && <p className="small">{activeBlockers.length} active blocker(s).</p>}
          </div>

          <div className="section">
            <h2>Blocks ({blocksAll.length})</h2>
            {blocksAll.length === 0 && <p className="muted small">No open tasks depend on this one.</p>}
            <div className="blocks-list">
              {blocksAll.slice(0, 3).map((t) => (
                <Link key={t.id} href={`/projects/${id}/tasks/${t.id}`} className="pill">
                  {t.code} {t.name}
                </Link>
              ))}
            </div>
            {blocksAll.length > 3 && (
              <details style={{ marginTop: 8 }}>
                <summary className="small">Show more</summary>
                <div className="blocks-list">
                  {blocksAll.slice(3).map((t) => (
                    <Link key={t.id} href={`/projects/${id}/tasks/${t.id}`} className="pill">
                      {t.code} {t.name}
                    </Link>
                  ))}
                </div>
              </details>
            )}
          </div>

          <div className="section">
            <h2>Activity</h2>
            {log.length === 0 && <p className="muted small">No changes logged yet.</p>}
            <ul className="log small">
              {log.map((l) => (
                <li key={l.id}>
                  {l.action} <span className="muted">· {formatDate(l.createdAt.slice(0, 10))}</span>
                </li>
              ))}
            </ul>
          </div>
        </aside>
      </div>
    </>
  );
}
