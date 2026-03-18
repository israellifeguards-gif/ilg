import { collection, doc, getDocs, setDoc, writeBatch } from 'firebase/firestore';
import { db } from '@/lib/firebase/config';

// ── Firestore path ─────────────────────────────────────────────────────────────
//
//   beaches/{beachId}/hourly/{YYYY-MM-DD}/hours/{HH}
//
// Model data is written once per day by the sync pipeline.
// Admin overrides (overrideHs / overrideT / overrideWind) are merged on top.
// The public surf route still uses Open-Meteo + global calibration;
// this layer is admin-only for per-hour corrections.
// ─────────────────────────────────────────────────────────────────────────────

export interface HourlyEntry {
  hour:         number;           // 0–23
  rawHs:        number;           // model wave face height (m) before calibration
  rawT:         number;           // model wave period (s)
  rawWind:      number;           // model wind (kts) after direction adjustment
  rawWindDir:   number;           // wind direction (°)
  calHs:        number;           // rawHs × height_factor
  calT:         number;           // rawT  × period_factor
  calWind:      number;           // rawWind + wind_bias_knots
  energy:       number;           // kW/m from calibrated values
  overrideHs:   number | null;    // admin override — null = use calHs
  overrideT:    number | null;
  overrideWind: number | null;
  syncedAt:     string;           // ISO — when model data was written
  updatedAt:    string;           // ISO — last write (model or override)
}

// ── Read ──────────────────────────────────────────────────────────────────────

export async function fetchHourlyTimeSeries(
  beachId: string,
  date:    string,
): Promise<Record<string, HourlyEntry>> {
  try {
    const snap = await getDocs(
      collection(db, 'beaches', beachId, 'hourly', date, 'hours'),
    );
    const result: Record<string, HourlyEntry> = {};
    snap.forEach(d => { result[d.id] = d.data() as HourlyEntry; });
    return result;
  } catch {
    return {};
  }
}

// ── Write (sync pipeline — preserves existing overrides) ─────────────────────

export async function writeModelBatch(
  beachId: string,
  date:    string,
  entries: Omit<HourlyEntry, 'overrideHs' | 'overrideT' | 'overrideWind' | 'updatedAt'>[],
): Promise<void> {
  const batch     = writeBatch(db);
  const syncedAt  = new Date().toISOString();
  for (const e of entries) {
    const ref = doc(db, 'beaches', beachId, 'hourly', date, 'hours',
                    String(e.hour).padStart(2, '0'));
    // merge:true keeps any existing overrideHs/T/Wind the admin already set
    batch.set(ref, { ...e, syncedAt, updatedAt: syncedAt }, { merge: true });
  }
  await batch.commit();
}

// ── Write (single-hour admin override) ───────────────────────────────────────

export async function setHourOverride(
  beachId:  string,
  date:     string,
  hour:     number,
  override: { overrideHs?: number | null; overrideT?: number | null; overrideWind?: number | null },
): Promise<void> {
  const ref = doc(db, 'beaches', beachId, 'hourly', date, 'hours',
                  String(hour).padStart(2, '0'));
  await setDoc(ref, { ...override, updatedAt: new Date().toISOString() }, { merge: true });
}

// ── Write (bulk — same override for every hour in list) ──────────────────────

export async function applyOverrideToDay(
  beachId:  string,
  date:     string,
  hours:    number[],
  override: { overrideHs?: number | null; overrideT?: number | null; overrideWind?: number | null },
): Promise<void> {
  const batch     = writeBatch(db);
  const updatedAt = new Date().toISOString();
  for (const h of hours) {
    const ref = doc(db, 'beaches', beachId, 'hourly', date, 'hours',
                    String(h).padStart(2, '0'));
    batch.set(ref, { ...override, updatedAt }, { merge: true });
  }
  await batch.commit();
}
