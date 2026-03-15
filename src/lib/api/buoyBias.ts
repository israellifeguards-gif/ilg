import { doc, getDoc, setDoc } from 'firebase/firestore';
import { db } from '@/lib/firebase/config';

// ── Sector-Based Buoy Bias Store ─────────────────────────────────────────────
// Each of the 8 compass sectors has its own independent EMA bias.
// This prevents offshore-wind errors from polluting onshore-wind corrections.
//
// Sector index = floor(((windDir + 22.5) % 360) / 45)
// 0=N  1=NE  2=E(Offshore)  3=SE  4=S  5=SW  6=W  7=NW
//
// EMA: newBias = oldBias × (1 - α) + currentError × α
// α = 0.15 — learns slowly, resistant to single anomalous readings
//
// Firestore: system/buoy_bias_v2
// { sectors: number[8], updatedAt: string, readingCounts: number[8] }

const ALPHA = 0.15;
const CLAMP = 0.8; // max ±0.8m correction
const MIN_UPDATE_INTERVAL_MS = 3_600_000; // max 1 write/hr

interface BiaDoc {
  sectors: number[];        // 8 EMA values, one per compass sector
  readingCounts: number[];  // how many readings per sector
  updatedAt: string;
}

const EMPTY_DOC: BiaDoc = {
  sectors: [0, 0, 0, 0, 0, 0, 0, 0],
  readingCounts: [0, 0, 0, 0, 0, 0, 0, 0],
  updatedAt: new Date(0).toISOString(),
};

function sectorIndex(windDir: number): number {
  return Math.floor(((windDir + 22.5) % 360) / 45);
}

// Returns the bias for the given wind direction (0 if no data yet)
export async function getRollingBias(windDir = 180): Promise<number> {
  try {
    const snap = await getDoc(doc(db, 'system', 'buoy_bias_v2'));
    if (!snap.exists()) return 0;
    const data = snap.data() as BiaDoc;
    return data.sectors[sectorIndex(windDir)] ?? 0;
  } catch {
    return 0;
  }
}

// Update the EMA for the sector matching current wind direction.
// Rate-limited: skips write if last update was less than 1 hour ago.
export async function updateRollingBias(
  buoyHs: number,
  modelHs: number,
  windDir: number,
): Promise<void> {
  try {
    const ref = doc(db, 'system', 'buoy_bias_v2');
    const snap = await getDoc(ref);

    const now = new Date().toISOString();
    const error = buoyHs - modelHs;
    const idx = sectorIndex(windDir);

    if (!snap.exists()) {
      const d: BiaDoc = { ...EMPTY_DOC, updatedAt: now };
      d.sectors[idx] = +error.toFixed(3);
      d.readingCounts[idx] = 1;
      await setDoc(ref, d);
      return;
    }

    const data = snap.data() as BiaDoc;

    // Rate limit
    if (Date.now() - new Date(data.updatedAt).getTime() < MIN_UPDATE_INTERVAL_MS) return;

    const sectors = [...data.sectors];
    const counts  = [...data.readingCounts];

    // EMA update for this sector only
    const newBias = sectors[idx] * (1 - ALPHA) + error * ALPHA;
    sectors[idx] = +Math.max(-CLAMP, Math.min(CLAMP, newBias)).toFixed(3);
    counts[idx] = (counts[idx] ?? 0) + 1;

    await setDoc(ref, { sectors, readingCounts: counts, updatedAt: now } satisfies BiaDoc);
  } catch {
    // Non-critical
  }
}
