import Link from 'next/link';
import type { Project } from '@/lib/types';

/** Collapsible project description: context, client info and related documents. Shown on the dashboard. */
export function ProjectDescription({ projectId, project }: { projectId: string; project: Project }) {
  const documents = project.documents.split('\n').map((l) => l.trim()).filter(Boolean);
  return (
    <details className="section">
      <summary>Project description</summary>
      <div className="two-col">
        <div>
          <h3 className="small muted" style={{ marginBottom: 4 }}>Context</h3>
          <p style={{ whiteSpace: 'pre-wrap' }}>{project.context || <span className="muted">Not set.</span>}</p>
        </div>
        <div>
          <h3 className="small muted" style={{ marginBottom: 4 }}>Client info</h3>
          <p style={{ whiteSpace: 'pre-wrap' }}>{project.clientInfo || <span className="muted">Not set.</span>}</p>
          <h3 className="small muted" style={{ marginBottom: 4 }}>Related documents</h3>
          {documents.length === 0 && <p className="muted">None.</p>}
          <ul style={{ margin: 0, paddingLeft: 18 }}>
            {documents.map((line) => {
              const idx = line.lastIndexOf('|');
              const label = idx > -1 ? line.slice(0, idx).trim() : line;
              const url = idx > -1 ? line.slice(idx + 1).trim() : line;
              return (
                <li key={line}>
                  <a href={url} target="_blank" rel="noreferrer">
                    {label}
                  </a>
                </li>
              );
            })}
          </ul>
        </div>
      </div>
      <p className="small" style={{ marginTop: 10 }}>
        <Link href={`/projects/${projectId}/settings`}>Edit description, dates and team</Link>
      </p>
    </details>
  );
}
