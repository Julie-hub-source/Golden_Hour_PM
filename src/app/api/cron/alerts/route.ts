import { NextResponse } from 'next/server';
import { runDueAlerts } from '@/lib/notify';

export const dynamic = 'force-dynamic';

/**
 * Daily alert run (CLAUDE.md section 12.1). Vercel Cron calls it with
 * Authorization: Bearer $CRON_SECRET. Alerts are also checked on each app load.
 */
export async function GET(request: Request) {
  const secret = process.env.CRON_SECRET;
  if (secret && request.headers.get('authorization') !== `Bearer ${secret}`) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }
  try {
    const result = await runDueAlerts();
    return NextResponse.json({ ok: true, ...result });
  } catch (e) {
    console.error(e);
    return NextResponse.json({ ok: false, error: 'Alert run failed' }, { status: 500 });
  }
}
