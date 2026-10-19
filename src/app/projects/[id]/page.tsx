import Link from 'next/link';
import { notFound } from 'next/navigation';
import { loadProjectData } from '@/lib/repo';
import { currentAccount } from '@/lib/session';
import { runDueAlerts } from '@/lib/notify';
import { can } from '@/lib/permissions';
import { dependencySchedule, isClosed, envsPresent } from '@/lib/schedule';
import { formatDate } from '@/lib/calendar';
import { STATUSES, STATUS_LABEL, type Status, type Task } from '@/lib/types';
import { AutoSelect } from '@/components/AutoSelect';
import { ProjectNav } from '@/components/ProjectNav';
import { updateTask } from '@/app/actions';
import { memberLabel } from '@/lib/types';
import { TaskModal } from '@/components/TaskModal';
import { taskLink } from '@/lib/links';

export const dynamic = 'force-dynamic';

const DURATIONS = Array.from({ length: 21 }, (_, i) => String(i));

interface SearchParams {
  pic?: string;
  env?: string;
  status?: string;
  /** Task whose detail popup is open */
  open?: string;
}

export default async function BoardPage({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<SearchParams> }) {
  const { id } = await params;
  const sp = await searchParams;
  const { actor } = await currentAccount();
  await runDueAlerts();
  const data = await loadProjectData(id);
  if (!data) notFound();

  const { project, members, tasks, memberIds } = data;
  const memberById = new Map(members.map((m) => [m.id, m]));
  const projectMembers = members.filter((m) => memberIds.includes(m.id));
  const scope = { projectMemberIds: new Set(memberIds) };
  const schedule = dependencySchedule(tasks, project.startDate);
  const taskById = new Map(tasks.map((t) => [t.id, t]));

  // Filters combine with AND
  const envOptions = envsPresent(tasks);
  const filtered = tasks.filter((t) => {
    if (sp.pic && (sp.pic === 'none' ? t.picId !== null : t.picId !== sp.pic)) return false;
    if (sp.env && t.environment !== sp.env) return false;
    if (sp.status && t.status !== sp.status) return false;
    return true;
  });

  const canCreate = can(actor, 'task.create', scope).ok;
  // The popup opens on this page with the current filters, and closing it keeps them
  const filterQs = new URLSearchParams(
    Object.entries({ pic: sp.pic, env: sp.env, status: sp.status }).filter((e): e is [string, string] => !!e[1]),
  ).toString();
  const base = `/projects/${id}${filterQs ? `?${filterQs}` : ''}`;

  return (
    <>
      <ProjectNav projectId={id} name={project.name} active="board" />

      <div className="row small muted" style={{ marginBottom: 12, gap: 18 }}>
        <span>Start {formatDate(project.startDate)}</span>
        <span>Prod commit {formatDate(project.commitProd)}</span>
        <span>Priority {project.priority}</span>
        <span>
          {tasks.filter(isClosed).length} / {tasks.length} closed
        </span>
      </div>


      <form method="get" className="filters">
        <label className="field">
          PIC
          <select name="pic" defaultValue={sp.pic ?? ''}>
            <option value="">All</option>
            <option value="none">Unassigned</option>
            {projectMembers.map((m) => (
              <option key={m.id} value={m.id}>
                {m.name}
              </option>
            ))}
          </select>
        </label>
        <label className="field">
          Environment
          <select name="env" defaultValue={sp.env ?? ''}>
            <option value="">All</option>
            {envOptions.map((e) => (
              <option key={e} value={e}>
                {e}
              </option>
            ))}
          </select>
        </label>
        <label className="field">
          Status
          <select name="status" defaultValue={sp.status ?? ''}>
            <option value="">All</option>
            {STATUSES.map((s) => (
              <option key={s} value={s}>
                {STATUS_LABEL[s]}
              </option>
            ))}
          </select>
        </label>
        <button type="submit">Filter</button>
        <Link href={`/projects/${id}`} className="small" style={{ alignSelf: 'center' }}>
          Clear
        </Link>
        {canCreate && (
          <Link href={`/projects/${id}/tasks/new`} className="pill" style={{ marginLeft: 'auto', padding: '7px 14px', fontSize: 13 }}>
            + Add task
          </Link>
        )}
      </form>

      <div className="board">
        {STATUSES.map((status) => {
          const col = filtered.filter((t) => t.status === status);
          return (
            <section key={status} className={`col s-${status}`}>
              <div className="colh">
                <span>{STATUS_LABEL[status]}</span>
                <span>{col.length}</span>
              </div>
              {col.map((t) => (
                <TaskCard
                  key={t.id}
                  task={t}
                  projectId={id}
                  base={base}
                  members={projectMembers}
                  memberName={(picId) => (picId && memberById.get(picId) ? memberLabel(memberById.get(picId)!) : picId ? '—' : 'Unassigned')}
                  activeBlockers={t.blockedBy.map((b) => taskById.get(b)).filter((b): b is Task => !!b && !isClosed(b))}
                  critical={schedule.plans.get(t.id)?.critical ?? false}
                  actorCan={(action) => can(actor, action, { ...scope, task: t }).ok}
                />
              ))}
            </section>
          );
        })}
      </div>

      {filtered.length === 0 && <p className="empty">No tasks match these filters.</p>}

      {sp.open && tasks.some((t) => t.id === sp.open) && (
        <TaskModal projectId={id} taskId={sp.open} base={base} closeHref={base} />
      )}
    </>
  );
}

function TaskCard({
  task,
  projectId,
  base,
  members,
  memberName,
  activeBlockers,
  critical,
  actorCan,
}: {
  task: Task;
  projectId: string;
  base: string;
  members: { id: string; name: string; role: string }[];
  memberName: (picId: string | null) => string;
  activeBlockers: Task[];
  critical: boolean;
  actorCan: (action: 'task.pic' | 'task.duration' | 'task.status') => boolean;
}) {
  const classes = ['ct', task.blocked ? 'bl' : '', critical ? 'crit' : ''].join(' ').trim();
  const hidden = { projectId, taskId: task.id };
  return (
    <div className={classes}>
      <div className="meta">
        <span className={`env-tag env-${task.environment.toLowerCase()}`}>{task.environment}</span> {task.phase}
      </div>
      <Link href={taskLink(base, task.id)} scroll={false} style={{ color: 'var(--text)', fontWeight: 600 }}>
        <span className="muted small">{task.code}</span> {task.name}
      </Link>
      {activeBlockers.length > 0 && (
        <div className="meta">Depends on {activeBlockers.map((b) => b.code).join(', ')}</div>
      )}
      <div className="meta">Deadline {formatDate(task.deadline)} · {task.duration}d</div>
      {task.issues.length > 0 && (
        <div className="flames">
          {task.issues.map((i) => (
            <span key={i.id} className={`flame ${i.solvedAt ? 'solved' : ''}`} title={i.solvedAt ? 'Solved' : 'Open'}>
              🔥
            </span>
          ))}
        </div>
      )}
      <div className="controls">
        <AutoSelect
          action={updateTask}
          name="picId"
          value={task.picId ?? ''}
          options={[{ value: '', label: 'Unassigned' }, ...members.map((m) => ({ value: m.id, label: memberLabel(m) }))]}
          hidden={hidden}
          disabled={!actorCan('task.pic')}
          label={`PIC of ${task.code}`}
        />
        <AutoSelect
          action={updateTask}
          name="duration"
          value={String(task.duration)}
          options={DURATIONS.map((d) => ({ value: d, label: `${d} working days` }))}
          hidden={hidden}
          disabled={!actorCan('task.duration')}
          label={`Duration of ${task.code}`}
        />
        <AutoSelect
          action={updateTask}
          name="status"
          value={task.status}
          options={STATUSES.map((s) => ({ value: s, label: STATUS_LABEL[s as Status] }))}
          hidden={hidden}
          disabled={!actorCan('task.status')}
          label={`Status of ${task.code}`}
        />
      </div>
      <div className="meta small" style={{ marginTop: 4 }}>{memberName(task.picId)}</div>
    </div>
  );
}
