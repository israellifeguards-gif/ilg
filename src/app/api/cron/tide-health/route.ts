import { NextResponse } from 'next/server';
import { doc, getDoc, setDoc } from 'firebase/firestore';
import { db } from '@/lib/firebase/config';

// Vercel Cron calls this daily at 06:00 Israel time.
// It validates the WorldTides API key and records the result in Firestore
// at system/tide_health { lastSuccess, lastFailure, consecutiveFailures }.
// Error logs surface automatically in Vercel's error dashboard.

export async function GET(req: Request) {
  // Protect against unauthorized calls in production
  const authHeader = req.headers.get('authorization');
  if (process.env.NODE_ENV === 'production' && authHeader !== `Bearer ${process.env.CRON_SECRET}`) {
    return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
  }

  const key = process.env.WORLDTIDES_API_KEY;
  if (!key) {
    console.error('[tide-health] WORLDTIDES_API_KEY missing — tides running on harmonic fallback');
    return NextResponse.json({ ok: false, reason: 'no_key' });
  }

  const lat = 32.08, lng = 34.77;
  const dateStr = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Jerusalem' }).format(new Date());

  try {
    const res = await fetch(
      `https://www.worldtides.info/api/v3?extremes&lat=${lat}&lon=${lng}&key=${key}&date=${dateStr}&days=1`,
      { cache: 'no-store' }
    );

    const ref = doc(db, 'system', 'tide_health');
    const snap = await getDoc(ref);
    const prev = snap.exists() ? snap.data() : { consecutiveFailures: 0 };

    if (res.status === 401) {
      const failures = (prev.consecutiveFailures ?? 0) + 1;
      await setDoc(ref, { lastFailure: new Date().toISOString(), consecutiveFailures: failures }, { merge: true });
      console.error(`[tide-health] 401 invalid key — ${failures} consecutive daily failures`);
      return NextResponse.json({ ok: false, reason: '401', consecutiveFailures: failures });
    }

    if (res.status === 429) {
      // 429 = quota hit but key is valid — not a real failure
      console.warn('[tide-health] 429 quota reached — key is valid, cache will recover');
      return NextResponse.json({ ok: true, reason: '429_quota_valid' });
    }

    if (!res.ok) {
      const failures = (prev.consecutiveFailures ?? 0) + 1;
      await setDoc(ref, { lastFailure: new Date().toISOString(), consecutiveFailures: failures }, { merge: true });
      console.error(`[tide-health] HTTP ${res.status} — ${failures} consecutive daily failures`);
      return NextResponse.json({ ok: false, reason: `http_${res.status}`, consecutiveFailures: failures });
    }

    const data = await res.json();
    if (data.status !== 200) {
      const failures = (prev.consecutiveFailures ?? 0) + 1;
      await setDoc(ref, { lastFailure: new Date().toISOString(), consecutiveFailures: failures }, { merge: true });
      console.error(`[tide-health] API error: ${data.error} — ${failures} consecutive daily failures`);
      return NextResponse.json({ ok: false, reason: data.error, consecutiveFailures: failures });
    }

    // Success — reset counter
    await setDoc(ref, { lastSuccess: new Date().toISOString(), consecutiveFailures: 0 }, { merge: true });
    return NextResponse.json({ ok: true, extremes: data.extremes?.length ?? 0 });

  } catch (e) {
    console.error('[tide-health] unexpected error:', e);
    return NextResponse.json({ ok: false, reason: 'exception' }, { status: 500 });
  }
}
