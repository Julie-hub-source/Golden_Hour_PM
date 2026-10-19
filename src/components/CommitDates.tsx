'use client';

import { useEffect, useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { DateField } from './DateField';
import { setProjectCommits } from '@/app/actions';
import { formatDate, parseDateInput } from '@/lib/calendar';

type Commits = { commitUat: string | null; commitStg: string | null; commitProd: string };

/**
 * The client commitment cells of the environment timeline. Each valid change saves straight away,
 * together with the other commitment dates, so there is no Save button.
 */
export function CommitDates({
  projectId,
  envs,
  commits,
  canEdit,
}: {
  projectId: string;
  envs: string[];
  commits: Commits;
  canEdit: boolean;
}) {
  const router = useRouter();
  const [saved, setSaved] = useState<Commits>(commits);
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();

  // After a save the page refreshes; take the server values again
  useEffect(() => {
    setSaved(commits);
  }, [commits.commitUat, commits.commitStg, commits.commitProd]); // eslint-disable-line react-hooks/exhaustive-deps

  const keyOf = (env: string): keyof Commits => (env === 'UAT' ? 'commitUat' : env === 'STG' ? 'commitStg' : 'commitProd');

  const save = (key: keyof Commits, text: string) => {
    const iso = parseDateInput(text);
    if (!iso) return;
    const next = { ...saved, [key]: iso };
    setSaved(next);
    setError(null);
    const fd = new FormData();
    fd.set('projectId', projectId);
    fd.set('commitUat', next.commitUat ? formatDate(next.commitUat) : '');
    fd.set('commitStg', next.commitStg ? formatDate(next.commitStg) : '');
    fd.set('commitProd', next.commitProd ? formatDate(next.commitProd) : '');
    start(async () => {
      const result = await setProjectCommits(fd);
      if (!result.ok) setError(result.error);
      router.refresh();
    });
  };

  return (
    <>
      {envs.map((env) => {
        const key = keyOf(env);
        const value = saved[key];
        return (
          <td key={env}>
            <DateField
              name={key}
              defaultValue={value ? formatDate(value) : ''}
              disabled={!canEdit || pending}
              onCommit={(text) => save(key, text)}
            />
            {error && <div className="inline-error">{error}</div>}
          </td>
        );
      })}
    </>
  );
}
