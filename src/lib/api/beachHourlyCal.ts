import { doc, getDoc, setDoc } from 'firebase/firestore';
import { db } from '@/lib/firebase/config';

// ── Hourly calibration overrides ───────────────────────────────────────────────
// One Firestore document per beach+date holds ALL overridden hours.
//
//   Collection : beach_hourly_overrides
//   DocID      : {beachId}_{YYYY-MM-DD}   (e.g. "herzliya_2026-03-16")
//   Shape      : { "HH": HourlyOverride, ... }
//
// Absolute-value fields override what the admin panel displays for that hour.
// null = no override for that field (display uses global calibration × model).
// Does NOT affect the public surf-forecast route (fetchSurfForecast).
// ─────────────────────────────────────────────────────────────────────────────

export interface HourlyOverride {
  heightAbs: number | null;  // display height (m)
  periodAbs: number | null;  // display period (s)
  windAbs:   number | null;  // display wind (kts)
  updatedAt: string;
}

// Stored under key "_tides" in the same beach_hourly_overrides document.
export interface TideEventOverride {
  time: string;           // "HH:MM" in Israel local time
  type: 'High' | 'Low';
}

type HourlyOverridesDoc = Record<string, HourlyOverride>;

// ── Read ──────────────────────────────────────────────────────────────────────

export async function fetchHourlyOverrides(
  beachId: string,
  date: string,
): Promise<HourlyOverridesDoc> {
  try {
    const snap = await getDoc(doc(db, 'beach_hourly_overrides', `${beachId}_${date}`));
    if (!snap.exists()) return {};
    // Filter out meta keys (e.g. "_tides") — only return "HH" keyed entries
    const raw = snap.data() as Record<string, unknown>;
    const result: HourlyOverridesDoc = {};
    for (const [k, v] of Object.entries(raw)) {
      if (!k.startsWith('_')) result[k] = v as HourlyOverride;
    }
    return result;
  } catch {
    return {};
  }
}

export async function fetchTideEventOverrides(
  beachId: string,
  date: string,
): Promise<TideEventOverride[]> {
  try {
    const snap = await getDoc(doc(db, 'beach_hourly_overrides', `${beachId}_${date}`));
    if (!snap.exists()) return [];
    const raw = snap.data() as Record<string, unknown>;
    return (raw._tides as TideEventOverride[]) ?? [];
  } catch {
    return [];
  }
}

export async function setTideEventOverrides(
  beachId: string,
  date:    string,
  events:  TideEventOverride[],
): Promise<void> {
  const ref  = doc(db, 'beach_hourly_overrides', `${beachId}_${date}`);
  const snap = await getDoc(ref);
  const prev = snap.exists() ? snap.data() : {};
  await setDoc(ref, { ...prev, _tides: events });
}

// ── Write (single hour) ───────────────────────────────────────────────────────
// If all fields are null the entry is removed (clean reset for that hour).

export async function setHourlyOverride(
  beachId: string,
  date:    string,
  hour:    number,
  override: Omit<HourlyOverride, 'updatedAt'>,
): Promise<void> {
  const ref  = doc(db, 'beach_hourly_overrides', `${beachId}_${date}`);
  const snap = await getDoc(ref);
  const prev = snap.exists() ? (snap.data() as HourlyOverridesDoc) : {};
  const key  = String(hour).padStart(2, '0');

  if (override.heightAbs == null && override.periodAbs == null && override.windAbs == null) {
    const next = { ...prev };
    delete next[key];
    await setDoc(ref, next);
  } else {
    await setDoc(ref, {
      ...prev,
      [key]: { ...override, updatedAt: new Date().toISOString() },
    });
  }
}

// ── Write (all hours at once) ─────────────────────────────────────────────────
// Overwrites the whole document with the same override for every hour in `hours`.

export async function applyOverrideToAllHours(
  beachId:  string,
  date:     string,
  hours:    number[],
  override: Omit<HourlyOverride, 'updatedAt'>,
): Promise<void> {
  const ref       = doc(db, 'beach_hourly_overrides', `${beachId}_${date}`);
  const updatedAt = new Date().toISOString();
  const data: HourlyOverridesDoc = {};
  for (const h of hours) {
    data[String(h).padStart(2, '0')] = { ...override, updatedAt };
  }
  await setDoc(ref, data);
}
