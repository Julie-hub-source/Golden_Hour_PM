import Link from 'next/link';
import { loadPortfolio } from '@/lib/repo';
import { currentAccount } from '@/lib/session';
import { runDueAlerts } from '@/lib/notify';
import { can } from '@/lib/permissions';
import { completeDate, isClosed } from '@/lib/schedule';
import { formatDate } from '@/lib/calendar';
import { PRIORITIES } from '@/lib/types';
import { AutoSelect } from '@/components/AutoSelect';
import { setProjectPriority } from './actions';

export const dynamic = 'force-dynamic';

export default async function ProjectsPage() {
  const { actor } = await currentAccount();
  await runDueAlerts(); // alerts are sent on app load as well as daily (12.1)
  const pf = await loadPortfolio();

  return (
    <>
      <div className="spread">
        <div>
          <h1>Projects</h1>
          <p className="muted">Where each project is heading, and which tasks need attention.</p>
        </div>
        {can(actor, 'project.create').ok && (
          <Link href="/projects/new" className="pill-btn">
            + New project
          </Link>
        )}
      </div>

      {pf.projects.length === 0 && <p className="empty">No projects yet.</p>}

      <div className="grid-cards">
        {pf.projects.map((p) => {
          const tasks = pf.tasksByProject.get(p.id) ?? [];
          const closed = tasks.filter(isClosed).length;
          const complete = completeDate(tasks, p.startDate);
          const isMember = actor ? p.memberIds.includes(actor.id) : false;
          const canPriority = can(actor, 'project.setPriority', { projectMemberIds: new Set(p.memberIds) }).ok;

          return (
            <article key={p.id} className="card">
              <div className="spread" style={{ marginBottom: 8 }}>
                <Link href={`/projects/${p.id}`} className="card-link">
                  <h3 style={{ fontSize: 15 }}>{p.name}</h3>
                </Link>
                {isMember ? <span className="pill">Member</span> : <span className="pill muted">Not a member</span>}
              </div>

              <div className="row" style={{ marginBottom: 10 }}>
                <AutoSelect
                  action={setProjectPriority}
                  name="priority"
                  value={p.priority}
                  options={PRIORITIES.map((x) => ({ value: x, label: `Priority: ${x}` }))}
                  hidden={{ projectId: p.id }}
                  disabled={!canPriority}
                  label={`Priority of ${p.name}`}
                />
              </div>

              <dl className="facts small">
                <dt>Start</dt>
                <dd>{formatDate(p.startDate)}</dd>
                <dt>Complete date</dt>
                <dd>{formatDate(complete)}</dd>
                <dt>Client commit (Prod)</dt>
                <dd>{formatDate(p.commitProd)}</dd>
                <dt>Members</dt>
                <dd>{p.memberIds.length}</dd>
                <dt>Tasks</dt>
                <dd>
                  {closed} / {tasks.length} closed
                </dd>
              </dl>
              <div style={{ marginTop: 10 }}>
                <div style={{ height: 6, background: 'var(--border)', borderRadius: 3, overflow: 'hidden' }}>
                  <div
                    style={{
                      width: `${tasks.length ? (closed / tasks.length) * 100 : 0}%`,
                      height: '100%',
                      background: 'var(--green)',
                    }}
                  />
                </div>
              </div>
            </article>
          );
        })}
      </div>
    </>
  );
}
