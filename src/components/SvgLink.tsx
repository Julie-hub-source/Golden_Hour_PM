'use client';

import { useRouter } from 'next/navigation';
import type { ReactNode } from 'react';

/** Link around SVG shapes. It navigates in-app (no full reload), like the Gantt segments. */
export function SvgLink({ href, children }: { href: string; children: ReactNode }) {
  const router = useRouter();
  return (
    <a
      href={href}
      onClick={(e) => {
        if (e.metaKey || e.ctrlKey || e.shiftKey || e.button !== 0) return;
        e.preventDefault();
        router.push(href, { scroll: false });
      }}
    >
      {children}
    </a>
  );
}
