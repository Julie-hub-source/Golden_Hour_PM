import Link from 'next/link';

export function ProjectNav({ projectId, name, active }: { projectId: string; name: string; active: 'board' | 'dashboard' | 'settings' }) {
  const tabs = [
    { key: 'dashboard', label: 'Dashboard and Estimation', href: `/projects/${projectId}/dashboard` },
    { key: 'board', label: 'Task Board', href: `/projects/${projectId}` },
    { key: 'settings', label: 'Settings', href: `/projects/${projectId}/settings` },
  ] as const;
  return (
    <>
      <p className="small muted" style={{ marginBottom: 2 }}>
        <Link href="/">Projects</Link> / {name}
      </p>
      <h1>{name}</h1>
      <nav className="tabs" style={{ marginTop: 12 }}>
        {tabs.map((t) => (
          <Link key={t.key} href={t.href} className={t.key === active ? 'active' : undefined}>
            {t.label}
          </Link>
        ))}
      </nav>
    </>
  );
}
