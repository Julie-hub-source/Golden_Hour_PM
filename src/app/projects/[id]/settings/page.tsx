import { notFound } from 'next/navigation';
import { loadProjectData } from '@/lib/repo';
import { currentAccount } from '@/lib/session';
import { can } from '@/lib/permissions';
import { formatDate } from '@/lib/calendar';
import { PRIORITIES } from '@/lib/types';
import { ProjectNav } from '@/components/ProjectNav';
import { ActionForm } from '@/components/ActionForm';
import { DateField } from '@/components/DateField';
import { AutoSelect } from '@/components/AutoSelect';
import { memberLabel } from '@/lib/types';
import {
  setProjectStart,
  setProjectPriority,
  setProjectCommits,
  setProjectDescription,
  addProjectMember,
  removeProjectMember,
} from '@/app/actions';

export const dynamic = 'force-dynamic';

export default async function SettingsPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const { actor } = await currentAccount();
  const data = await loadProjectData(id);
  if (!data) notFound();
  const { project, members, memberIds } = data;
  const scope = { projectMemberIds: new Set(memberIds) };
  const allowed = (a: Parameters<typeof can>[1]) => can(actor, a, scope).ok;

  const projectMembers = members.filter((m) => memberIds.includes(m.id));
  const nonMembers = members.filter((m) => !memberIds.includes(m.id));
  const canPm = allowed('project.members');

  return (
    <>
      <ProjectNav projectId={id} name={project.name} active="settings" />
      <div className="two-col">
        <div>
          <div className="section">
            <h2>Project dates and priority</h2>
            <p className="small muted" style={{ marginBottom: 10 }}>
              Changing the start date moves every task deadline by the same number of calendar days. Client commit dates keep their dates.
            </p>
            <ActionForm action={setProjectStart} submitLabel="Save start date" hidden={{ projectId: id }}>
              <fieldset disabled={!allowed('project.setStart')} style={{ border: 0, padding: 0, margin: 0 }}>
                <label className="field">
                  Start date (D/M/YYYY)
                  <DateField name="startDate" defaultValue={formatDate(project.startDate)} />
                </label>
              </fieldset>
            </ActionForm>
            <div className="row" style={{ marginTop: 10 }}>
              <span className="small muted">Priority</span>
              <AutoSelect
                action={setProjectPriority}
                name="priority"
                value={project.priority}
                options={PRIORITIES.map((p) => ({ value: p, label: p }))}
                hidden={{ projectId: id }}
                disabled={!allowed('project.setPriority')}
                label="Project priority"
              />
            </div>
          </div>

          <div className="section">
            <h2>Client commitments</h2>
            <ActionForm action={setProjectCommits} submitLabel="Save commits" hidden={{ projectId: id }}>
              <fieldset disabled={!allowed('project.setCommit')} style={{ border: 0, padding: 0, margin: 0 }}>
                <div className="two-col">
                  <label className="field">
                    UAT commit
                    <DateField name="commitUat" defaultValue={formatDate(project.commitUat)} />
                  </label>
                  <label className="field">
                    STG commit
                    <DateField name="commitStg" defaultValue={formatDate(project.commitStg)} />
                  </label>
                </div>
                <label className="field">
                  Prod commit
                  <DateField name="commitProd" defaultValue={formatDate(project.commitProd)} />
                </label>
              </fieldset>
            </ActionForm>
          </div>

          <div className="section">
            <h2>Description</h2>
            <ActionForm action={setProjectDescription} submitLabel="Save description" hidden={{ projectId: id }}>
              <fieldset disabled={!allowed('project.setDescription')} style={{ border: 0, padding: 0, margin: 0 }}>
                <label className="field">
                  Context
                  <textarea name="context" defaultValue={project.context} />
                </label>
                <label className="field">
                  Client info
                  <textarea name="clientInfo" defaultValue={project.clientInfo} />
                </label>
                <label className="field">
                  Related documents (one per line: Name | https://link)
                  <textarea name="documents" defaultValue={project.documents} />
                </label>
              </fieldset>
            </ActionForm>
          </div>
        </div>

        <div>
          <div className="section">
            <h2>Members ({projectMembers.length})</h2>
            <table>
              <thead>
                <tr>
                  <th>Name</th>
                  <th>Role</th>
                  <th />
                </tr>
              </thead>
              <tbody>
                {projectMembers.map((m) => (
                  <tr key={m.id}>
                    <td>{m.name}</td>
                    <td>{m.role}</td>
                    <td>
                      {canPm && (
                        <ActionForm action={removeProjectMember} submitLabel="Remove" danger confirm={`Remove ${m.name} from this project? Their open tasks become unassigned.`} hidden={{ projectId: id, memberId: m.id }}>
                          {null}
                        </ActionForm>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
            {canPm && nonMembers.length > 0 && (
              <div style={{ marginTop: 14 }}>
                <ActionForm action={addProjectMember} submitLabel="Add member" hidden={{ projectId: id }}>
                  <label className="field">
                    Add an existing member
                    <select name="memberId" defaultValue={nonMembers[0].id}>
                      {nonMembers.map((m) => (
                        <option key={m.id} value={m.id}>
                          {memberLabel(m)}
                        </option>
                      ))}
                    </select>
                  </label>
                </ActionForm>
              </div>
            )}
            {!canPm && <p className="small muted">Only PM can add or remove members.</p>}
          </div>
        </div>
      </div>
    </>
  );
}
