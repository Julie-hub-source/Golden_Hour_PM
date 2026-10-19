'use client';

import { useEffect, useRef, useState } from 'react';
import { formatDate, parseDateInput, todayIso } from '@/lib/calendar';

const WEEK = ['Mo', 'Tu', 'We', 'Th', 'Fr', 'Sa', 'Su'];
const pad = (n: number) => String(n).padStart(2, '0');
const ERROR = 'Not a valid date. Use D/M/YYYY, for example 25/11/2026.';

/**
 * Date field. Clicking the field opens a month calendar; clicking a day fills the field in the app
 * format (e.g. "Wed 25/11/2026"). The field can also be typed in D/M/YYYY. Invalid text shows an
 * inline error and blocks the form from being submitted.
 */
export function DateField({
  name,
  defaultValue,
  disabled,
  required,
}: {
  name: string;
  defaultValue?: string | null;
  disabled?: boolean;
  required?: boolean;
}) {
  const [value, setValue] = useState(defaultValue ?? '');
  const [open, setOpen] = useState(false);
  const input = useRef<HTMLInputElement>(null);
  const wrap = useRef<HTMLSpanElement>(null);

  const trimmed = value.trim();
  const iso = trimmed ? parseDateInput(trimmed) : null;
  const invalid = trimmed !== '' && iso === null;
  const [view, setView] = useState(() => (iso ?? todayIso()).slice(0, 7)); // YYYY-MM shown in the popup

  // A custom validity message stops the form from submitting while the text is invalid
  useEffect(() => {
    input.current?.setCustomValidity(invalid ? ERROR : '');
  }, [invalid]);

  // Close on a click outside or on Escape
  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      if (wrap.current && !wrap.current.contains(e.target as Node)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setOpen(false);
    };
    document.addEventListener('mousedown', onDown);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousedown', onDown);
      document.removeEventListener('keydown', onKey);
    };
  }, [open]);

  const show = () => {
    setView((iso ?? todayIso()).slice(0, 7));
    setOpen(true);
  };

  const [y, m] = view.split('-').map(Number);
  const first = new Date(Date.UTC(y, m - 1, 1));
  const lead = (first.getUTCDay() + 6) % 7; // Monday = first column
  const days = new Date(Date.UTC(y, m, 0)).getUTCDate();
  const cells: (string | null)[] = [
    ...Array.from({ length: lead }, () => null),
    ...Array.from({ length: days }, (_, i) => `${y}-${pad(m)}-${pad(i + 1)}`),
  ];
  while (cells.length % 7 !== 0) cells.push(null);

  const shiftMonth = (n: number) => {
    const d = new Date(Date.UTC(y, m - 1 + n, 1));
    setView(`${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}`);
  };
  const pick = (day: string) => {
    setValue(formatDate(day));
    setOpen(false);
  };
  const today = todayIso();
  const monthLabel = first.toLocaleDateString('en-GB', { month: 'long', year: 'numeric', timeZone: 'UTC' });

  return (
    <span className="datefield" ref={wrap}>
      <input
        ref={input}
        type="text"
        name={name}
        value={value}
        onChange={(e) => setValue(e.target.value)}
        onFocus={() => !disabled && show()}
        onClick={() => !disabled && !open && show()}
        placeholder="D/M/YYYY"
        required={required}
        disabled={disabled}
        autoComplete="off"
        aria-invalid={invalid}
        className={invalid ? 'has-error' : undefined}
      />
      {invalid && <span className="dp-err">{ERROR}</span>}
      {open && (
        <div className="dp" role="dialog" aria-label="Pick a date">
          <div className="dp-head">
            <button type="button" onClick={() => shiftMonth(-1)} aria-label="Previous month">
              ‹
            </button>
            <b>{monthLabel}</b>
            <button type="button" onClick={() => shiftMonth(1)} aria-label="Next month">
              ›
            </button>
          </div>
          <div className="dp-grid">
            {WEEK.map((w) => (
              <span key={w} className="dp-wd">
                {w}
              </span>
            ))}
            {cells.map((c, i) =>
              c === null ? (
                <span key={`e${i}`} />
              ) : (
                <button
                  type="button"
                  key={c}
                  className={`dp-day ${c === iso ? 'sel' : ''} ${c === today ? 'today' : ''}`}
                  onClick={() => pick(c)}
                >
                  {Number(c.slice(8))}
                </button>
              ),
            )}
          </div>
          <div className="dp-foot">
            <button type="button" onClick={() => pick(today)}>
              Today
            </button>
          </div>
        </div>
      )}
    </span>
  );
}
