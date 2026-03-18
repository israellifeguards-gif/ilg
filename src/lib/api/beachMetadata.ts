import { collection, getDocs } from 'firebase/firestore';
import { db } from '@/lib/firebase/config';
import { BEACHES } from '@/lib/beaches';

// ── Beach Metadata ────────────────────────────────────────────────────────────
//
// Firestore collection: beach_metadata/{beachId}
//
// Fields (all optional — static BEACHES values are the fallback):
//   name:     string     — display name override
//   lat:      number     — latitude override
//   lng:      number     — longitude override
//   avgDepth: number     — average nearshore depth in metres (used for display)
//
// Fetched once per process, held in a memory cache with a 12-hour TTL.
// On Firestore failure, returns static BEACHES data (no avgDepth).
// ─────────────────────────────────────────────────────────────────────────────

export interface BeachMetadata {
  id:        string;
  name:      string;
  lat:       number;
  lng:       number;
  avgDepth?: number;  // metres
}

// ── In-process TTL cache (single slot, 12-hour TTL) ───────────────────────────
const TTL_MS = 12 * 60 * 60 * 1000;
let cacheValue:   Record<string, BeachMetadata> | null = null;
let cacheExpires: number = 0;

// Firestore fetch — merges dynamic docs over static baseline.
async function loadFromFirestore(): Promise<Record<string, BeachMetadata>> {
  // Build baseline from static definition
  const map: Record<string, BeachMetadata> = {};
  for (const b of BEACHES) {
    map[b.id] = { id: b.id, name: b.name, lat: b.lat, lng: b.lng };
  }

  try {
    const snap = await getDocs(collection(db, 'beach_metadata'));
    snap.docs.forEach(d => {
      const id   = d.id;
      const data = d.data() as Partial<BeachMetadata>;
      if (map[id]) {
        // Overlay only fields that are explicitly set in Firestore
        if (typeof data.name     === 'string') map[id].name     = data.name;
        if (typeof data.lat      === 'number') map[id].lat      = data.lat;
        if (typeof data.lng      === 'number') map[id].lng      = data.lng;
        if (typeof data.avgDepth === 'number') map[id].avgDepth = data.avgDepth;
      }
    });
  } catch (e) {
    console.error('[beachMetadata] Firestore fetch failed, using static fallback:', e);
  }

  return map;
}

// ── Public API ────────────────────────────────────────────────────────────────

/**
 * Returns all beach metadata, keyed by beach ID.
 *
 * The result is cached in-process for 12 hours — Firestore is read at most
 * once per server process lifetime (or once per cold start on Vercel).
 * Safe to call from any API route or RSC without worrying about read costs.
 */
export async function getBeachMetadata(): Promise<Record<string, BeachMetadata>> {
  if (cacheValue && Date.now() < cacheExpires) return cacheValue;

  const data = await loadFromFirestore();
  cacheValue   = data;
  cacheExpires = Date.now() + TTL_MS;
  return data;
}

/**
 * Returns metadata for a single beach, or null if the ID is unknown.
 */
export async function getBeach(beachId: string): Promise<BeachMetadata | null> {
  const all = await getBeachMetadata();
  return all[beachId] ?? null;
}

/**
 * Force-invalidates the in-process cache.
 * Call after admin writes to beach_metadata/{beachId} if you want immediate
 * propagation within the same process (e.g., from an admin API route).
 */
export function invalidateBeachMetadataCache(): void {
  cacheValue   = null;
  cacheExpires = 0;
  console.log('[beachMetadata] cache invalidated');
}
