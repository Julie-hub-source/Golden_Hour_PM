'use client';

import Link from 'next/link';
import { useState, type CSSProperties, type ReactNode } from 'react';

/**
 * One task segment in the timeline. The hover card is drawn with position: fixed,
 * so it is never clipped by the scroll container and the timeline needs no extra bottom padding.
 */
export function SegLink({
  href,
  className,
  style,
  label,
  tip,
}: {
  href: string;
  className: string;
  style: CSSProperties;
  label: ReactNode;
  tip: ReactNode;
}) {
  const [pos, setPos] = useState<{ x: number; y: number } | null>(null);
  return (
    <>
      <Link
        href={href}
        scroll={false}
        className={className}
        style={style}
        onMouseEnter={(e) => {
          const r = e.currentTarget.getBoundingClientRect();
          setPos({ x: r.left, y: r.bottom + 6 });
        }}
        onMouseLeave={() => setPos(null)}
      >
        {label}
      </Link>
      {pos && (
        <div className="tip-fixed" style={{ left: Math.max(8, Math.min(pos.x, window.innerWidth - 276)), top: pos.y }}>
          {tip}
        </div>
      )}
    </>
  );
}
