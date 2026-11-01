'use client';

import { useEffect, useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { exitTestClock, setTestClock } from '@/app/actions';
import { formatDate, todayIso } from '@/lib/calendar';
import { DateField } from './DateField';

/** Set in this tab when the test clock is turned on. A new tab does not have it, so it starts in real time. */
const TAB_KEY = 'golden-test-clock-tab';

/**
 * Test clock controls (shown in the header). `date` is the test date, or null in real time.
 * Reloading the page, or opening the app in a new tab, turns the test clock off.
 */
export function TestClock({ date }: { date: string | null }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [picked, setPicked] = useState(date ?? todayIso());
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  useEffect(() => {
    if (!date) return;
    const nav = performance.getEntriesByType('navigation')[0] as PerformanceNavigationTiming | undefined;
    let started = false;
    try {
      started = sessionStorage.getItem(TAB_KEY) === '1';
    } catch {
      started = false;
    }
    if (nav?.type === 'reload' || !started) {
      startTransition(async () => {
        await exitTestClock();
        router.refresh();
      });
    }
  }, [date, router]);

  function turnOnOrApply() {
    setError(null);
    const fd = new FormData();
    fd.set('date', picked);
    startTransition(async () => {
      const res = await setTestClock(fd);
      if (!res.ok) {
        setError(res.error);
        return;
      }
      try {
        sessionStorage.setItem(TAB_KEY, '1');
      } catch {
        // Without session storage the clock still works; it will turn off on reload
      }
      setOpen(false);
      router.refresh();
    });
  }

  function exit() {
    startTransition(async () => {
      await exitTestClock();
      setOpen(false);
      router.refresh();
    });
  }

  return (
    <div className="test-clock">
      {date && (
        <div className="test-clock-bar">
          <strong>TEST CLOCK: {formatDate(date)}</strong>
          <span>Status changes are not saved. Reloading the page returns to real time.</span>
          <button type="button" className="tc-link" onClick={() => setOpen((o) => !o)} disabled={pending}>
            Change date
          </button>
          <button type="button" className="tc-link" onClick={exit} disabled={pending}>
            Exit test clock
          </button>
        </div>
      )}

      {!date && (
        <div className="test-clock-toggle">
          <button type="button" className="tc-link muted" onClick={() => setOpen((o) => !o)}>
            Test clock: off
          </button>
        </div>
      )}

      {open && (
        <div className="test-clock-panel">
          <span className="small">Pretend today is</span>
          <DateField name="date" defaultValue={date ?? todayIso()} onCommit={setPicked} />
          <button type="button" className="pill-btn" onClick={turnOnOrApply} disabled={pending}>
            {date ? 'Apply' : 'Turn on'}
          </button>
          {error && <span className="small" style={{ color: 'var(--red)' }}>{error}</span>}
        </div>
      )}
    </div>
  );
}
