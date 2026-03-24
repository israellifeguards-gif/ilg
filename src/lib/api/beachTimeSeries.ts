import { collection, deleteField, doc, getDocs, onSnapshot, setDoc, writeBatch } from 'firebase/firestore';
import { db } from '@/lib/firebase/config';
import type { BeachCalibration } from '@/lib/api/beachCalibration';

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
  overrideHs:      number | null;  // admin override — null = use calHs
  overrideT:       number | null;
  overrideWind:    number | null;  // speed in kts
  overrideWindDir: number | null;  // direction 0-360°
  syncedAt:        string;         // ISO — when model data was written
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

// ── Write (atomic batch — multiple hours / multiple dates) ───────────────────

export interface HourOverridePatch {
  beachId:  string;
  date:     string;   // YYYY-MM-DD (may be tomorrow for 00/03 slots)
  hour:     number;
  override: { overrideHs?: number | null; overrideT?: number | null; overrideWind?: number | null; overrideWindDir?: number | null };
}

export async function batchHourOverrides(patches: HourOverridePatch[]): Promise<void> {
  if (!patches.length) return;
  const batch     = writeBatch(db);
  const updatedAt = new Date().toISOString();
  for (const { beachId, date, hour, override } of patches) {
    const ref = doc(db, 'beaches', beachId, 'hourly', date, 'hours',
                    String(hour).padStart(2, '0'));
    batch.set(ref, { ...override, updatedAt }, { merge: true });
  }
  await batch.commit();
}

// ── Write (single-hour admin override) ───────────────────────────────────────

export async function setHourOverride(
  beachId:  string,
  date:     string,
  hour:     number,
  override: { overrideHs?: number | null; overrideT?: number | null; overrideWind?: number | null; overrideWindDir?: number | null },
): Promise<void> {
  const ref = doc(db, 'beaches', beachId, 'hourly', date, 'hours',
                  String(hour).padStart(2, '0'));
  await setDoc(ref, { ...override, updatedAt: new Date().toISOString() }, { merge: true });
}

// ── Real-time listener ────────────────────────────────────────────────────────

export function subscribeToHourlyTimeSeries(
  beachId:  string,
  date:     string,
  callback: (entries: Record<string, HourlyEntry>) => void,
): () => void {
  const colRef = collection(db, 'beaches', beachId, 'hourly', date, 'hours');
  return onSnapshot(
    colRef,
    snap => {
      const result: Record<string, HourlyEntry> = {};
      snap.forEach(d => { result[d.id] = d.data() as HourlyEntry; });
      callback(result);
    },
    err => {
      // Log but do NOT wipe overrides — a transient error should not blank the UI
      console.warn(`[ILG] onSnapshot error for ${beachId}/${date}:`, err.message);
    },
  );
}

// ── Master Proxy Propagation ──────────────────────────────────────────────────
//
// When saving an override for the master beach (TLV), the same relative bias
// is applied proportionally to all other Mediterranean beaches using the
// per-beach coefficients below.
//
// Eilat (Red Sea) is intentionally excluded — uncorrelated swell basin.
// ─────────────────────────────────────────────────────────────────────────────

export const MASTER_BEACH_ID = 'tlv';

export interface BeachProxyConfig {
  hsMultiplier:   number;  // Hs multiplier relative to TLV (geographic wave profile)
  windMultiplier: number;  // Wind speed multiplier relative to TLV (geographic wind profile)
  windDirOffset:  number;  // degrees added to master's overrideWindDir
  swellDirOffset: number;  // reserved for future swell-arrow offset
}

export const BEACH_PROXY_CONFIG: Record<string, BeachProxyConfig> = {
  // Northern beaches — sheltered by Carmel ridge, smaller swell and lighter winds
  nahariya: { hsMultiplier: 0.80, windMultiplier: 0.95, windDirOffset: 10, swellDirOffset: 10 },
  acre:     { hsMultiplier: 0.85, windMultiplier: 0.90, windDirOffset:  5, swellDirOffset:  5 },
  haifa:    { hsMultiplier: 0.85, windMultiplier: 0.90, windDirOffset: 10, swellDirOffset: 10 },
  // Central — similar exposure to TLV
  netanya:  { hsMultiplier: 0.95, windMultiplier: 1.00, windDirOffset:  0, swellDirOffset:  0 },
  herzliya: { hsMultiplier: 1.00, windMultiplier: 1.00, windDirOffset:  0, swellDirOffset:  0 },
  tlv:      { hsMultiplier: 1.00, windMultiplier: 1.00, windDirOffset:  0, swellDirOffset:  0 },
  // Southern — more open fetch, slightly larger swell and wind
  ashdod:   { hsMultiplier: 1.05, windMultiplier: 1.00, windDirOffset:  0, swellDirOffset:  0 },
  ashkelon: { hsMultiplier: 1.10, windMultiplier: 1.05, windDirOffset:  0, swellDirOffset:  0 },
  // eilat intentionally omitted — Red Sea, different swell system
};

/**
 * Propagates a TLV admin override to all other Mediterranean beaches
 * for the specific hour that was just saved.
 *
 * Smart scaling rule (multiplicative + per-beach profile):
 *   overrideHs   = targetRawHs   × tlvHsRatio   × cfg.hsMultiplier
 *   overrideT    = targetRawT    × tlvTRatio     (period is coastline-uniform)
 *   overrideWind = targetRawWind × tlvWindRatio  × cfg.windMultiplier
 *   overrideWindDir = wDirOverride + cfg.windDirOffset
 *
 * Example: TLV raw=1.0m → override=1.2m (ratio=1.20, +20%).
 *   Ashkelon (hsMultiplier=1.10, raw=0.8m): 0.8 × 1.20 × 1.10 = 1.056m
 *   Nahariya (hsMultiplier=0.80, raw=0.6m): 0.6 × 1.20 × 0.80 = 0.576m
 *
 * Only the single hour saved in TLV is written; other hours are untouched.
 * Eilat is excluded (Red Sea — different swell system).
 */
export async function propagateMasterOverride(
  hour:         number,
  hsRatio:      number | null,  // tlvOverride / tlvRaw
  tRatio:       number | null,
  wRatio:       number | null,
  wDirOverride: number | null,
  today:        string,
  tomorrow:     string,
  calMap:       Record<string, BeachCalibration> = {},
): Promise<{ beach: string; ops: number }[]> {
  const targetBeaches = Object.keys(BEACH_PROXY_CONFIG).filter(b => b !== MASTER_BEACH_ID);
  const isNight = ([0, 3] as number[]).includes(hour);
  const dateStr = isNight ? tomorrow : today;
  const key     = String(hour).padStart(2, '0');

  console.log(`[ILG] Propagating TLV override to ${targetBeaches.length} beaches for hour ${key}...`);
  console.log(`[ILG]   ratios: hs=${hsRatio?.toFixed(3) ?? 'n/a'} t=${tRatio?.toFixed(3) ?? 'n/a'} wind=${wRatio?.toFixed(3) ?? 'n/a'} wDir=${wDirOverride ?? 'n/a'} date=${dateStr}`);

  const batch     = writeBatch(db);
  const updatedAt = new Date().toISOString();
  const report: { beach: string; ops: number }[] = [];

  try {
    await Promise.all(
      targetBeaches.map(async (beachId) => {
        const hardcoded = BEACH_PROXY_CONFIG[beachId];
        const stored    = calMap[beachId];
        // Firestore proxy DNA takes priority over hardcoded config
        const cfg = {
          hsMultiplier:   stored?.proxy_hs_multiplier   ?? hardcoded?.hsMultiplier   ?? 1.0,
          windMultiplier: stored?.proxy_wind_multiplier ?? hardcoded?.windMultiplier ?? 1.0,
          windDirOffset:  stored?.proxy_wind_dir_offset ?? hardcoded?.windDirOffset  ?? 0,
        };
        const isCustomDNA = stored?.proxy_hs_multiplier != null;
        const snap = await getDocs(collection(db, 'beaches', beachId, 'hourly', dateStr, 'hours'));
        const docsMap: Record<string, Partial<HourlyEntry>> = {};
        snap.forEach(d => { docsMap[d.id] = d.data() as Partial<HourlyEntry>; });

        const e = docsMap[key];

        // Apply TLV ratio × per-beach geographic multiplier to each field
        // Safety clamp: wave height 0.0–5.0m, wind 0–60 kts
        const rawResult_hs = (e?.rawHs != null && e.rawHs > 0 && hsRatio != null)
          ? e.rawHs * hsRatio * cfg.hsMultiplier : null;
        const overrideHs = rawResult_hs != null
          ? +Math.min(5.0, Math.max(0.0, rawResult_hs)).toFixed(2)
          : null;

        const overrideT = (e?.rawT != null && e.rawT > 0 && tRatio != null)
          ? +(Math.max(0.5, e.rawT * tRatio)).toFixed(1)
          : null;

        const rawResult_wind = (e?.rawWind != null && e.rawWind > 0 && wRatio != null)
          ? e.rawWind * wRatio * cfg.windMultiplier : null;
        const overrideWind = rawResult_wind != null
          ? +Math.min(60, Math.max(0, rawResult_wind)).toFixed(1)
          : null;
        const overrideWindDir = wDirOverride != null
          ? Math.round(((wDirOverride + cfg.windDirOffset) % 360 + 360) % 360)
          : null;

        console.log(
          `[ILG] TLV Ratio: ${hsRatio?.toFixed(2) ?? '?'}x | Applying to ${beachId}` +
          ` (Base: ${e?.rawHs?.toFixed(2) ?? '?'}m, Multiplier: ${cfg.hsMultiplier}x${isCustomDNA ? ' ✦custom' : ''})` +
          ` -> Result: ${overrideHs ?? 'null'}m` +
          (overrideWind != null ? ` | Wind: ${e?.rawWind?.toFixed(1) ?? '?'}kts × ${wRatio?.toFixed(2) ?? '?'} × ${cfg.windMultiplier} -> ${overrideWind}kts` : ''),
        );

        const ref = doc(db, 'beaches', beachId, 'hourly', dateStr, 'hours', key);
        batch.set(ref, { overrideHs, overrideT, overrideWind, overrideWindDir, updatedAt }, { merge: true });
        report.push({ beach: beachId, ops: 1 });
      }),
    );

    await batch.commit();
    console.log(`[ILG] Propagation Finished: ${report.length} beaches written for hour ${key}`);
    return report;
  } catch (err) {
    console.error('[ILG] propagateMasterOverride ERROR:', err);
    throw err;
  }
}

// ── Cleanup (delete null wind override fields) ────────────────────────────────
// Firestore merge:true writes null explicitly; use deleteField() to truly remove.
// Returns the number of hour documents that were patched.

export async function deleteNullWindOverrides(
  beachId: string,
  dates:   string[],
): Promise<number> {
  const batch = writeBatch(db);
  let count = 0;
  for (const date of dates) {
    const snap = await getDocs(collection(db, 'beaches', beachId, 'hourly', date, 'hours'));
    snap.forEach(d => {
      const data = d.data();
      const patch: Record<string, unknown> = {};
      if (data.overrideWind    === null || data.overrideWind    === 0) patch.overrideWind    = deleteField();
      if (data.overrideWindDir === null || data.overrideWindDir === 0) patch.overrideWindDir = deleteField();
      if (Object.keys(patch).length > 0) { batch.update(d.ref, patch); count++; }
    });
  }
  await batch.commit();
  return count;
}

// ── Write (bulk — same override for every hour in list) ──────────────────────

export async function applyOverrideToDay(
  beachId:  string,
  date:     string,
  hours:    number[],
  override: { overrideHs?: number | null; overrideT?: number | null; overrideWind?: number | null; overrideWindDir?: number | null },
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
