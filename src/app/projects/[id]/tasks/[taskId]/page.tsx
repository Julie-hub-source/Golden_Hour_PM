import { notFound } from 'next/navigation';
import { loadProjectData } from '@/lib/repo';
import { ProjectNav } from '@/components/ProjectNav';
import { TaskDetail } from '@/components/TaskDetail';

export const dynamic = 'force-dynamic';

/** Full-page task detail, kept for direct links. Normal navigation opens the same content as a popup. */
export default async function TaskDetailPage({ params }: { params: Promise<{ id: string; taskId: string }> }) {
  const { id, taskId } = await params;
  const data = await loadProjectData(id);
  if (!data) notFound();
  return (
    <>
      <ProjectNav projectId={id} name={data.project.name} active="board" />
      <TaskDetail projectId={id} taskId={taskId} base={`/projects/${id}`} />
    </>
  );
}
