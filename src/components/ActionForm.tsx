'use client';

import { useActionState, type ReactNode } from 'react';
import { useRouter } from 'next/navigation';
import type { ActionResult } from '@/app/actions';

interface Props {
  action: (fd: FormData) => Promise<ActionResult>;
  children: ReactNode;
  submitLabel: string;
  hidden?: Record<string, string>;
  className?: string;
  /** Ask for confirmation before submitting (used for deletes). */
  confirm?: string;
  danger?: boolean;
}

/** Form that runs a server action and shows its error inline. Redirects when the action asks for it. */
export function ActionForm({ action, children, submitLabel, hidden, className, confirm, danger }: Props) {
  const router = useRouter();
  const [state, formAction, pending] = useActionState(
    async (_prev: ActionResult | null, fd: FormData) => {
      const result = await action(fd);
      if (result.ok && result.redirect) router.push(result.redirect);
      return result;
    },
    null,
  );

  return (
    <form
      action={formAction}
      className={className}
      onSubmit={(e) => {
        if (confirm && !window.confirm(confirm)) e.preventDefault();
      }}
    >
      {hidden &&
        Object.entries(hidden).map(([k, v]) => <input key={k} type="hidden" name={k} value={v} />)}
      {children}
      <div className="form-foot">
        {state && !state.ok && <p className="error">{state.error}</p>}
        {state?.ok && !state.redirect && <p className="ok">Saved.</p>}
        <button type="submit" disabled={pending} className={danger ? 'danger' : 'primary'}>
          {pending ? 'Saving…' : submitLabel}
        </button>
      </div>
    </form>
  );
}
