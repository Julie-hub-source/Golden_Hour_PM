import Link from 'next/link';
import { notFound } from 'next/navigation';
import { getHealth, loadPortfolio, loadProjectData } from '@/lib/repo';
import { currentAccount } from '@/lib/session';
import { runDueAlerts } from '@/lib/notify';
import { can } from '@/lib/permissions';
import { bufferDays, closedPlanMap, dependencySchedule, isClosed, priorityList, whatIf } from '@/lib/schedule';
import { formatDate, todayIso } from '@/lib/calendar';
import { ProjectNav } from '@/components/ProjectNav';
import { STATUS_LABEL, memberLabel } from '@/lib/types';
import { CommitDates } from '@/components/CommitDates';
import { ProjectDescription } from '@/components/ProjectDescription';
import { Timeline } from '@/components/Timeline';
import { DependencyTree } from '@/components/DependencyTree';
import { TaskModal } from '@/components/TaskModal';
import { taskLink } from '@/lib/links';

export const dynamic = 'force-dynamic';

const TABS = [
  { key: 'health', label: 'Health & workload' },
  { key: 'timeline', label: 'Task timeline' },
  { key: 'whatif', label: 'What-if' },
  { key: 'priority', label: 'Priority' },
] as const;

type TabKey = (typeof TABS)[number]['key'];

interface SearchParams {
  tab?: string;
  task?: string;
  delay?: string;
  /** Task whose detail popup is open */
  open?: string;
}

const pct = (x: number) => `${Math.round(x * 100)}%`;

/** Date in the format used by the environment timeline, e.g. "Mon 19/10/26". */
const wd = (iso: string) => formatDate(iso);

/** Colour of each environment column (same palette as the health boxes). */
const ENV_TONE: Record<string, string> = { UAT: 'tone-blue', STG: 'tone-purple', Prod: 'tone-green' };

/** Colour of each role in the workload table. */
const ROLE_COLOUR: Record<string, string> = {
  PM: '#64748b', PO: '#6366f1', BA: '#0d9488', Designer: '#db2777', FE: '#3b82f6', BE: '#16a34a', QC: '#d97706',
};

export default async function DashboardPage({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<SearchParams> }) {
  const { id } = await params;
  const sp = await searchParams;
  const tab: TabKey = (TABS.find((t) => t.key === sp.tab)?.key ?? 'health') as TabKey;
  const { actor } = await currentAccount();
  await runDueAlerts();

  const data = await loadProjectData(id);
  if (!data) notFound();
  const { project, tasks, members, memberIds } = data;
  const canCommit = can(actor, 'project.setCommit', { projectMemberIds: new Set(memberIds) }).ok;
  const base = `/projects/${id}/dashboard?tab=${tab}`;

  return (
    <>
      <ProjectNav projectId={id} name={project.name} active="dashboard" />
      <nav className="tabs">
        {TABS.map((t) => (
          <Link key={t.key} href={`/projects/${id}/dashboard?tab=${t.key}`} className={t.key === tab ? 'active' : undefined}>
            {t.label}
          </Link>
        ))}
      </nav>

      {tab === 'health' && <HealthTab data={data} canCommit={canCommit} projectId={id} />}

      {tab === 'timeline' && (
        <>
          <Timeline
            baseHref={base}
            tasks={tasks}
            members={members}
            schedule={dependencySchedule(tasks, project.startDate)}
            closedPlans={closedPlanMap(tasks, project.startDate)}
            commitProd={project.commitProd}
          />
          <DependencyTree baseHref={base} tasks={tasks} members={members} schedule={dependencySchedule(tasks, project.startDate)} />
        </>
      )}

      {tab === 'whatif' && <WhatIfTab tasks={tasks} startDate={project.startDate} commitProd={project.commitProd} sp={sp} projectId={id} />}

      {tab === 'priority' && <PriorityTab tasks={tasks} members={members} startDate={project.startDate} base={base} today={todayIso()} />}

      {sp.open && tasks.some((t) => t.id === sp.open) && (
        <TaskModal projectId={id} taskId={sp.open} base={base} closeHref={base} />
      )}
    </>
  );
}

async function HealthTab({
  data,
  canCommit,
  projectId,
}: {
  data: NonNullable<Awaited<ReturnType<typeof loadProjectData>>>;
  canCommit: boolean;
  projectId: string;
}) {
  const { project, tasks, members } = data;
  // The health numbers and the workload table are independent, so load them together
  const [health, portfolio] = await Promise.all([getHealth(data), loadPortfolio()]);
  const closedCount = tasks.filter(isClosed).length;

  const banner =
    health.color === 'red' && health.projectedProd
      ? `Projected Prod completion ${formatDate(health.projectedProd)} is after the client commit ${formatDate(project.commitProd)} by ${Math.abs(health.buffer ?? 0)} working day(s).`
      : health.color === 'amber'
        ? `Projected completion ${formatDate(health.projectedProd)} is within the commit, but ${pct(health.lateProbability)} of simulated runs finish late.`
        : health.projectedProd
          ? `On track: projected Prod completion ${formatDate(health.projectedProd)} against commit ${formatDate(project.commitProd)}.`
          : 'All Prod tasks are closed.';

  const envs = health.happy.envs;
  const commitFor = (env: string) =>
    env === 'UAT' ? project.commitUat : env === 'STG' ? project.commitStg : project.commitProd;

  const workload = members
    .map((m) => {
      const projects = portfolio.projects.filter((p) => p.memberIds.includes(m.id));
      const open = projects.flatMap((p) => (portfolio.tasksByProject.get(p.id) ?? []).filter((t) => t.picId === m.id && !isClosed(t)));
      return {
        member: m,
        projects: projects.length,
        openTasks: open.length,
      };
    })
    .filter((w) => w.projects > 0 || w.openTasks > 0);

  return (
    <>
      <ProjectDescription projectId={projectId} project={project} />

      <div className={`banner ${health.color}`}>
        <strong>{health.color === 'red' ? 'Late' : health.color === 'amber' ? 'At risk' : 'On track'}.</strong> {banner}
      </div>

      <div className="kpis">
        <div className="kpi tone-blue">
          <div className="label">Projected Prod completion</div>
          <div className="value" style={{ fontSize: 18 }}>{health.projectedProd ? wd(health.projectedProd) : 'Done'}</div>
          <div className="hint">End date of the current plan (happy case)</div>
        </div>
        <div className="kpi tone-purple">
          <div className="label">Client commitment (Prod)</div>
          <div className="value" style={{ fontSize: 18 }}>{wd(project.commitProd)}</div>
          <div className="hint">Prod commit date agreed with the client</div>
        </div>
        <div className="kpi tone-amber">
          <div className="label">Buffer</div>
          <div
            className="value"
            style={{ fontSize: 18, color: health.buffer !== null && health.buffer < 0 ? 'var(--red)' : undefined }}
          >
            {health.buffer === null
              ? '—'
              : health.buffer === 0
                ? '0 days: right at deadline'
                : health.buffer > 0
                  ? `+${health.buffer} working days (spare)`
                  : `${health.buffer} working days (late)`}
          </div>
          <div className="hint">Working days between commitment and projection. Negative = late</div>
        </div>
        <div className="kpi tone-green">
          <div className="label">Progress</div>
          <div className="value" style={{ fontSize: 18 }}>
            {closedCount}/{tasks.length} ({tasks.length ? Math.round((closedCount / tasks.length) * 100) : 0}%)
          </div>
          <div className="hint">Closed tasks / total tasks</div>
        </div>
      </div>

      <div className="card">
        <h3>Environment timeline</h3>
        <div>
          <div>
            <table>
              <thead>
                <tr>
                  <th />
                  {envs.map((e) => (
                    <th key={e.env} className={`env-head ${ENV_TONE[e.env] ?? ''}`}>{e.done ? `${e.env} (done)` : e.env}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                <tr>
                  <td className="k">0) Start</td>
                  {envs.map((e) => (
                    <td key={e.env}>{e.start ? wd(e.start) : "—"}</td>
                  ))}
                </tr>
                <tr>
                  <td className="k">1) Task completion (projected)</td>
                  {envs.map((e) => (
                    <td key={e.env}>{e.completion ? wd(e.completion) : "—"}</td>
                  ))}
                </tr>
                <tr>
                  <td className="k">Late (working days)</td>
                  {envs.map((e) => (
                    <td key={e.env}>
                      <span className={`tag ${e.late > 0 ? 't-red' : 't-green'}`}>{`+${e.late}`}</span>
                    </td>
                  ))}
                </tr>
                <tr>
                  <td className="k">2) Client commitment</td>
                  <CommitDates
                    projectId={projectId}
                    envs={envs.map((e) => e.env)}
                    commits={{ commitUat: project.commitUat, commitStg: project.commitStg, commitProd: project.commitProd }}
                    canEdit={canCommit}
                  />
                </tr>
                <tr>
                  <td className="k">Buffer (working days)</td>
                  {envs.map((e) => {
                    // Finished environments show their buffer too
                    const commit = commitFor(e.env);
                    if (!commit || !e.completion) return <td key={e.env}>—</td>;
                    const b = bufferDays(e.completion, commit);
                    return (
                      <td key={e.env}>
                        <span className={`tag ${b >= 0 ? 't-green' : 't-red'}`}>{b >= 0 ? `+${b}` : b}</span>
                      </td>
                    );
                  })}
                </tr>
              </tbody>
            </table>
          </div>
          {!canCommit && <p className="small muted" style={{ marginTop: 8 }}>Only PM and PO can change client commitments.</p>}
        </div>
      </div>

      <div className="card">
        <h3>Workload by person (all projects)</h3>
        <table className="workload">
          <thead>
            <tr>
              <th>Name</th>
              <th>Role</th>
              <th className="num">Projects</th>
              <th>Open tasks</th>
            </tr>
          </thead>
          <tbody>
            {workload.map((w) => {
              const most = Math.max(1, ...workload.map((x) => x.openTasks));
              const colour = ROLE_COLOUR[w.member.role] ?? '#64748b';
              return (
                <tr key={w.member.id}>
                  <td style={{ fontWeight: 600 }}>{w.member.name}</td>
                  <td>
                    <span className="role-pill" style={{ background: `${colour}1a`, color: colour }}>{w.member.role}</span>
                  </td>
                  <td className="num">{w.projects}</td>
                  <td>
                    <div className="bar-cell">
                      <span className="bar-track">
                        <span className="bar-fill" style={{ width: `${(w.openTasks / most) * 100}%`, background: colour }} />
                      </span>
                      <span className="bar-num">{w.openTasks}</span>
                    </div>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </>
  );
}

function WhatIfTab({
  tasks,
  startDate,
  commitProd,
  sp,
  projectId,
}: {
  tasks: Parameters<typeof whatIf>[0];
  startDate: string;
  commitProd: string;
  sp: SearchParams;
  projectId: string;
}) {
  const open = tasks.filter((t) => !isClosed(t));
  const chosen = open.find((t) => t.id === sp.task) ?? open[0];
  const delay = Math.min(10, Math.max(0, Number.parseInt(sp.delay ?? '0', 10) || 0));
  const result = chosen ? whatIf(tasks, startDate, commitProd, chosen.id, delay) : null;
  const byId = new Map(tasks.map((t) => [t.id, t]));

  return (
    <div className="two-col">
      <div className="card accent-purple">
        <h3>What if a task slips?</h3>
        <p className="small muted" style={{ marginBottom: 12 }}>
          Pick an open task and an extra delay in working days (0–10). The projection re-runs the schedule.
        </p>
        <form method="get" className="filters" style={{ alignItems: 'flex-end' }}>
          <input type="hidden" name="tab" value="whatif" />
          <label className="field" style={{ flex: 1 }}>
            Task
            <select name="task" defaultValue={chosen?.id ?? ''}>
              {open.map((t) => (
                <option key={t.id} value={t.id}>
                  {t.code} {t.name}
                </option>
              ))}
            </select>
          </label>
          <label className="field">
            Extra delay (working days)
            <input type="number" name="delay" min={0} max={10} defaultValue={delay} style={{ width: 100 }} />
          </label>
          <button type="submit" className="primary">
            Run
          </button>
        </form>
        <p className="small">
          <Link href={`/projects/${projectId}`}>Back to board</Link>
        </p>
      </div>

      <div className="card accent-blue">
        <h3>Result</h3>
        {!result && <p className="empty">No open tasks to test.</p>}
        {result && (
          <>
            <div className="kpis" style={{ marginBottom: 14 }}>
              <div className="kpi tone-blue">
                <div className="label">Projected Prod completion</div>
                <div className="value" style={{ fontSize: 18 }}>{result.newProdCompletion ? wd(result.newProdCompletion) : 'Done'}</div>
              </div>
              <div className="kpi tone-amber">
                <div className="label">Project finish moves by</div>
                <div className="value" style={{ fontSize: 18 }}>{result.shift} working day(s)</div>
              </div>
              <div className={`kpi ${result.buffer !== null && result.buffer < 0 ? 'tone-red' : 'tone-green'}`}>
                <div className="label">Buffer vs Prod commit</div>
                <div className="value" style={{ fontSize: 18 }}>{result.buffer === null ? '—' : result.buffer >= 0 ? `+${result.buffer} wd spare` : `${Math.abs(result.buffer)} wd late`}</div>
              </div>
            </div>
            <h3 style={{ margin: '14px 0 6px' }}>Pushed back</h3>
            {result.pushed.length === 0 && <p className="small muted">No other task moves.</p>}
            <ul className="log small">
              {result.pushed.map((p) => {
                const t = byId.get(p.id);
                return (
                  <li key={p.id}>
                    {t?.code} {t?.name}: starts {formatDate(p.oldStart)} → {formatDate(p.newStart)} (+{p.days} wd)
                  </li>
                );
              })}
            </ul>
          </>
        )}
      </div>
    </div>
  );
}

function PriorityTab({
  tasks,
  members,
  startDate,
  base,
  today,
}: {
  tasks: Parameters<typeof priorityList>[0];
  members: { id: string; name: string; role: string }[];
  startDate: string;
  base: string;
  today: string;
}) {
  const schedule = dependencySchedule(tasks, startDate);
  const items = priorityList(tasks, schedule, today);
  const nameOf = (id: string | null) => {
    const m = members.find((x) => x.id === id);
    return m ? memberLabel(m) : 'Unassigned';
  };
  const levelPill = (l: string) => (l === 'Late' ? 'red' : l === 'Highest' ? 'red' : l === 'High' ? 'amber' : l === 'Medium' ? 'muted' : 'green');

  return (
    <div className="card accent-amber">
      <h3>What to fix first</h3>
      <div className="prio-guide">
        <p className="small muted" style={{ marginBottom: 6 }}>Level comes from today ({formatDate(today)}).</p>
        <ul className="small">
          <li><b>Late:</b> deadline passed. Always the top level.</li>
          <li><b>Highest:</b> overdue, or planned for today.</li>
          <li><b>High:</b> starts in 1 to 3 working days.</li>
          <li><b>Medium:</b> starts in 4 to 5 working days.</li>
          <li><b>Low:</b> starts in more than 5 working days.</li>
          <li>A task with more than 2 open struggles moves up one level.</li>
          <li><b>Score</b> = (dependents + 1) × risk ÷ duration. Risk: late 4, open struggle 3, critical path 2, otherwise 1.</li>
        </ul>
      </div>
      {items.length === 0 && <p className="empty">No open tasks.</p>}
      {items.length > 0 && (
        <table>
          <thead>
            <tr>
              <th>#</th>
              <th>Task</th>
              <th>PIC</th>
              <th>Level</th>
              <th>Why</th>
              <th className="num">Dependents</th>
              <th className="num">Risk</th>
              <th className="num">Score</th>
              <th>Suggested action</th>
            </tr>
          </thead>
          <tbody>
            {items.map((it, i) => (
              <tr key={it.task.id} className={`prio-row s-${it.task.status}`}>
                <td>{i + 1}</td>
                <td>
                  <Link href={taskLink(base, it.task.id)} scroll={false}>
                    {it.task.code} {it.task.name}
                  </Link>{' '}
                  <span className={`st-pill s-${it.task.status}`}>{STATUS_LABEL[it.task.status]}</span>{' '}
                  {it.task.issues.map((issue) => (
                    <span key={issue.id} className={`flame ${issue.solvedAt ? 'solved' : ''}`}>
                      🔥
                    </span>
                  ))}
                  <div className="small muted">
                    {it.task.environment} · {it.task.phase}
                  </div>
                </td>
                <td>{nameOf(it.task.picId)}</td>
                <td>
                  <span className={`lvl lvl-${it.level.toLowerCase()}`}>{it.level}</span>
                </td>
                <td className="small">{it.why}</td>
                <td className="num">{it.downstream}</td>
                <td className="num">{it.risk}</td>
                <td className="num">{it.score.toFixed(2)}</td>
                <td>{it.action}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </div>
  );
}
