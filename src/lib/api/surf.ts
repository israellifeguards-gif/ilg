import { doc, getDoc, setDoc } from 'firebase/firestore';
import { db } from '@/lib/firebase/config';
import { getRollingBias, updateRollingBias } from './buoyBias';
import { fetchBeachCalibration, BeachCalibration, CAL_DEFAULTS } from './beachCalibration';

const DEFAULT_LAT = 32.08;
const DEFAULT_LNG = 34.77;

function degreesToCompass(deg: number): string {
  const dirs = ['N', 'NE', 'E', 'SE', 'S', 'SW', 'W', 'NW'];
  return dirs[Math.round(((deg % 360) + 360) / 45) % 8];
}

// ── Wind bias correction ──────────────────────────────────────────────────────
// Grid models underestimate coastal wind. Correction is direction-aware:
// - Offshore (east, 90-130°): ×1.1 — wind blows off land, sea surface is cleaner
// - All other directions: ×1.5 — onshore/cross-shore adds chop and gusts
function adjustWind(kts: number, dir = 180): number {
  if (!isFinite(kts) || kts < 0) return 0;
  const isOffshore = dir >= 90 && dir <= 130;
  return Math.round(kts * (isOffshore ? 1.1 : 1.5));
}

// ── Effective surf height (spectral decomposition) ────────────────────────────
// Uses RMS of swell + wind-sea when both are available.
// Falls back to totalHs/2 when windWaveHs is 0 (e.g. ecmwf_wam025 doesn't
// always return wind_wave_height — without it the formula would crush values).
//
// buoyFaceH (optional): real-time ISRAMAR face height (buoyHs / 2).
// When the sea exceeds 2 m Hs the spectral formula underestimates breaking-wave
// height because grid models smooth out swell peaks. In that regime we blend
// 80% buoy (measured) + 20% model (direction/period signal) — buoy is only
// available for current conditions; hourly forecasts call without it.
function calcEffectiveWaveHeight(swellHs: number, windWaveHs: number, totalHs: number, buoyFaceH?: number): number {
  // Guard: clamp non-finite inputs to safe values
  const safeSwellHs    = isFinite(swellHs)    && swellHs    >= 0 ? swellHs    : 0;
  const safeWindWaveHs = isFinite(windWaveHs)  && windWaveHs >= 0 ? windWaveHs : 0;
  const safeTotalHs    = isFinite(totalHs)    && totalHs    >= 0 ? totalHs    : 0;

  const modelFaceH = safeWindWaveHs > 0 && safeSwellHs > 0
    ? +( Math.sqrt(Math.pow(safeSwellHs * 1.2, 2) + Math.pow(safeWindWaveHs * 0.6, 2)) / 2 ).toFixed(1)
    : +(safeTotalHs / 2).toFixed(1);

  if (buoyFaceH !== undefined && isFinite(buoyFaceH) && buoyFaceH >= 0 && safeTotalHs >= 2) {
    // Rough sea: buoy measurement dominates — model keeps spectral shape signal
    return +(buoyFaceH * 0.8 + modelFaceH * 0.2).toFixed(1);
  }
  return modelFaceH;
}

// ── Wave energy (oceanographic standard) ─────────────────────────────────────
// Wave power (energy flux per metre of wave crest, deep-water approximation):
//   P = ρ · g² · Hs² · T / (64π)   [W/m]
// With ρ = 1025 kg/m³, g = 9.81 m/s²:
//   P ≈ 0.4903 × Hs² × T   [kW/m]
// Uses calibrated Hs and period so the value reflects what surfers actually see.
export function calcWaveEnergy(calHs: number, calPeriod: number): number {
  if (!isFinite(calHs) || !isFinite(calPeriod) || calHs < 0 || calPeriod <= 0) return 0;
  return +(0.4903 * calHs * calHs * calPeriod).toFixed(2); // kW/m
}

// ── Safe wrappers ─────────────────────────────────────────────────────────────
// Return null (not NaN/Infinity) on bad inputs or thrown exceptions.
// Callers use `?? fallback` so the UI always receives a valid number.
// beachId is included in every error log so Vercel logs pinpoint the beach.

export function safeCalcWaveHeight(
  swellHs: number, windWaveHs: number, totalHs: number,
  buoyFaceH: number | undefined, beachId?: string,
): number | null {
  try {
    if (!isFinite(swellHs) || !isFinite(windWaveHs) || !isFinite(totalHs)) {
      console.error(`[surf] safeCalcWaveHeight: non-finite input beach=${beachId}`, { swellHs, windWaveHs, totalHs });
      return null;
    }
    const result = calcEffectiveWaveHeight(swellHs, windWaveHs, totalHs, buoyFaceH);
    if (!isFinite(result)) {
      console.error(`[surf] safeCalcWaveHeight: result=${result} beach=${beachId}`, { swellHs, windWaveHs, totalHs });
      return null;
    }
    return result;
  } catch (e) {
    console.error(`[surf] safeCalcWaveHeight threw beach=${beachId}:`, e);
    return null;
  }
}

export function safeCalcWaveEnergy(calHs: number, calPeriod: number, beachId?: string): number | null {
  try {
    if (!isFinite(calHs) || !isFinite(calPeriod) || calHs < 0 || calPeriod <= 0) {
      console.error(`[surf] safeCalcWaveEnergy: invalid input beach=${beachId}`, { calHs, calPeriod });
      return null;
    }
    const result = calcWaveEnergy(calHs, calPeriod);
    if (!isFinite(result)) {
      console.error(`[surf] safeCalcWaveEnergy: result=${result} beach=${beachId}`);
      return null;
    }
    return result;
  } catch (e) {
    console.error(`[surf] safeCalcWaveEnergy threw beach=${beachId}:`, e);
    return null;
  }
}

// ── Coastline correction ──────────────────────────────────────────────────────
// Israel's Mediterranean coast faces ~285° (WNW).
// swell_angle_offset shifts the effective coast-facing direction per beach
// (e.g. Ashdod faces slightly south → negative offset; Haifa → positive).
function coastlineCorrection(waveDeg: number, coastOffset = 0): number {
  if (!isFinite(waveDeg)) return 0;
  const COAST_FACING = 285 + (isFinite(coastOffset) ? coastOffset : 0);
  const diff = Math.abs(((waveDeg - COAST_FACING + 180 + 360) % 360) - 180);
  if (diff >= 90) return 0;
  return Math.cos((diff * Math.PI) / 180);
}

export function calcRating(waveHeight: number, wavePeriod: number, windSpeed: number, waveDeg = 270, windDir = 180, coastOffset = 0): number {
  if (!isFinite(waveHeight) || !isFinite(wavePeriod) || !isFinite(windSpeed)) return 1;
  const correction = coastlineCorrection(waveDeg, coastOffset);
  const effectiveHeight = waveHeight * correction;
  const isOffshore = windDir >= 90 && windDir <= 130;

  let score = 0;
  if (effectiveHeight >= 0.3) score += 1;
  if (effectiveHeight >= 0.6) score += 1;
  if (effectiveHeight >= 1.0) score += 1;
  if (effectiveHeight >= 1.5) score += 1;
  if (effectiveHeight >= 2.0) score += 1;
  if (effectiveHeight >= 4.0) score -= 2;
  if (wavePeriod >= 7)   score += 1;
  if (wavePeriod >= 10)  score += 1;
  if (wavePeriod >= 13)  score += 1;
  if (windSpeed < 8)     score += 2;
  else if (windSpeed < 14) score += 1;
  if (isOffshore)        score += 1; // offshore wind = cleaner waves
  return Math.max(1, Math.min(10, score));
}

const HEBREW_DAYS = ['ראשון', 'שני', 'שלישי', 'רביעי', 'חמישי', 'שישי', 'שבת'];

export interface SurfCurrent {
  waveHeight: number;
  waveDirection: string;
  waveDeg: number;
  wavePeriod: number;
  swellHeight: number;
  swellDirection: string;
  swellDeg: number;
  swellPeriod: number;
  windSpeed: number;
  windDirection: string;
  windDeg: number;
  waterTemp: number;
  uvIndex: number;
  rating: number;
  /** Wave power in kW/m — P = 0.4903 × Hs² × T, uses calibrated values */
  waveEnergy: number;
}

export interface SurfHour {
  time: string;
  waveHeight: number;
  wavePeriod: number;
  swellHeight: number;
  swellDir: string;
  swellDeg: number;
  windSpeed: number;
  windDir: string;
  windDeg: number;
  rating: number;
  /** Wave power in kW/m */
  waveEnergy: number;
}

export interface SurfDay {
  date: string;
  label: string;
  waveMin: number;
  waveMax: number;
  period: number;
  windSpeed: number;
  windDir: string;
  windDeg: number;
  rating: number;
  hours: SurfHour[];
  tides: TidePoint[];
  tideExtremes: TideExtreme[];
}

export interface TidePoint {
  hour: number;
  height: number;
}

export interface TideExtreme {
  hour: number;
  height: number;
  type: 'High' | 'Low';
  timeStr: string;
}

export interface SurfForecastData {
  current: SurfCurrent;
  todayHours: SurfHour[];
  days: SurfDay[];
  tides: TidePoint[];
  tideExtremes: TideExtreme[];
  sources: string[];
  fetchedAt: string;
  sunrise: string;
  sunset: string;
  firstLight: string;
  lastLight: string;
  /** true = ISRAMAR buoy passed validation and was blended into wave height */
  buoyLive: boolean;
  /** Active calibration factors for this beach (for admin display + observation submission) */
  calibration: BeachCalibration;
  /**
   * 0–100 data-quality score for this forecast.
   *
   * Component breakdown:
   *   30  — baseline (Open-Meteo always available)
   *   +35 — buoyLive: ISRAMAR measured Hs blended in (vs pure model)
   *   +25 — WorldTides used for tides (vs harmonic fallback)
   *   +10 — beach actively calibrated (any factor differs from default)
   *
   * Use this to show a confidence indicator in the UI or log-based alerting.
   */
  confidenceScore: number;
}

// ── ISRAMAR Hadera Buoy ───────────────────────────────────────────────────────
// Real measured wave data from the Israeli Mediterranean coast (Hadera station).
// Updated approximately every hour. No API key required.

interface IsramarBuoy {
  waveHeight: number; // significant wave height (m)
  wavePeriod: number; // peak wave period (s)
  maxWaveHeight: number;
  datetime: string;
}

async function fetchIsramarBuoy(): Promise<IsramarBuoy | null> {
  try {
    const res = await fetch(
      'https://isramar.ocean.org.il/isramar2009/station/data/Hadera_Hs_Per.json',
      { next: { revalidate: 3600 } }
    );
    if (!res.ok) return null;
    const data = await res.json();
    const params = data.parameters as { name: string; values: number[] }[];
    const get = (name: string) => params.find(p => p.name === name)?.values?.[0] ?? 0;
    return {
      waveHeight:    +get('Significant wave height').toFixed(2),
      wavePeriod:    +get('Peak wave period').toFixed(1),
      maxWaveHeight: +get('Maximal wave height').toFixed(2),
      datetime:      data.datetime,
    };
  } catch {
    return null;
  }
}

// ── Buoy sanity check ─────────────────────────────────────────────────────────
// Rejects physically implausible readings before they reach the display layer.
// Mediterranean physical limits: Hs ≤ 10 m, T ∈ [2, 25] s, freshness ≤ 3 h.
function validateIsramarBuoy(buoy: IsramarBuoy): boolean {
  if (buoy.waveHeight < 0.05 || buoy.waveHeight > 10) {
    console.warn(`[buoy-validate] rejected: waveHeight=${buoy.waveHeight}m (range 0.05–10)`);
    return false;
  }
  if (buoy.wavePeriod < 2 || buoy.wavePeriod > 25) {
    console.warn(`[buoy-validate] rejected: wavePeriod=${buoy.wavePeriod}s (range 2–25)`);
    return false;
  }
  if (buoy.maxWaveHeight > 15) {
    console.warn(`[buoy-validate] rejected: maxWaveHeight=${buoy.maxWaveHeight}m > 15`);
    return false;
  }
  // Freshness: datetime arrives as "2026-03-15 13:00 UTC"
  try {
    const buoyTime = new Date(buoy.datetime.replace(' ', 'T').replace(' UTC', 'Z'));
    const ageH = (Date.now() - buoyTime.getTime()) / 3_600_000;
    if (ageH > 3) {
      console.warn(`[buoy-validate] rejected: data is ${ageH.toFixed(1)}h old`);
      return false;
    }
  } catch {
    console.warn('[buoy-validate] rejected: unparseable datetime', buoy.datetime);
    return false;
  }
  return true;
}

// ── Buoy EMA smoothing ────────────────────────────────────────────────────────
// Stores a rolling EMA of Hs in Firestore so a single spike reading doesn't
// cause the UI number to jump. α = 0.35 → ~3 readings (3 h) to fully reflect
// a sustained change. Rate-limited to 1 Firestore write/hour — same pattern
// as buoyBias.ts. Falls back to raw reading on any error.

const _BUOY_EMA_ALPHA        = 0.35;
const _BUOY_EMA_MAX_AGE_MS   = 6 * 3_600_000; // discard EMA if server was idle > 6 h
const _BUOY_EMA_MIN_WRITE_MS = 3_600_000;      // max 1 write/hr (matches buoy update cadence)

async function getSmoothedBuoyHeight(rawHs: number): Promise<number> {
  try {
    const ref = doc(db, 'system', 'buoy_wave_ema');
    const snap = await getDoc(ref);
    const now = Date.now();

    if (snap.exists()) {
      const { emaHeight, updatedAt } = snap.data() as { emaHeight: number; updatedAt: number };
      if (typeof emaHeight === 'number' && now - updatedAt < _BUOY_EMA_MAX_AGE_MS) {
        const newEma = _BUOY_EMA_ALPHA * rawHs + (1 - _BUOY_EMA_ALPHA) * emaHeight;
        console.log(`[buoy-ema] raw=${rawHs.toFixed(2)} prev=${emaHeight.toFixed(2)} → ema=${newEma.toFixed(2)}`);
        // Rate-limited write — non-blocking
        if (now - updatedAt >= _BUOY_EMA_MIN_WRITE_MS) {
          setDoc(ref, { emaHeight: +newEma.toFixed(3), updatedAt: now }).catch(() => null);
        }
        return newEma;
      }
    }
    // First reading or stale — seed with current value
    setDoc(ref, { emaHeight: +rawHs.toFixed(3), updatedAt: now }).catch(() => null);
    return rawHs;
  } catch {
    return rawHs; // never block the forecast on EMA failure
  }
}

// ── StormGlass ────────────────────────────────────────────────────────────────
// Aggregates ECMWF + NOAA GFS + DWD ICON + MeteoFrance per point.
// Free tier: 10 requests/day → cache 3h = max 8 req/day.

interface SGHour {
  time: string;
  waveHeight?:     Record<string, number>;
  wavePeriod?:     Record<string, number>;
  waveDirection?:  Record<string, number>;
  swellHeight?:    Record<string, number>;
  swellPeriod?:    Record<string, number>;
  swellDirection?: Record<string, number>;
  windSpeed?:      Record<string, number>;
  windDirection?:  Record<string, number>;
  waterTemperature?: Record<string, number>;
  uvIndex?:        Record<string, number>;
}

// Pick the best available model value (sg = StormGlass blend is preferred)
function sgVal(h: SGHour, param: keyof SGHour): number {
  const v = h[param] as Record<string, number> | undefined;
  if (!v) return 0;
  return v.sg ?? v.ecmwf ?? v.noaa ?? v.dwd ?? v.meteo ?? (Object.values(v)[0] as number) ?? 0;
}

// For wave/swell period: NOAA gives best results for Eastern Mediterranean
function sgPeriod(h: SGHour, param: keyof SGHour): number {
  const v = h[param] as Record<string, number> | undefined;
  if (!v) return 0;
  return v.noaa ?? v.meteo ?? v.dwd ?? v.sg ?? v.ecmwf ?? (Object.values(v)[0] as number) ?? 0;
}

async function fetchStormGlass(lat: number, lng: number): Promise<SGHour[] | null> {
  const key = process.env.STORMGLASS_API_KEY;
  if (!key) return null;
  try {
    const start = new Date();
    start.setMinutes(0, 0, 0);
    const end = new Date(start.getTime() + 48 * 3600 * 1000);
    const res = await fetch(
      `https://api.stormglass.io/v2/weather/point` +
      `?lat=${lat}&lng=${lng}` +
      `&params=waveHeight,wavePeriod,waveDirection,swellHeight,swellPeriod,swellDirection,windSpeed,windDirection,waterTemperature,uvIndex` +
      `&start=${start.toISOString()}&end=${end.toISOString()}`,
      {
        headers: { Authorization: key },
        next: { revalidate: 10800, tags: [`surf:${lat},${lng}`, 'surf:all'] }, // 3h → ≤8 req/day
      }
    );
    if (!res.ok) return null;
    const data = await res.json();
    return (data.hours as SGHour[]) ?? null;
  } catch {
    return null;
  }
}

// ── Tidal Harmonic Prediction ─────────────────────────────────────────────────
// Harmonic constituents for Tel Aviv / Hadera coast (32.08°N, 34.77°E)
// H: amplitude (m) from Frontiers 2024 mooring + TPXO model
// G: Greenwich phase lag (°) from FES2014/TPXO maps
// v0: equilibrium argument (°) at Unix epoch (Jan 1 1970 00:00 UTC)
//     computed from: s=187.3° h=281.73° p=302.62° N=345.3° T=0°
// Validated against tidetime.org: high≈01:18, low≈06:00, high≈13:31 (Mar 11 2026)

interface TidesResult {
  heights: Map<string, TidePoint[]>;
  extremes: Map<string, TideExtreme[]>;
}

// [speed °/hr, H meters, G degrees, v0 at Unix epoch degrees]
const _TC: [number, number, number, number][] = [
  [28.984104, 0.113,  72, 188.86], // M2
  [30.000000, 0.062, 110,   0.00], // S2
  [28.439730, 0.022,  50, 304.18], // N2
  [30.082137, 0.017, 115, 203.46], // K2
  [15.041069, 0.030, 220,  11.73], // K1
  [13.943035, 0.025, 200, 177.13], // O1
  [14.958931, 0.010, 220, 168.27], // P1
  [13.398661, 0.005, 180, 214.18], // Q1
];
const _D2R = Math.PI / 180;

// ── Tide offset fetch ────────────────────────────────────────────────────────
// Firebase SDK calls bypass Next.js fetch cache → always fresh, no revalidate needed.
// Validation: reject offsets outside ±6h to protect against typos in Firestore.
// Per-beach offset path: beaches/{beachId}/tide_settings { offsetHours }
// Falls back to the legacy global doc (system/tide_settings) so old calibrations still work.
async function fetchTideOffset(beachId?: string): Promise<number> {
  // No unstable_noStore() — it poisoned the Data Cache for all sibling fetch() calls
  // (StormGlass revalidate:10800, WorldTides revalidate:43200) in the same request.
  // Firestore SDK is not a Next.js fetch() call so it's always fresh natively.
  try {
    // 1. Try per-beach offset first
    if (beachId) {
      const beachSnap = await getDoc(doc(db, 'beaches', beachId, 'tide_settings', 'offset'));
      if (beachSnap.exists()) {
        const raw = (beachSnap.data() as { offsetHours?: number }).offsetHours ?? 0;
        if (typeof raw === 'number' && raw >= -6 && raw <= 6) {
          console.log(`[tide] beach=${beachId} offsetHours=${raw}`);
          return raw;
        }
      }
    }
    // 2. Fall back to global legacy offset
    const snap = await getDoc(doc(db, 'system', 'tide_settings'));
    if (!snap.exists()) return 0;
    const raw = (snap.data() as { offsetHours?: number }).offsetHours ?? 0;
    if (typeof raw !== 'number' || raw < -6 || raw > 6) return 0;
    return raw;
  } catch (e) {
    console.error('[tide] failed to fetch tide_settings:', e);
    return 0;
  }
}

// Write per-beach offset. Falls back to global if beachId omitted.
export async function setTideOffsetRaw(offsetHours: number, beachId?: string): Promise<void> {
  if (offsetHours < -6 || offsetHours > 6) throw new Error('offsetHours must be within ±6h');
  const ref = beachId
    ? doc(db, 'beaches', beachId, 'tide_settings', 'offset')
    : doc(db, 'system', 'tide_settings');
  await setDoc(ref, { offsetHours: +offsetHours.toFixed(3) });
  console.log(`[tide] ${beachId ?? 'global'} offset set to ${offsetHours}h`);
}

// Calibration utility: provide the actual extreme time and what the app predicted.
// Automatically computes the delta and saves it to Firestore.
// Usage example: setTideOffset(new Date('2026-03-14T15:20'), new Date('2026-03-14T13:59'))
export async function setTideOffset(actualTime: Date, predictedTime: Date): Promise<void> {
  const deltaHours = (actualTime.getTime() - predictedTime.getTime()) / 3_600_000;
  console.log(`[tide] calibrating: actual=${actualTime.toTimeString().slice(0,5)} predicted=${predictedTime.toTimeString().slice(0,5)} → offset=${deltaHours.toFixed(3)}h`);
  await setTideOffsetRaw(deltaHours);
}

// ── Tide phase calibration ────────────────────────────────────────────────────
// Offset stored in Firestore at system/tide_settings { offsetHours: number }
// Update it without redeployment to calibrate against ISRAMAR.
// HOW TO CALIBRATE:
//   1. Note our predicted extreme time in the app
//   2. Check ISRAMAR TidePred for the actual time
//   3. Set offsetHours = actual − predicted  (e.g. actual 15:20, predicted 13:59 → +1.37)
// Cached per-request after the Firestore read; falls back to 0 on error.
let _tideOffset = 0;

function _tideH(ms: number): number {
  const t = ms / 3_600_000 + _tideOffset;
  let h = 0;
  for (const [speed, H, G, v0] of _TC) h += H * Math.cos((speed * t + v0 - G) * _D2R);
  return h;
}

function _refineExtreme(lo: number, hi: number, isMax: boolean): number {
  for (let i = 0; i < 40; i++) {
    const m1 = lo + (hi - lo) / 3, m2 = hi - (hi - lo) / 3;
    if (isMax ? _tideH(m1) < _tideH(m2) : _tideH(m1) > _tideH(m2)) lo = m1; else hi = m2;
  }
  return (lo + hi) / 2;
}

function computeIsraelTides(): TidesResult {
  const TZ = 'Asia/Jerusalem';
  const parts = (dt: Date) => {
    const p = new Intl.DateTimeFormat('en-US', {
      timeZone: TZ, year: 'numeric', month: '2-digit', day: '2-digit',
      hour: '2-digit', minute: '2-digit', hour12: false,
    }).formatToParts(dt);
    const g = (t: string) => p.find(x => x.type === t)?.value ?? '0';
    const hh = parseInt(g('hour')) % 24, mm = parseInt(g('minute'));
    return { dateStr: `${g('year')}-${g('month')}-${g('day')}`, hour: +(hh + mm / 60).toFixed(4), hh, mm };
  };

  const start = new Date(); start.setUTCHours(0, 0, 0, 0);
  const startMs = start.getTime(), endMs = startMs + 8 * 86_400_000;
  const STEP = 5 * 60_000;

  const heights = new Map<string, TidePoint[]>();
  const extremes = new Map<string, TideExtreme[]>();

  // Height chart: sample every 15 min
  for (let ms = startMs; ms <= endMs; ms += 15 * 60_000) {
    const { dateStr, hour } = parts(new Date(ms));
    if (!heights.has(dateStr)) heights.set(dateStr, []);
    heights.get(dateStr)!.push({ hour, height: +_tideH(ms).toFixed(3) });
  }

  // Extremes: 3-point detection + ternary search refinement
  for (let ms = startMs + STEP; ms < endMs - STEP; ms += STEP) {
    const hP = _tideH(ms - STEP), hC = _tideH(ms), hN = _tideH(ms + STEP);
    const isMax = hC > hP && hC > hN, isMin = hC < hP && hC < hN;
    if (!isMax && !isMin) continue;
    const exactMs = _refineExtreme(ms - STEP, ms + STEP, isMax);
    const { dateStr, hour, hh, mm } = parts(new Date(exactMs));
    const timeStr = `${String(hh).padStart(2, '0')}:${String(mm).padStart(2, '0')}`;
    const type: 'High' | 'Low' = isMax ? 'High' : 'Low';
    // Raw time = what the model predicts WITHOUT offset (offset=0)
    const rawEpochHours = exactMs / 3_600_000;
    const rawMs = (rawEpochHours - _tideOffset) * 3_600_000;
    const rawLocal = parts(new Date(rawMs));
    const rawTimeStr = `${String(rawLocal.hh).padStart(2, '0')}:${String(rawLocal.mm).padStart(2, '0')}`;
    if (!extremes.has(dateStr)) extremes.set(dateStr, []);
    extremes.get(dateStr)!.push({ hour, height: +_tideH(exactMs).toFixed(3), type, timeStr });
  }

  return { heights, extremes };
}

// ── Debug utility ─────────────────────────────────────────────────────────────
// Prints raw API values vs final displayed values for one beach.
// Safe to call in production — read-only, no side effects.
// Usage: GET /api/admin/debug-surf?beach=tlv

export interface SurfDebugReport {
  beachId: string;
  beachOffset: number;
  usingWorldTides: boolean;
  tide: {
    rawExtremes: { type: string; rawTimeStr: string; height: number }[];
    shiftedExtremes: { type: string; shiftedTimeStr: string; height: number }[];
  };
  waves: {
    isramarRaw: { waveHeight: number; wavePeriod: number; maxWaveHeight: number; datetime: string } | null;
    isramarDisplayed: number | null; // isramarBuoy.waveHeight / 2
    openMeteoCurrentRaw: { wave_height: number; wind_wave_height: number; swell_wave_height: number } | null;
    biasOffset: number;
    biasOffsetSource: string;
    effectiveWaveHeightFormula: string;
    effectiveWaveHeightResult: number | null;
  };
  wind: {
    openMeteoRawKnots: number;
    rawDir: number;
    isOffshore: boolean;
    multiplier: number;
    displayedKnots: number;
  } | null;
  swellHeight: {
    rawFromAPI: number;
    halvedForDisplay: number;
  } | null;
}

export async function debugTideData(beachId: string): Promise<SurfDebugReport> {
  const { BEACHES } = await import('@/lib/beaches');
  const beach = BEACHES.find(b => b.id === beachId) ?? { lat: DEFAULT_LAT, lng: DEFAULT_LNG, id: beachId };
  const { lat, lng } = beach;

  // 1. Tide offset
  const beachOffset = await fetchTideOffset(beachId);

  // 2. WorldTides raw extremes
  const wtKey = process.env.WORLDTIDES_API_KEY;
  let rawWorldTidesExtremes: { type: string; rawTimeStr: string; height: number }[] = [];
  let shiftedExtremes: { type: string; shiftedTimeStr: string; height: number }[] = [];
  let usingWorldTides = false;

  if (wtKey) {
    const dateStr = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Jerusalem' }).format(new Date());
    const res = await fetch(
      `https://www.worldtides.info/api/v3?extremes&lat=${lat}&lon=${lng}&key=${wtKey}&date=${dateStr}&days=2`,
      { cache: 'no-store' }
    );
    if (res.ok) {
      const data = await res.json();
      usingWorldTides = data.status === 200;
      const TZ = 'Asia/Jerusalem';
      for (const e of data.extremes ?? []) {
        const raw = new Date(e.dt * 1000);
        const rawParts = new Intl.DateTimeFormat('en-CA', {
          timeZone: TZ, hour: '2-digit', minute: '2-digit', hour12: false,
        }).formatToParts(raw);
        const rg = (t: string) => rawParts.find(x => x.type === t)?.value ?? '0';
        const rawTimeStr = `${(parseInt(rg('hour')) % 24).toString().padStart(2, '0')}:${rg('minute')}`;

        const shiftedDt = e.dt + beachOffset * 3600;
        const shiftedParts = new Intl.DateTimeFormat('en-CA', {
          timeZone: TZ, hour: '2-digit', minute: '2-digit', hour12: false,
        }).formatToParts(new Date(shiftedDt * 1000));
        const sg = (t: string) => shiftedParts.find(x => x.type === t)?.value ?? '0';
        const shiftedTimeStr = `${(parseInt(sg('hour')) % 24).toString().padStart(2, '0')}:${sg('minute')}`;

        rawWorldTidesExtremes.push({ type: e.type, rawTimeStr, height: +e.height.toFixed(3) });
        shiftedExtremes.push({ type: e.type, shiftedTimeStr, height: +e.height.toFixed(3) });
      }
    }
  }

  // 3. ISRAMAR buoy
  const buoy = await fetchIsramarBuoy();
  const isramarDisplayed = buoy ? +(buoy.waveHeight / 2).toFixed(2) : null;

  // 4. Open-Meteo Marine current (raw)
  let openMeteoRaw: SurfDebugReport['waves']['openMeteoCurrentRaw'] = null;
  try {
    const r = await fetch(
      `https://marine-api.open-meteo.com/v1/marine` +
      `?latitude=${lat}&longitude=${lng}` +
      `&current=wave_height,wind_wave_height,swell_wave_height`,
      { cache: 'no-store' }
    );
    if (r.ok) {
      const d = await r.json();
      const c = d.current ?? {};
      openMeteoRaw = {
        wave_height: +(c.wave_height ?? 0).toFixed(3),
        wind_wave_height: +(c.wind_wave_height ?? 0).toFixed(3),
        swell_wave_height: +(c.swell_wave_height ?? 0).toFixed(3),
      };
    }
  } catch { /* ignore */ }

  // 5. Bias offset
  const now = new Date();
  const _ilParts = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Jerusalem', year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', hour12: false,
  }).formatToParts(now);
  const _ilGet = (type: string) => _ilParts.find(p => p.type === type)?.value ?? '0';
  const nowIsoDebug = `${_ilGet('year')}-${_ilGet('month')}-${_ilGet('day')}T${(parseInt(_ilGet('hour')) % 24).toString().padStart(2, '0')}`;

  let biasOffset = 0;
  let biasOffsetSource = 'Firestore rolling EMA (sector-based)';
  let currentWindDir = 180;
  try {
    const wRes = await fetch(
      `https://api.open-meteo.com/v1/forecast` +
      `?latitude=${lat}&longitude=${lng}&current=wind_direction_10m&models=ecmwf_ifs025&timezone=Asia%2FJerusalem`,
      { cache: 'no-store' }
    );
    if (wRes.ok) {
      const wd = await wRes.json();
      currentWindDir = wd.current?.wind_direction_10m ?? 180;
    }
  } catch { /* ignore */ }
  biasOffset = await getRollingBias(currentWindDir);
  if (buoy && openMeteoRaw) {
    const liveError = buoy.waveHeight - openMeteoRaw.wave_height;
    biasOffset = biasOffset * 0.7 + liveError * 0.3;
    biasOffset = Math.max(-0.8, Math.min(0.8, biasOffset));
    biasOffsetSource = 'Firestore EMA×0.7 + live ISRAMAR error×0.3 (blended)';
  }

  // 6. Effective wave height formula result
  let effectiveWaveHeightResult: number | null = null;
  const formulaStr = 'sqrt((swellH×1.2)² + (windWaveH×0.6)²) / 2  —or—  totalHs÷2 fallback';
  if (openMeteoRaw) {
    const swellH = openMeteoRaw.swell_wave_height;
    const windWaveH = openMeteoRaw.wind_wave_height;
    const totalHs = openMeteoRaw.wave_height + biasOffset;
    effectiveWaveHeightResult = calcEffectiveWaveHeight(swellH, windWaveH, totalHs);
  }

  // 7. Wind
  let windDebug: SurfDebugReport['wind'] = null;
  try {
    const wRes = await fetch(
      `https://api.open-meteo.com/v1/forecast` +
      `?latitude=${lat}&longitude=${lng}&current=wind_speed_10m,wind_direction_10m&wind_speed_unit=kn&models=ecmwf_ifs025&timezone=Asia%2FJerusalem`,
      { cache: 'no-store' }
    );
    if (wRes.ok) {
      const wd = await wRes.json();
      const rawKnots = +(wd.current?.wind_speed_10m ?? 0).toFixed(1);
      const rawDir = +(wd.current?.wind_direction_10m ?? 180);
      const isOffshore = rawDir >= 90 && rawDir <= 130;
      const multiplier = isOffshore ? 1.1 : 1.5;
      windDebug = {
        openMeteoRawKnots: rawKnots,
        rawDir,
        isOffshore,
        multiplier,
        displayedKnots: Math.round(rawKnots * multiplier),
      };
    }
  } catch { /* ignore */ }

  // 8. Swell height halving
  const swellDebug = openMeteoRaw ? {
    rawFromAPI: openMeteoRaw.swell_wave_height,
    halvedForDisplay: +(openMeteoRaw.swell_wave_height / 2).toFixed(2),
  } : null;

  const report: SurfDebugReport = {
    beachId,
    beachOffset,
    usingWorldTides,
    tide: {
      rawExtremes: rawWorldTidesExtremes.slice(0, 6),
      shiftedExtremes: shiftedExtremes.slice(0, 6),
    },
    waves: {
      isramarRaw: buoy,
      isramarDisplayed,
      openMeteoCurrentRaw: openMeteoRaw,
      biasOffset: +biasOffset.toFixed(3),
      biasOffsetSource,
      effectiveWaveHeightFormula: formulaStr,
      effectiveWaveHeightResult,
    },
    wind: windDebug,
    swellHeight: swellDebug,
  };

  // Log to server console for easy inspection
  console.log('[debugTideData] report:', JSON.stringify(report, null, 2));
  return report;
}

// ── WorldTides API ────────────────────────────────────────────────────────────
// Authoritative tide predictions for the Israeli Mediterranean coast.
// Free tier: 1 request/day per location → cache 12h is safe.
// Falls back to the local harmonic model if the key is missing or the API fails.

async function fetchWorldTides(lat: number, lng: number): Promise<TidesResult | null> {
  const key = process.env.WORLDTIDES_API_KEY;
  if (!key) { console.warn('[WorldTides] no API key — using harmonic fallback'); return null; }
  // Log key presence (never the value) so Vercel logs confirm env var is wired
  console.log(`[WorldTides] key present (${key.length} chars), requesting lat=${lat} lon=${lng}`);
  try {
    const dateStr = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Jerusalem' }).format(new Date());
    const res = await fetch(
      `https://www.worldtides.info/api/v3?extremes` +
      `&lat=${lat}&lon=${lng}&key=${key}&date=${dateStr}&days=7`,
      { next: { revalidate: 43200, tags: [`surf:${lat},${lng}`, 'surf:all'] } } // 12h cache — free tier is 1 req/day
    );
    // Always log status so we can distinguish 401 / 429 / 200 in Vercel logs
    console.log(`[WorldTides] HTTP ${res.status}`);
    if (res.status === 401) { console.error('[WorldTides] 401 — WORLDTIDES_API_KEY is set but rejected. Check the key in Vercel → Settings → Environment Variables.'); return null; }
    if (res.status === 429) { console.warn('[WorldTides] 429 quota exceeded — falling back to harmonic model'); return null; }
    if (!res.ok) { console.warn(`[WorldTides] HTTP ${res.status} — falling back to harmonic model`); return null; }
    const data = await res.json();
    if (data.status !== 200) { console.warn('[WorldTides] API error:', data.error, '— falling back'); return null; }
    console.log(`[WorldTides] OK — ${data.extremes?.length ?? 0} extremes loaded (callsRemaining=${data.callsRemaining ?? '?'})`);

    const TZ = 'Asia/Jerusalem';
    const toParts = (dt: number) => {
      const p = new Intl.DateTimeFormat('en-CA', {
        timeZone: TZ, year: 'numeric', month: '2-digit', day: '2-digit',
        hour: '2-digit', minute: '2-digit', hour12: false,
      }).formatToParts(new Date(dt * 1000));
      const g = (t: string) => p.find(x => x.type === t)?.value ?? '0';
      const hh = parseInt(g('hour')) % 24, mm = parseInt(g('minute'));
      return { dateStr: `${g('year')}-${g('month')}-${g('day')}`, hour: +(hh + mm / 60).toFixed(4), hh, mm };
    };

    const extremes = new Map<string, TideExtreme[]>();
    const allExtremes: { dt: number; height: number; type: 'High' | 'Low' }[] = [];

    for (const e of data.extremes ?? []) {
      const { dateStr, hour, hh, mm } = toParts(e.dt);
      const type: 'High' | 'Low' = e.type === 'High' ? 'High' : 'Low';
      const timeStr = `${String(hh).padStart(2, '0')}:${String(mm).padStart(2, '0')}`;
      if (!extremes.has(dateStr)) extremes.set(dateStr, []);
      extremes.get(dateStr)!.push({ hour, height: +e.height.toFixed(3), type, timeStr });
      allExtremes.push({ dt: e.dt, height: e.height, type });
    }

    // Build smooth height curve via cosine interpolation between extremes
    const heights = new Map<string, TidePoint[]>();
    for (let i = 0; i < allExtremes.length - 1; i++) {
      const a = allExtremes[i], b = allExtremes[i + 1];
      const dtA = a.dt, dtB = b.dt, span = dtB - dtA;
      for (let s = 0; s <= span; s += 3600) {
        const frac = s / span;
        const h = +(a.height + (b.height - a.height) * (1 - Math.cos(frac * Math.PI)) / 2).toFixed(3);
        const { dateStr, hour } = toParts(dtA + s);
        if (!heights.has(dateStr)) heights.set(dateStr, []);
        heights.get(dateStr)!.push({ hour, height: h });
      }
    }
    return { heights, extremes };
  } catch (e) {
    console.error('[WorldTides] unexpected error — falling back to harmonic model:', e);
    return null;
  }
}

// ── Main fetch ────────────────────────────────────────────────────────────────

export async function fetchSurfForecast(lat = DEFAULT_LAT, lng = DEFAULT_LNG, beachId?: string): Promise<SurfForecastData | null> {
  try {
    // All three Firestore reads in parallel — none depends on each other
    const NO_CAL: BeachCalibration = { ...CAL_DEFAULTS };
    const [_tidesResult, beachOffset, calibration] = await Promise.all([
      fetchWorldTides(lat, lng),
      fetchTideOffset(beachId),
      beachId ? fetchBeachCalibration(beachId) : Promise.resolve(NO_CAL),
    ]);

    // WorldTides = authoritative source; harmonic model = fallback
    let tidesMap = _tidesResult;
    const usingWorldTides = tidesMap !== null;

    if (!tidesMap) {
      _tideOffset = beachOffset;
      tidesMap = computeIsraelTides();
      const _todayKey = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Jerusalem' }).format(new Date());
      const _firstEx = tidesMap.extremes.get(_todayKey)?.[0];
      if (_firstEx) console.log(`[TIDE-SYNC] harmonic fallback: ${_firstEx.timeStr} (${_firstEx.type}) | offset=${_tideOffset}h`);
    } else if (beachOffset !== 0) {
      // Apply per-beach offset to WorldTides data by shifting all hour values
      const shiftMap = (map: Map<string, { hour: number; height: number }[]>) => {
        const shifted = new Map<string, { hour: number; height: number }[]>();
        map.forEach((pts, date) => shifted.set(date, pts.map(p => ({ ...p, hour: +(p.hour + beachOffset).toFixed(4) }))));
        return shifted;
      };
      tidesMap = {
        heights: shiftMap(tidesMap.heights) as Map<string, import('@/lib/api/surf').TidePoint[]>,
        extremes: (() => {
          const shifted = new Map<string, TideExtreme[]>();
          tidesMap!.extremes.forEach((exs, date) => shifted.set(date, exs.map(e => {
            const h = +(e.hour + beachOffset);
            const hh = Math.floor(((h % 24) + 24) % 24);
            const mm = Math.round((h - Math.floor(h)) * 60);
            return { ...e, hour: +h.toFixed(4), timeStr: `${String(hh).padStart(2,'0')}:${String(mm).padStart(2,'0')}` };
          })));
          return shifted;
        })(),
      };
    }

    const [sgHours, isramarBuoy, marineForecastRes, weatherRes, uvRes] = await Promise.all([
      // StormGlass: blended ECMWF+NOAA+DWD+MeteoFrance — best for current conditions
      fetchStormGlass(lat, lng),

      // ISRAMAR Hadera buoy: real measured wave data from Israeli coast
      fetchIsramarBuoy(),

      // Open-Meteo Marine: 7-day hourly wave/swell forecast (best_match picks CMEMS for Med)
      fetch(
        `https://marine-api.open-meteo.com/v1/marine` +
        `?latitude=${lat}&longitude=${lng}` +
        `&hourly=wave_height,wave_direction,wave_period,swell_wave_height,swell_wave_direction,swell_wave_period,wind_wave_height` +
        `&models=ecmwf_wam025&forecast_days=7&timezone=Asia%2FJerusalem`,
        { cache: 'no-store' }
      ),

      // Open-Meteo Weather: ECMWF IFS wind + sunrise/sunset
      fetch(
        `https://api.open-meteo.com/v1/forecast` +
        `?latitude=${lat}&longitude=${lng}` +
        `&current=wind_speed_10m,wind_direction_10m` +
        `&hourly=wind_speed_10m,wind_direction_10m` +
        `&daily=sunrise,sunset` +
        `&models=ecmwf_ifs025` +
        `&wind_speed_unit=kn&forecast_days=7&timezone=Asia%2FJerusalem`,
        { cache: 'no-store' }
      ),

      // Open-Meteo UV: separate request without model constraint — ecmwf_ifs025 doesn't provide UV
      fetch(
        `https://api.open-meteo.com/v1/forecast` +
        `?latitude=${lat}&longitude=${lng}` +
        `&current=uv_index` +
        `&timezone=Asia%2FJerusalem`,
        { cache: 'no-store' }
      ).then(r => r.json()).catch(() => ({})),
    ]);

    const marineForecast = await marineForecastRes.json();
    const weather        = await weatherRes.json();
    const currentUV      = +(uvRes?.current?.uv_index ?? 0).toFixed(0);

    // ── Validate + smooth buoy reading ───────────────────────────────────────
    // validateIsramarBuoy rejects physically impossible or stale readings.
    // getSmoothedBuoyHeight applies an EMA (α=0.35) to prevent UI spikes.
    const validBuoy       = isramarBuoy && validateIsramarBuoy(isramarBuoy) ? isramarBuoy : null;
    const smoothedBuoyHs  = validBuoy ? await getSmoothedBuoyHeight(validBuoy.waveHeight) : null;
    const buoyLive        = smoothedBuoyHs !== null;
    const buoyFaceH       = smoothedBuoyHs !== null ? smoothedBuoyHs / 2 : undefined;

    // ── Current conditions ────────────────────────────────────────────────────
    // Prefer StormGlass (multi-model blend); fall back to Open-Meteo Marine current

    const now = new Date();
    // Build nowIso in Israel local time to match Open-Meteo's timezone=Asia/Jerusalem timestamps.
    // toISOString() is UTC — using it against local-time strings caused nowHourIdx to always be -1.
    const _ilParts = new Intl.DateTimeFormat('en-CA', {
      timeZone: 'Asia/Jerusalem', year: 'numeric', month: '2-digit', day: '2-digit',
      hour: '2-digit', hour12: false,
    }).formatToParts(now);
    const _ilGet = (type: string) => _ilParts.find(p => p.type === type)?.value ?? '0';
    const _ilDate = `${_ilGet('year')}-${_ilGet('month')}-${_ilGet('day')}`;
    const nowIso = `${_ilDate}T${(parseInt(_ilGet('hour')) % 24).toString().padStart(2, '0')}`;

    let current: SurfCurrent;

    if (sgHours && sgHours.length > 0) {
      // Find the closest StormGlass hour to now
      const sgNow = sgHours.find(h => h.time.startsWith(nowIso)) ?? sgHours[0];
      const windMs  = sgVal(sgNow, 'windSpeed');  // StormGlass returns m/s
      const sgWindDir = +sgVal(sgNow, 'windDirection').toFixed(0);
      const windKmh = adjustWind(windMs * 1.944, sgWindDir);  // knots + direction-aware bias
      const waveH   = sgVal(sgNow, 'waveHeight');
      const swellH  = sgVal(sgNow, 'swellHeight');
      // Approximate wind-wave component: sqrt(totalH² - swellH²)
      const windWaveH = Math.sqrt(Math.max(0, waveH * waveH - swellH * swellH));
      const waveP   = sgPeriod(sgNow, 'wavePeriod');
      // buoyFaceH = smoothed + validated EMA face height (or undefined → model only).
      // Rough-sea blend (Hs ≥ 2 m): 80% buoy + 20% spectral via safeCalcWaveHeight.
      const currentFaceH = safeCalcWaveHeight(swellH, windWaveH, waveH, buoyFaceH, beachId) ?? +(waveH / 2).toFixed(1);
      // ── Beach calibration (final human-in-the-loop layer) ──
      const calFaceH  = +(currentFaceH * calibration.height_factor).toFixed(1);
      const calWind   = Math.max(0, Math.round(windKmh  + calibration.wind_bias_knots));
      const calPeriod = +(waveP * calibration.period_factor).toFixed(1);

      const sgWaveDeg = sgVal(sgNow, 'waveDirection');
      current = {
        // ── CORRECTED + CALIBRATED ──
        waveHeight:     calFaceH,
        windSpeed:      calWind,
        // ── RAW — never modified ──
        waveDirection:  degreesToCompass(sgWaveDeg),
        waveDeg:        +sgWaveDeg.toFixed(0),
        wavePeriod:     validBuoy ? +(validBuoy.wavePeriod * calibration.period_factor).toFixed(1) : calPeriod,
        swellHeight:    +sgVal(sgNow, 'swellHeight').toFixed(1),
        swellDirection: degreesToCompass(sgVal(sgNow, 'swellDirection') || sgWaveDeg),
        swellDeg:       +(sgVal(sgNow, 'swellDirection') || sgWaveDeg).toFixed(0),
        swellPeriod:    +sgPeriod(sgNow, 'swellPeriod').toFixed(1),
        windDirection:  degreesToCompass(sgVal(sgNow, 'windDirection')),
        windDeg:        +sgVal(sgNow, 'windDirection').toFixed(0),
        waterTemp:      +sgVal(sgNow, 'waterTemperature').toFixed(1),
        uvIndex:        Math.round(sgVal(sgNow, 'uvIndex')) || currentUV,
        // ── DERIVED (uses calibrated values + swell_angle_offset) ──
        rating:         calcRating(calFaceH, calPeriod, calWind, sgWaveDeg, sgWindDir, calibration.swell_angle_offset),
        waveEnergy:     safeCalcWaveEnergy(calFaceH, calPeriod, beachId) ?? 0,
      };
    } else {
      // Fallback: Open-Meteo Marine current
      const marineCurrentRes = await fetch(
        `https://marine-api.open-meteo.com/v1/marine` +
        `?latitude=${lat}&longitude=${lng}` +
        `&current=wave_height,wave_direction,wave_period,swell_wave_height,swell_wave_direction,swell_wave_period,sea_surface_temperature`,
        { cache: 'no-store' }
      );
      const marineCurrent = await marineCurrentRes.json();
      const cur  = marineCurrent.current ?? {};
      const wcur = weather.current ?? {};
      const fallbackWindDir = wcur.wind_direction_10m ?? 180;
      const windKts = adjustWind(wcur.wind_speed_10m ?? 0, fallbackWindDir);
      const fbSwellH    = cur.swell_wave_height ?? 0;
      const fbWindWaveH = Math.sqrt(Math.max(0, Math.pow(cur.wave_height ?? 0, 2) - Math.pow(fbSwellH, 2)));
      const fbFaceH     = safeCalcWaveHeight(fbSwellH, fbWindWaveH, cur.wave_height ?? 0, undefined, beachId) ?? +((cur.wave_height ?? 0) / 2).toFixed(1);
      const fbCalFaceH  = +(fbFaceH * calibration.height_factor).toFixed(1);
      const fbCalWind   = Math.max(0, Math.round(windKts + calibration.wind_bias_knots));
      const fbCalPeriod = +((cur.wave_period ?? 0) * calibration.period_factor).toFixed(1);

      current = {
        // ── CORRECTED + CALIBRATED ──
        waveHeight:     fbCalFaceH,
        windSpeed:      fbCalWind,
        // ── RAW — never modified ──
        waveDirection:  degreesToCompass(cur.wave_direction ?? 0),
        waveDeg:        +(cur.wave_direction ?? 0),
        wavePeriod:     fbCalPeriod,
        swellHeight:    +(fbSwellH / 2).toFixed(1),
        swellDirection: degreesToCompass(cur.swell_wave_direction ?? 0),
        swellDeg:       +(cur.swell_wave_direction ?? 0),
        swellPeriod:    +(cur.swell_wave_period ?? 0).toFixed(1),
        windDirection:  degreesToCompass(fallbackWindDir),
        windDeg:        fallbackWindDir,
        waterTemp:      +(cur.sea_surface_temperature ?? 0).toFixed(1),
        uvIndex:        currentUV,
        // ── DERIVED (uses calibrated values + swell_angle_offset) ──
        rating:         calcRating(fbCalFaceH, fbCalPeriod, fbCalWind, cur.wave_direction ?? 270, fallbackWindDir, calibration.swell_angle_offset),
        waveEnergy:     safeCalcWaveEnergy(fbCalFaceH, fbCalPeriod, beachId) ?? 0,
      };
    }

    // ── 7-day hourly arrays (Open-Meteo Marine + ECMWF wind) ─────────────────

    const times:         string[] = marineForecast.hourly?.time ?? [];
    const waveHeights:   number[] = marineForecast.hourly?.wave_height ?? [];
    const wavePeriods:   number[] = marineForecast.hourly?.wave_period ?? [];
    const waveDirs:      number[] = marineForecast.hourly?.wave_direction ?? [];
    const swellHeights:  number[] = marineForecast.hourly?.swell_wave_height ?? [];
    const swellDirs:     number[] = marineForecast.hourly?.swell_wave_direction ?? [];
    const swellPeriods:  number[] = marineForecast.hourly?.swell_wave_period ?? [];
    const windWaveHeights: number[] = marineForecast.hourly?.wind_wave_height ?? [];
    const windSpeeds:    number[] = weather.hourly?.wind_speed_10m ?? [];
    const windDirs:      number[] = weather.hourly?.wind_direction_10m ?? [];

    // ── ISRAMAR bias offset — sector-based rolling EMA ───────────────────────
    // Each of 8 wind sectors has an independent EMA stored in Firestore.
    // We read the bias for the current wind sector, then optionally update it.
    let nowHourIdx = times.findIndex(t => t.startsWith(nowIso));
    if (nowHourIdx === -1 && times.length > 0) {
      // Fallback: nearest available entry by wall-clock distance
      const nowMs = now.getTime();
      let minDiff = Infinity;
      times.forEach((t, i) => { const d = Math.abs(new Date(t).getTime() - nowMs); if (d < minDiff) { minDiff = d; nowHourIdx = i; } });
    }
    const currentWindDir = nowHourIdx >= 0 ? (windDirs[nowHourIdx] ?? 180) : 180;

    let waveHeightBiasOffset = await getRollingBias(currentWindDir);

    if (validBuoy && nowHourIdx >= 0) {
      const modelHsNow = waveHeights[nowHourIdx] ?? 0;
      // Background EMA update for this wind sector (rate-limited, non-blocking)
      updateRollingBias(validBuoy.waveHeight, modelHsNow, currentWindDir).catch(() => null);
      // Blend stored sector bias with live error for this request
      const liveError = validBuoy.waveHeight - modelHsNow;
      waveHeightBiasOffset = waveHeightBiasOffset * 0.7 + liveError * 0.3;
      waveHeightBiasOffset = Math.max(-0.8, Math.min(0.8, waveHeightBiasOffset));
    }

    const todayStr = _ilDate; // Israel local date — matches Open-Meteo and computeIsraelTides keys
    const _tmrDate = new Date(_ilDate + 'T12:00:00Z');
    _tmrDate.setUTCDate(_tmrDate.getUTCDate() + 1);
    const tomorrowStr = _tmrDate.toISOString().split('T')[0];

    // ── Apply admin tide-event overrides (saved by BeachCalibrationPanel) ─────
    // beach_hourly_overrides/{beachId}_{date}._tides overrides tidesMap.extremes
    // for today, so the public surf page shows the admin-corrected times/types.
    if (beachId && tidesMap) {
      try {
        const ovSnap = await getDoc(doc(db, 'beach_hourly_overrides', `${beachId}_${todayStr}`));
        if (ovSnap.exists()) {
          const raw       = ovSnap.data() as Record<string, unknown>;
          const adminTides = raw._tides as { time: string; type: 'High' | 'Low' }[] | undefined;
          if (adminTides && adminTides.length > 0) {
            const hourlyPts   = tidesMap.heights.get(todayStr) ?? [];
            const modelExtremes = tidesMap.extremes.get(todayStr) ?? [];

            // ── 1. Compute average time offset (admin vs model, same type) ──────
            const offsets: number[] = [];
            for (const ev of adminTides) {
              const [hh, mm] = ev.time.split(':').map(Number);
              const adminHour = hh + mm / 60;
              // Find nearest model extreme of the same type
              const sameType = modelExtremes.filter(m => m.type === ev.type);
              if (!sameType.length) continue;
              const nearest = sameType.reduce((a, b) =>
                Math.abs(b.hour - adminHour) < Math.abs(a.hour - adminHour) ? b : a
              );
              offsets.push(adminHour - nearest.hour);
            }
            const avgOffset = offsets.length ? offsets.reduce((a, b) => a + b, 0) / offsets.length : 0;

            // ── 2. Shift the tide curve by avgOffset (with clamping) ─────────────
            // For each output hour H, sample the original curve at H - avgOffset,
            // clamped to the available range to avoid edge discontinuities.
            let shiftedPts = hourlyPts;
            if (Math.abs(avgOffset) > 0.05 && hourlyPts.length >= 2) {
              const minH = hourlyPts[0].hour;
              const maxH = hourlyPts[hourlyPts.length - 1].hour;

              const lerp = (srcH: number): number => {
                const clamped = Math.max(minH, Math.min(maxH, srcH));
                let lo = hourlyPts[0], hi = hourlyPts[hourlyPts.length - 1];
                for (let j = 0; j < hourlyPts.length - 1; j++) {
                  if (hourlyPts[j].hour <= clamped && hourlyPts[j + 1].hour >= clamped) {
                    lo = hourlyPts[j]; hi = hourlyPts[j + 1]; break;
                  }
                }
                if (lo.hour === hi.hour) return lo.height;
                const t = (clamped - lo.hour) / (hi.hour - lo.hour);
                return +(lo.height + t * (hi.height - lo.height)).toFixed(3);
              };

              shiftedPts = hourlyPts.map(p => ({ hour: p.hour, height: lerp(p.hour - avgOffset) }));
            }

            // ── 3. Snap dots to peaks/valleys of the SHIFTED curve ───────────────
            const finalExtremes: TideExtreme[] = adminTides.map(ev => {
              const [hh, mm] = ev.time.split(':').map(Number);
              const adminHour = hh + mm / 60;

              if (!shiftedPts.length) {
                return { hour: adminHour, height: 0, type: ev.type, timeStr: ev.time };
              }

              const window = shiftedPts.filter(p => Math.abs(p.hour - adminHour) <= 3);
              const pool   = window.length >= 2 ? window : shiftedPts;

              const best = ev.type === 'High'
                ? pool.reduce((p, c) => c.height > p.height ? c : p)
                : pool.reduce((p, c) => c.height < p.height ? c : p);

              return { hour: best.hour, height: best.height, type: ev.type, timeStr: ev.time };
            });

            const newHeights = new Map(tidesMap.heights);
            newHeights.set(todayStr, shiftedPts);
            const newExtremes = new Map(tidesMap.extremes);
            newExtremes.set(todayStr, finalExtremes);
            tidesMap = { ...tidesMap, heights: newHeights, extremes: newExtremes };
          }
        }
      } catch { /* silently ignore — fall back to model extremes */ }
    }

    // 8 canonical surf time-points: primary (today) + night bridge (tomorrow)
    const SURF_PRIMARY  = [6, 9, 12, 15, 18, 21];
    const SURF_NIGHT    = [0, 3];

    const todayHours: SurfHour[] = [];

    for (let i = 0; i < times.length; i++) {
      const [date, timeStr] = times[i].split('T');
      const hour = parseInt(timeStr);
      const isPrimary = date === todayStr    && SURF_PRIMARY.includes(hour);
      const isNight   = date === tomorrowStr && SURF_NIGHT.includes(hour);
      if (!isPrimary && !isNight) continue;

      // ── RAW fields — never modified by any correction ──
      const rawWavePeriod  = wavePeriods[i]  ?? 0;
      const rawSwellHeight = swellHeights[i] ?? 0;
      const rawSwellDir    = swellDirs[i] ?? waveDirs[i] ?? 270;
      const rawWaveDir     = waveDirs[i]  ?? 270;
      const rawWindDir     = windDirs[i]  ?? 180;

      // ── CORRECTED → CALIBRATED ──
      const rawTotalHs     = (waveHeights[i] ?? 0) + waveHeightBiasOffset;
      const corrWaveHeight = safeCalcWaveHeight(rawSwellHeight, windWaveHeights[i] ?? 0, rawTotalHs, undefined, beachId) ?? +(rawTotalHs / 2).toFixed(1);
      const corrWindSpeed  = adjustWind(windSpeeds[i] ?? 0, rawWindDir);
      const calWaveH  = +(corrWaveHeight * calibration.height_factor).toFixed(1);
      const calWind   = Math.max(0, Math.round(corrWindSpeed + calibration.wind_bias_knots));
      const calPeriod = +(rawWavePeriod  * calibration.period_factor).toFixed(1);

      todayHours.push({
        time:        timeStr.substring(0, 5),
        waveHeight:  calWaveH,
        wavePeriod:  calPeriod,
        swellHeight: +(rawSwellHeight / 2).toFixed(1),
        swellDir:    degreesToCompass(rawSwellDir),
        swellDeg:    rawSwellDir,
        windSpeed:   calWind,
        windDir:     degreesToCompass(rawWindDir),
        windDeg:     rawWindDir,
        rating:      calcRating(calWaveH, calPeriod, calWind, rawWaveDir, rawWindDir, calibration.swell_angle_offset),
        waveEnergy:  safeCalcWaveEnergy(calWaveH, calPeriod, beachId) ?? 0,
      });
    }

    // ── Daily aggregation ─────────────────────────────────────────────────────

    const dayMap: Record<string, { wh: number[]; wp: number[]; sp: number[]; ws: number[]; wd: number[]; wvd: number[]; hours: SurfHour[] }> = {};

    for (let i = 0; i < times.length; i++) {
      const [date, timeStr] = times[i].split('T');
      if (!dayMap[date]) dayMap[date] = { wh: [], wp: [], sp: [], ws: [], wd: [], wvd: [], hours: [] };
      if (waveHeights[i]  != null) dayMap[date].wh.push(waveHeights[i]);
      if (wavePeriods[i]  != null) dayMap[date].wp.push(wavePeriods[i]);
      if (swellPeriods[i] != null) dayMap[date].sp.push(swellPeriods[i]);
      if (windSpeeds[i]   != null) dayMap[date].ws.push(windSpeeds[i]);
      if (windDirs[i]     != null) dayMap[date].wd.push(windDirs[i]);
      if (waveDirs[i]     != null) dayMap[date].wvd.push(waveDirs[i]);

      const hour = parseInt(timeStr);
      if ([0, 3, 6, 9, 12, 15, 18, 21].includes(hour)) {
        // ── RAW fields — never modified by any correction ──
        const rawWavePeriod  = wavePeriods[i]  ?? 0;
        const rawSwellHeight = swellHeights[i] ?? 0;
        const rawSwellDir    = swellDirs[i] ?? waveDirs[i] ?? 270;
        const rawWaveDir     = waveDirs[i]  ?? 270;
        const rawWindDir     = windDirs[i]  ?? 180;

        // ── CORRECTED → CALIBRATED ──
        const dRawTotalHs    = (waveHeights[i] ?? 0) + waveHeightBiasOffset;
        const corrWaveHeight = safeCalcWaveHeight(rawSwellHeight, windWaveHeights[i] ?? 0, dRawTotalHs, undefined, beachId) ?? +(dRawTotalHs / 2).toFixed(1);
        const corrWindSpeed  = adjustWind(windSpeeds[i] ?? 0, rawWindDir);
        const dCalWaveH  = +(corrWaveHeight * calibration.height_factor).toFixed(1);
        const dCalWind   = Math.max(0, Math.round(corrWindSpeed + calibration.wind_bias_knots));
        const dCalPeriod = +(rawWavePeriod  * calibration.period_factor).toFixed(1);

        dayMap[date].hours.push({
          time:        timeStr.substring(0, 5),
          waveHeight:  dCalWaveH,
          wavePeriod:  dCalPeriod,
          swellHeight: +(rawSwellHeight / 2).toFixed(1),
          swellDir:    degreesToCompass(rawSwellDir),
          swellDeg:    rawSwellDir,
          windSpeed:   dCalWind,
          windDir:     degreesToCompass(rawWindDir),
          windDeg:     rawWindDir,
          rating:      calcRating(dCalWaveH, dCalPeriod, dCalWind, rawWaveDir, rawWindDir, calibration.swell_angle_offset),
          waveEnergy:  safeCalcWaveEnergy(dCalWaveH, dCalPeriod, beachId) ?? 0,
        });
      }
    }

    const today = _ilDate; // reuse Israel local date already computed above
    const avg = (arr: number[]) => arr.length ? arr.reduce((a, b) => a + b, 0) / arr.length : 0;

    const days: SurfDay[] = Object.entries(dayMap).slice(0, 7).map(([date, d]) => {
      const avgWindDir = avg(d.wd);
      const waveMin = d.wh.length ? ((Math.min(...d.wh) + waveHeightBiasOffset) / 2) * calibration.height_factor : 0;
      const waveMax = d.wh.length ? ((Math.max(...d.wh) + waveHeightBiasOffset) / 2) * calibration.height_factor : 0;
      const period  = avg(d.wp) * calibration.period_factor;
      const wind    = Math.max(0, adjustWind(avg(d.ws), avgWindDir) + calibration.wind_bias_knots);
      const windDeg = avgWindDir;
      const waveDirAvg = avg(d.wvd);
      const d0    = new Date(date + 'T00:00:00');
      const dateStr = `${d0.getDate()}.${d0.getMonth() + 1}`;
      const label   = date === today
        ? `היום ${dateStr}`
        : `יום ${HEBREW_DAYS[d0.getDay()]} ${dateStr}`;

      // Build 8-point hours: primary [6,9,12,15,18,21] from this date
      // + night bridge [0,3] from the next calendar date
      const _nd = new Date(date + 'T12:00:00Z');
      _nd.setUTCDate(_nd.getUTCDate() + 1);
      const nextDateStr = _nd.toISOString().split('T')[0];
      const primaryHours = d.hours.filter(h => [6, 9, 12, 15, 18, 21].includes(parseInt(h.time)));
      const nightHours   = (dayMap[nextDateStr]?.hours ?? []).filter(h => [0, 3].includes(parseInt(h.time)));

      return {
        date, label,
        waveMin: +waveMin.toFixed(1),
        waveMax: +waveMax.toFixed(1),
        period:  +period.toFixed(1),
        windSpeed: +wind.toFixed(0),
        windDir: degreesToCompass(windDeg),
        windDeg: +windDeg.toFixed(0),
        rating:  calcRating(waveMax, period, wind, waveDirAvg, windDeg),
        hours: [...primaryHours, ...nightHours],
        tides: tidesMap?.heights.get(date) ?? [],
        tideExtremes: tidesMap?.extremes.get(date) ?? [],
      };
    });

    // ── Sunrise / sunset ──────────────────────────────────────────────────────

    const sunriseRaw: string = weather.daily?.sunrise?.[0] ?? '';
    const sunsetRaw:  string = weather.daily?.sunset?.[0]  ?? '';
    const fmtSun = (iso: string) => iso.length >= 16 ? iso.slice(11, 16) : '';
    const shiftTime = (hhmm: string, deltaMins: number) => {
      if (!hhmm) return '';
      const [h, m] = hhmm.split(':').map(Number);
      const total = h * 60 + m + deltaMins;
      const hh = Math.floor(((total % 1440) + 1440) % 1440 / 60);
      const mm = ((total % 60) + 60) % 60;
      return `${String(hh).padStart(2,'0')}:${String(mm).padStart(2,'0')}`;
    };
    const sunrise = fmtSun(sunriseRaw);
    const sunset  = fmtSun(sunsetRaw);

    const sources = [
      buoyLive ? 'ISRAMAR Hadera Buoy (measured)' : 'StormGlass (ECMWF+NOAA+DWD)',
      'StormGlass (wind/direction)',
      'Open-Meteo Marine',
      'ECMWF IFS Wind',
      usingWorldTides ? 'WorldTides API (authoritative)' : 'Harmonic Tide Model (FES2014/TPXO — fallback)',
    ];

    const isCalibrated =
      calibration.height_factor      !== 1.0 ||
      calibration.period_factor      !== 1.0 ||
      calibration.wind_bias_knots    !== 0   ||
      calibration.swell_angle_offset !== 0;

    const confidenceScore =
      30                          // baseline: Open-Meteo always available
      + (buoyLive        ? 35 : 0)  // measured wave data from ISRAMAR
      + (usingWorldTides ? 25 : 0)  // authoritative tides (vs harmonic fallback)
      + (isCalibrated    ? 10 : 0); // beach has been tuned by an operator

    return {
      current,
      todayHours,
      days,
      tides: tidesMap?.heights.get(todayStr) ?? [],
      tideExtremes: tidesMap?.extremes.get(todayStr) ?? [],
      sources,
      buoyLive,
      calibration,
      confidenceScore,
      fetchedAt: new Date().toISOString(),
      sunrise,
      sunset,
      firstLight: shiftTime(sunrise, -30),
      lastLight:  shiftTime(sunset,  +30),
    };
  } catch {
    return null;
  }
}
