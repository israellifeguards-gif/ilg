import { NextResponse } from 'next/server';
import { timingSafeEqual, createHash } from 'crypto';
import { doc, runTransaction } from 'firebase/firestore';
import { db } from '@/lib/firebase/config';

// ── Constants ─────────────────────────────────────────────────────────────────
const LAT = 32.08, LNG = 34.77;
const ALERT_THRESHOLD = 3; // consecutive failures before escalating to console.error

// ── Timing-safe secret verification ──────────────────────────────────────────
// String comparison with !== leaks secret length via timing.
// Hashing both sides first guarantees equal buffer sizes for timingSafeEqual.
function verifySecret(authHeader: string | null): boolean {
  const expected = process.env.CRON_SECRET;
  if (!expected || !authHeader) return false;
  const a = createHash('sha256').update(`Bearer ${expected}`).digest();
  const b = createHash('sha256').update(authHeader).digest();
  return timingSafeEqual(a, b);
}

// ── Firestore helpers (transactional) ────────────────────────────────────────
// runTransaction guarantees atomic read → increment → write.
// Without it, two concurrent cron invocations could both read 0 and both write 1.

async function recordFailure(reason: string, detail: string): Promise<number> {
  const ref = doc(db, 'system', 'tide_health');
  return runTransaction(db, async (tx) => {
    const snap = await tx.get(ref);
    const prev = snap.exists() ? (snap.data().consecutiveFailures ?? 0) : 0;
    const next = (prev as number) + 1;
    tx.set(ref, {
      lastFailure:       new Date().toISOString(),
      lastFailureReason: reason,
      lastFailureDetail: detail,
      consecutiveFailures: next,
    }, { merge: true });
    return next;
  });
}

async function recordSuccess(): Promise<void> {
  const ref = doc(db, 'system', 'tide_health');
  await runTransaction(db, async (tx) => {
    tx.set(ref, { lastSuccess: new Date().toISOString(), consecutiveFailures: 0 }, { merge: true });
  });
}

// ── Alert helper ─────────────────────────────────────────────────────────────
// Below threshold → warn (visible in logs but not in Vercel error alerts).
// At/above threshold → error (triggers Vercel error dashboard notification).
function logFailure(failures: number, reason: string, detail: string) {
  const msg = `[tide-health] ${reason} | ${detail} | consecutiveFailures=${failures}`;
  if (failures >= ALERT_THRESHOLD) {
    console.error(`🚨 ${msg} — WorldTides has been down for ${failures} days, tides falling back to harmonic model`);
  } else {
    console.warn(msg);
  }
}

// ── Route ─────────────────────────────────────────────────────────────────────

export async function GET(req: Request) {
  // Auth: Vercel injects CRON_SECRET automatically; skip check in development
  if (process.env.NODE_ENV === 'production' && !verifySecret(req.headers.get('authorization'))) {
    return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
  }

  const key = process.env.WORLDTIDES_API_KEY;
  if (!key) {
    console.error('[tide-health] WORLDTIDES_API_KEY not set in environment — harmonic fallback active');
    return NextResponse.json({ ok: false, reason: 'no_key' });
  }

  const dateStr = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Jerusalem' }).format(new Date());

  try {
    const res = await fetch(
      `https://www.worldtides.info/api/v3?extremes&lat=${LAT}&lon=${LNG}&key=${key}&date=${dateStr}&days=1`,
      { cache: 'no-store' }
    );

    if (res.status === 401) {
      const failures = await recordFailure('401', 'Invalid API key');
      logFailure(failures, '401 invalid key', 'Check WORLDTIDES_API_KEY in Vercel env vars');
      return NextResponse.json({ ok: false, reason: '401', consecutiveFailures: failures });
    }

    if (res.status === 429) {
      // Quota hit = key is valid; the 12h fetch cache will avoid hitting quota in production
      console.warn('[tide-health] 429 quota reached — key is valid, no action needed');
      return NextResponse.json({ ok: true, reason: '429_quota_valid' });
    }

    if (!res.ok) {
      const failures = await recordFailure(`http_${res.status}`, res.statusText);
      logFailure(failures, `HTTP ${res.status}`, res.statusText);
      return NextResponse.json({ ok: false, reason: `http_${res.status}`, consecutiveFailures: failures });
    }

    const data = await res.json();
    if (data.status !== 200) {
      const failures = await recordFailure('api_error', data.error ?? 'unknown');
      logFailure(failures, 'API error', data.error ?? 'unknown');
      return NextResponse.json({ ok: false, reason: data.error, consecutiveFailures: failures });
    }

    await recordSuccess();
    return NextResponse.json({ ok: true, extremes: data.extremes?.length ?? 0 });

  } catch (e) {
    const detail = e instanceof Error ? e.message : String(e);
    const failures = await recordFailure('exception', detail).catch(() => -1);
    logFailure(failures, 'exception', detail);
    return NextResponse.json({ ok: false, reason: 'exception' }, { status: 500 });
  }
}
