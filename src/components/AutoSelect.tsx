'use client';

import { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import type { ActionResult } from '@/app/actions';

interface Props {
  action: (fd: FormData) => Promise<ActionResult>;
  name: string;
  value: string;
  options: { value: string; label: string }[];
  hidden?: Record<string, string>;
  disabled?: boolean;
  label: string;
}

/** Dropdown that saves on change through a server action. */
export function AutoSelect({ action, name, value, options, hidden, disabled, label }: Props) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [error, setError] = useState<string | null>(null);

  return (
    <span className="auto-select">
      <select
        aria-label={label}
        title={error ?? label}
        value={value}
        disabled={disabled || pending}
        className={error ? 'has-error' : undefined}
        onChange={(e) => {
          const fd = new FormData();
          for (const [k, v] of Object.entries(hidden ?? {})) fd.set(k, v);
          fd.set(name, e.target.value);
          setError(null);
          start(async () => {
            const result = await action(fd);
            if (!result.ok) setError(result.error);
            router.refresh();
          });
        }}
      >
        {options.map((o) => (
          <option key={o.value} value={o.value}>
            {o.label}
          </option>
        ))}
      </select>
      {error && <span className="inline-error">{error}</span>}
    </span>
  );
}
