import Link from 'next/link';
import { notFound } from 'next/navigation';
import { getHealth, loadPortfolio, loadProjectData } from '@/lib/repo';
import { currentAccount } from '@/lib/session';
import { runDueAlerts } from '@/lib/notify';
import { can } from '@/lib/permissions';
import { bufferDays, dependencySchedule, isClosed, priorityList, whatIf } from '@/lib/schedule';
import { formatDate, weekdayShort } from '@/lib/calendar';
import { ProjectNav } from '@/components/ProjectNav';
import { ActionForm } from '@/components/ActionForm';
import { Timeline } from '@/components/Timeline';
import { setProjectCommits } from '@/app/actions';

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
}

const pct = (x: number) => `${Math.round(x * 100)}%`;

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
        <div className="section" style={{ padding: 12 }}>
          <Timeline
            projectId={id}
            tasks={tasks}
            members={members}
            schedule={dependencySchedule(tasks, project.startDate)}
            commitProd={project.commitProd}
          />
        </div>
      )}

      {tab === 'whatif' && <WhatIfTab tasks={tasks} startDate={project.startDate} commitProd={project.commitProd} sp={sp} projectId={id} />}

      {tab === 'priority' && (
        <PriorityTab tasks={tasks} members={members} startDate={project.startDate} projectId={id} />
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
  const health = await getHealth(data);
  const portfolio = await loadPortfolio();
  const blockedOpen = tasks.filter((t) => t.blocked && !isClosed(t)).length;
  const maxBar = Math.max(1, ...health.histogram.map((h) => h.count));

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
        openDuration: open.reduce((n, t) => n + t.duration, 0),
      };
    })
    .filter((w) => w.projects > 0 || w.openTasks > 0);

  return (
    <>
      <div className={`banner ${health.color}`}>
        <strong>
          {health.color === 'red' ? 'Late' : health.color === 'amber' ? 'At risk' : 'On track'}.
        </strong>{' '}
        {banner}
      </div>

      <div className="kpis">
        <div className="kpi">
          <div className="muted small">Late probability</div>
          <div className="value">{pct(health.lateProbability)}</div>
          <div className="small muted">{1500} simulated runs</div>
        </div>
        <div className="kpi">
          <div className="muted small">Blocked open tasks</div>
          <div className="value">{blockedOpen}</div>
        </div>
        <div className="kpi">
          <div className="muted small">Projected Prod completion</div>
          <div className="value" style={{ fontSize: 18 }}>{formatDate(health.projectedProd) || 'Done'}</div>
          <div className="small muted">
            Buffer:{' '}
            {health.buffer === null ? '—' : health.buffer >= 0 ? `${health.buffer} wd` : `${health.buffer} wd (late)`}
          </div>
        </div>
        <div className="kpi">
          <div className="muted small">Likely range (P50 to P80)</div>
          <div className="value" style={{ fontSize: 18 }}>
            {formatDate(health.p50) || '—'} – {formatDate(health.p80) || '—'}
          </div>
        </div>
      </div>

      <div className="section">
        <h2>Environment timeline</h2>
        <ActionForm action={setProjectCommits} submitLabel="Save client commitments" hidden={{ projectId }}>
          <div style={{ overflowX: 'auto' }}>
            <table>
              <thead>
                <tr>
                  <th />
                  {envs.map((e) => (
                    <th key={e.env}>{e.env}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                <tr>
                  <td>0) Start</td>
                  {envs.map((e) => (
                    <td key={e.env}>{e.done ? 'Done' : `${weekdayShort(e.start!)} ${formatDate(e.start)}`}</td>
                  ))}
                </tr>
                <tr>
                  <td>1) Task completion (projected)</td>
                  {envs.map((e) => (
                    <td key={e.env}>{e.done ? 'Done' : formatDate(e.completion)}</td>
                  ))}
                </tr>
                <tr>
                  <td>2) Client commitment</td>
                  {envs.map((e) => {
                    if (e.env === 'Prod') {
                      return (
                        <td key={e.env}>
                          <input type="text" name="commitProd" defaultValue={formatDate(project.commitProd)} disabled={!canCommit} style={{ width: 100 }} />
                        </td>
                      );
                    }
                    return (
                      <td key={e.env}>
                        <input
                          type="text"
                          name={e.env === 'UAT' ? 'commitUat' : 'commitStg'}
                          defaultValue={formatDate(commitFor(e.env))}
                          placeholder="dd/mm/yy"
                          disabled={!canCommit}
                          style={{ width: 100 }}
                        />
                      </td>
                    );
                  })}
                </tr>
                <tr>
                  <td>Buffer / late (working days)</td>
                  {envs.map((e) => {
                    if (e.done) return <td key={e.env}>Done</td>;
                    const commit = commitFor(e.env);
                    if (!commit || !e.completion) return <td key={e.env}>—</td>;
                    const b = bufferDays(e.completion, commit);
                    return (
                      <td key={e.env} style={{ color: b >= 0 ? 'var(--green)' : 'var(--red)', fontWeight: 600 }}>
                        {b >= 0 ? `+${b}` : b}
                      </td>
                    );
                  })}
                </tr>
              </tbody>
            </table>
          </div>
          {!canCommit && <p className="small muted" style={{ marginTop: 8 }}>Only PM and PO can change client commitments.</p>}
        </ActionForm>
      </div>

      <div className="two-col">
        <div className="section">
          <h2>Simulated Prod completion</h2>
          <p className="small muted">Each bar is the number of runs (out of 1,500) that finish on that date. Red bars are after the commit.</p>
          {health.histogram.length === 0 ? (
            <p className="empty">Nothing to simulate: no open Prod tasks.</p>
          ) : (
            <div className="hist">
              {health.histogram.map((h) => (
                <div
                  key={h.date}
                  className={`hist-bar${h.date > project.commitProd ? ' late' : ''}`}
                  style={{ height: `${(h.count / maxBar) * 100}%` }}
                  data-label={`${formatDate(h.date)}: ${h.count}`}
                  title={`${formatDate(h.date)}: ${h.count} runs`}
                />
              ))}
            </div>
          )}
          <p className="small muted" style={{ marginTop: 8 }}>
            Commit {formatDate(project.commitProd)}. Late when a run finishes after it.
          </p>
        </div>

        <div className="section">
          <h2>Workload by person (all projects)</h2>
          <table>
            <thead>
              <tr>
                <th>Name</th>
                <th>Role</th>
                <th className="num">Projects</th>
                <th className="num">Open tasks</th>
                <th className="num">Open days</th>
              </tr>
            </thead>
            <tbody>
              {workload.map((w) => (
                <tr key={w.member.id}>
                  <td>{w.member.name}</td>
                  <td>{w.member.role}</td>
                  <td className="num">{w.projects}</td>
                  <td className="num">{w.openTasks}</td>
                  <td className="num">{w.openDuration}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
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
      <div className="section">
        <h2>What if a task slips?</h2>
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

      <div className="section">
        <h2>Result</h2>
        {!result && <p className="empty">No open tasks to test.</p>}
        {result && (
          <>
            <dl className="facts">
              <dt>Projected Prod completion</dt>
              <dd>{result.newProdCompletion ? formatDate(result.newProdCompletion) : 'Done'}</dd>
              <dt>Project finish moves by</dt>
              <dd>{result.shift} working day(s)</dd>
              <dt>Buffer vs Prod commit</dt>
              <dd>
                {result.buffer === null ? '—' : result.buffer >= 0 ? (
                  <span className="pill green">{result.buffer} wd spare</span>
                ) : (
                  <span className="pill red">{Math.abs(result.buffer)} wd late</span>
                )}
              </dd>
            </dl>
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
  projectId,
}: {
  tasks: Parameters<typeof priorityList>[0];
  members: { id: string; name: string }[];
  startDate: string;
  projectId: string;
}) {
  const schedule = dependencySchedule(tasks, startDate);
  const items = priorityList(tasks, schedule);
  const nameOf = (id: string | null) => (id ? members.find((m) => m.id === id)?.name ?? '—' : 'Unassigned');

  return (
    <div className="section">
      <h2>What to fix first</h2>
      <p className="small muted" style={{ marginBottom: 12 }}>
        Score = (downstream tasks + 1) × risk ÷ duration. Risk: blocked 3, critical path 2, other 1. Top 8.
      </p>
      {items.length === 0 && <p className="empty">No open tasks.</p>}
      {items.length > 0 && (
        <table>
          <thead>
            <tr>
              <th>#</th>
              <th>Task</th>
              <th>PIC</th>
              <th className="num">Blocks</th>
              <th>Risk</th>
              <th className="num">Score</th>
              <th>Suggested action</th>
            </tr>
          </thead>
          <tbody>
            {items.map((it, i) => (
              <tr key={it.task.id}>
                <td>{i + 1}</td>
                <td>
                  <Link href={`/projects/${projectId}/tasks/${it.task.id}`}>
                    {it.task.code} {it.task.name}
                  </Link>
                  <div className="small muted">{it.task.environment} · {it.task.phase}</div>
                </td>
                <td>{nameOf(it.task.picId)}</td>
                <td className="num">{it.downstream}</td>
                <td>
                  <span className={`pill ${it.risk === 3 ? 'red' : it.risk === 2 ? 'amber' : 'muted'}`}>
                    {it.risk === 3 ? 'Blocked' : it.risk === 2 ? 'Critical' : 'Normal'}
                  </span>
                </td>
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
