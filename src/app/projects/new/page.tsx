import { loadMembers } from '@/lib/repo';
import { currentAccount } from '@/lib/session';
import { can } from '@/lib/permissions';
import { formatDate, todayIso } from '@/lib/calendar';
import { ActionForm } from '@/components/ActionForm';
import { createProject } from '@/app/actions';

export const dynamic = 'force-dynamic';

export default async function NewProjectPage() {
  const { actor } = await currentAccount();
  if (!can(actor, 'project.create').ok) {
    return <p className="empty">Only PM can create projects.</p>;
  }
  const members = await loadMembers();
  const today = formatDate(todayIso());

  return (
    <div style={{ maxWidth: 640 }}>
      <h1>New project</h1>
      <p className="muted" style={{ marginBottom: 16 }}>
        The default 13-step flow is created with it. Dates use dd/mm/yy.
      </p>
      <div className="section">
        <ActionForm action={createProject} submitLabel="Create project">
          <label className="field">
            Project name
            <input type="text" name="name" required placeholder="e.g. Customer portal" />
          </label>
          <div className="two-col">
            <label className="field">
              Start date
              <input type="text" name="startDate" defaultValue={today} placeholder="dd/mm/yy" required />
            </label>
            <label className="field">
              Prod commit date (client)
              <input type="text" name="commitProd" placeholder="dd/mm/yy" required />
            </label>
          </div>
          <fieldset style={{ border: '1px solid var(--border)', borderRadius: 6, padding: 12, margin: '0 0 10px' }}>
            <legend className="small muted">Members</legend>
            {members.map((m) => (
              <label key={m.id} className="check">
                <input type="checkbox" name="members" value={m.id} defaultChecked={m.id === actor?.id} />
                {m.name} <span className="muted small">({m.role})</span>
              </label>
            ))}
          </fieldset>
        </ActionForm>
      </div>
    </div>
  );
}
