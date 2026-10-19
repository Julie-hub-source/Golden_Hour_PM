import Link from 'next/link';
import { loadPortfolio } from '@/lib/repo';
import { currentAccount } from '@/lib/session';
import { can } from '@/lib/permissions';
import { isClosed } from '@/lib/schedule';
import { ROLE_ORDER, ROLES } from '@/lib/types';
import { ActionForm } from '@/components/ActionForm';
import { createMember } from '@/app/actions';

export const dynamic = 'force-dynamic';

export default async function TeamPage() {
  const { actor } = await currentAccount();
  const pf = await loadPortfolio();
  const canCreate = can(actor, 'member.create').ok;

  const rows = pf.members
    .map((m) => {
      const projects = pf.projects.filter((p) => p.memberIds.includes(m.id));
      const open = projects.flatMap((p) => (pf.tasksByProject.get(p.id) ?? []).filter((t) => t.picId === m.id && !isClosed(t)));
      return { member: m, projects, open };
    })
    .sort((a, b) => ROLE_ORDER.indexOf(a.member.role) - ROLE_ORDER.indexOf(b.member.role) || a.member.name.localeCompare(b.member.name));

  return (
    <>
      <div className="spread">
        <div>
          <h1>Team</h1>
          <p className="muted">Every member is also an account. Open tasks are counted across all projects.</p>
        </div>
      </div>

      <div className="two-col" style={{ alignItems: 'start' }}>
        <div className="section" style={{ padding: 0, overflow: 'hidden' }}>
          <table>
            <thead>
              <tr>
                <th>Name</th>
                <th>Role</th>
                <th>Projects</th>
                <th className="num">Open tasks</th>
                <th className="num">Open days</th>
              </tr>
            </thead>
            <tbody>
              {rows.map(({ member, projects, open }) => (
                <tr key={member.id}>
                  <td>{member.name}</td>
                  <td>{member.role}</td>
                  <td>
                    {projects.length === 0 && <span className="muted small">None</span>}
                    {projects.map((p) => (
                      <div key={p.id} className="small">
                        <Link href={`/projects/${p.id}/dashboard`}>{p.name}</Link>
                      </div>
                    ))}
                  </td>
                  <td className="num">{open.length}</td>
                  <td className="num">{open.reduce((n, t) => n + t.duration, 0)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        <div className="section">
          <h2>Add a member</h2>
          {canCreate ? (
            <ActionForm action={createMember} submitLabel="Create member">
              <label className="field">
                Name
                <input type="text" name="name" required />
              </label>
              <label className="field">
                Role
                <select name="role" defaultValue="FE">
                  {ROLES.map((r) => (
                    <option key={r} value={r}>
                      {r}
                    </option>
                  ))}
                </select>
              </label>
            </ActionForm>
          ) : (
            <p className="small muted">Only PM can add members. Switch the acting account to a PM.</p>
          )}
        </div>
      </div>
    </>
  );
}
