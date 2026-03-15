import { unstable_noStore } from 'next/cache';
import { doc, getDoc, setDoc } from 'firebase/firestore';
import { db } from '@/lib/firebase/config';
import { getRollingBias, updateRollingBias } from './buoyBias';

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
  const isOffshore = dir >= 90 && dir <= 130;
  return Math.round(kts * (isOffshore ? 1.1 : 1.5));
}

// ── Effective surf height (spectral decomposition) ────────────────────────────
// Uses RMS of swell + wind-sea when both are available.
// Falls back to totalHs/2 when windWaveHs is 0 (e.g. ecmwf_wam025 doesn't
// always return wind_wave_height — without it the formula would crush values).
function calcEffectiveWaveHeight(swellHs: number, windWaveHs: number, totalHs: number): number {
  if (windWaveHs > 0 && swellHs > 0) {
    return +( Math.sqrt(Math.pow(swellHs * 1.2, 2) + Math.pow(windWaveHs * 0.6, 2)) / 2 ).toFixed(1);
  }
  // Fallback: use total wave height (simple face height)
  return +(totalHs / 2).toFixed(1);
}

// ── Coastline correction ──────────────────────────────────────────────────────
// Israel's Mediterranean coast faces ~285° (WNW).
// A swell hitting perpendicular (from 285°) gets full energy.
// Oblique swells lose energy proportional to cos(angle difference).
// Returns a multiplier 0.0–1.0.
function coastlineCorrection(waveDeg: number): number {
  const COAST_FACING = 285; // degrees the coast faces (toward sea)
  const diff = Math.abs(((waveDeg - COAST_FACING + 180 + 360) % 360) - 180);
  if (diff >= 90) return 0; // swell coming from land side — no waves
  return Math.cos((diff * Math.PI) / 180);
}

export function calcRating(waveHeight: number, wavePeriod: number, windSpeed: number, waveDeg = 270, windDir = 180): number {
  const correction = coastlineCorrection(waveDeg);
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
        next: { revalidate: 10800 }, // 3h → ≤8 req/day
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
async function fetchTideOffset(): Promise<number> {
  // unstable_noStore() tells Next.js to bypass its in-memory Data Cache
  // for this entire render, even if revalidate/dynamic are somehow overridden upstream.
  unstable_noStore();
  try {
    console.log('[CACHE-CHECK] Reading from Firestore at: ' + new Date().toISOString());
    const snap = await getDoc(doc(db, 'system', 'tide_settings'));
    if (!snap.exists()) {
      console.log('[tide] no tide_settings doc in Firestore, offset=0');
      return 0;
    }
    const raw = (snap.data() as { offsetHours?: number }).offsetHours ?? 0;
    if (typeof raw !== 'number' || raw < -6 || raw > 6) {
      console.warn(`[tide] offsetHours=${raw} out of ±6h range, using 0`);
      return 0;
    }
    console.log(`[tide] offsetHours=${raw} confirmed fresh from Firestore`);
    return raw;
  } catch (e) {
    console.error('[tide] failed to fetch tide_settings:', e);
    return 0;
  }
}

// Write a raw offset value (e.g. from Firestore console or admin panel)
export async function setTideOffsetRaw(offsetHours: number): Promise<void> {
  if (offsetHours < -6 || offsetHours > 6) throw new Error('offsetHours must be within ±6h');
  await setDoc(doc(db, 'system', 'tide_settings'), { offsetHours: +offsetHours.toFixed(3) });
  console.log(`[tide] offset set to ${offsetHours}h`);
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
    console.log(`[DEBUG] Applying Offset: ${_tideOffset}h to Raw Time: ${rawTimeStr} → Final: ${timeStr} (${type})`);
    if (!extremes.has(dateStr)) extremes.set(dateStr, []);
    extremes.get(dateStr)!.push({ hour, height: +_tideH(exactMs).toFixed(3), type, timeStr });
  }

  return { heights, extremes };
}

// ── Main fetch ────────────────────────────────────────────────────────────────

export async function fetchSurfForecast(lat = DEFAULT_LAT, lng = DEFAULT_LNG): Promise<SurfForecastData | null> {
  try {
    // Tides computed locally via harmonic prediction — no API needed
    _tideOffset = await fetchTideOffset();
    const tidesMap = computeIsraelTides();

    // [DEBUG] logs are emitted per-extreme inside computeIsraelTides above.
    const _todayKey = new Date().toISOString().slice(0, 10);
    const _firstEx = tidesMap.extremes.get(_todayKey)?.[0];
    if (_firstEx) {
      console.log(`[TIDE-SYNC] Final Calculated Tide Time: ${_firstEx.timeStr} (${_firstEx.type}, h=${_firstEx.height}m) | offset=${_tideOffset}h`);
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
      // Use buoy as ground truth for current wave height; otherwise use spectral formula
      const currentFaceH = isramarBuoy
        ? +(isramarBuoy.waveHeight / 2).toFixed(1)
        : calcEffectiveWaveHeight(swellH, windWaveH, waveH);

      current = {
        // ── CORRECTED ──
        waveHeight:     currentFaceH,
        windSpeed:      windKmh,
        // ── RAW — never modified ──
        waveDirection:  degreesToCompass(sgVal(sgNow, 'waveDirection')),
        waveDeg:        +sgVal(sgNow, 'waveDirection').toFixed(0),
        wavePeriod:     isramarBuoy ? +isramarBuoy.wavePeriod.toFixed(1) : +sgPeriod(sgNow, 'wavePeriod').toFixed(1),
        swellHeight:    +sgVal(sgNow, 'swellHeight').toFixed(1),
        swellDirection: degreesToCompass(sgVal(sgNow, 'swellDirection') || sgVal(sgNow, 'waveDirection')),
        swellDeg:       +(sgVal(sgNow, 'swellDirection') || sgVal(sgNow, 'waveDirection')).toFixed(0),
        swellPeriod:    +sgPeriod(sgNow, 'swellPeriod').toFixed(1),
        windDirection:  degreesToCompass(sgVal(sgNow, 'windDirection')),
        windDeg:        +sgVal(sgNow, 'windDirection').toFixed(0),
        waterTemp:      +sgVal(sgNow, 'waterTemperature').toFixed(1),
        uvIndex:        Math.round(sgVal(sgNow, 'uvIndex')) || currentUV,
        // ── DERIVED ──
        rating:         calcRating(currentFaceH, waveP, windKmh, sgVal(sgNow, 'waveDirection'), sgWindDir),
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
      const fbFaceH     = calcEffectiveWaveHeight(fbSwellH, fbWindWaveH, cur.wave_height ?? 0);

      current = {
        // ── CORRECTED ──
        waveHeight:     fbFaceH,
        windSpeed:      windKts,
        // ── RAW — never modified ──
        waveDirection:  degreesToCompass(cur.wave_direction ?? 0),
        waveDeg:        +(cur.wave_direction ?? 0),
        wavePeriod:     +(cur.wave_period ?? 0).toFixed(1),
        swellHeight:    +(fbSwellH / 2).toFixed(1),
        swellDirection: degreesToCompass(cur.swell_wave_direction ?? 0),
        swellDeg:       +(cur.swell_wave_direction ?? 0),
        swellPeriod:    +(cur.swell_wave_period ?? 0).toFixed(1),
        windDirection:  degreesToCompass(fallbackWindDir),
        windDeg:        fallbackWindDir,
        waterTemp:      +(cur.sea_surface_temperature ?? 0).toFixed(1),
        uvIndex:        currentUV,
        // ── DERIVED ──
        rating:         calcRating(fbFaceH, cur.wave_period ?? 0, windKts, cur.wave_direction ?? 270, fallbackWindDir),
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
    const nowHourIdx = times.findIndex(t => t.startsWith(nowIso));
    const currentWindDir = nowHourIdx >= 0 ? (windDirs[nowHourIdx] ?? 180) : 180;

    let waveHeightBiasOffset = await getRollingBias(currentWindDir);

    if (isramarBuoy && nowHourIdx >= 0) {
      const modelHsNow = waveHeights[nowHourIdx] ?? 0;
      // Background EMA update for this wind sector (rate-limited, non-blocking)
      updateRollingBias(isramarBuoy.waveHeight, modelHsNow, currentWindDir).catch(() => null);
      // Blend stored sector bias with live error for this request
      const liveError = isramarBuoy.waveHeight - modelHsNow;
      waveHeightBiasOffset = waveHeightBiasOffset * 0.7 + liveError * 0.3;
      waveHeightBiasOffset = Math.max(-0.8, Math.min(0.8, waveHeightBiasOffset));
    }

    const todayStr = _ilDate; // Israel local date — matches Open-Meteo and computeIsraelTides keys
    const todayHours: SurfHour[] = [];

    for (let i = 0; i < times.length; i++) {
      const [date, timeStr] = times[i].split('T');
      if (date !== todayStr) continue;
      const hour = parseInt(timeStr);
      if (hour < 6 || hour > 21 || hour % 3 !== 0) continue;

      // ── RAW fields — never modified by any correction ──
      const rawWavePeriod  = wavePeriods[i]  ?? 0;
      const rawSwellHeight = swellHeights[i] ?? 0;
      const rawSwellDir    = swellDirs[i] ?? waveDirs[i] ?? 270;
      const rawWaveDir     = waveDirs[i]  ?? 270;
      const rawWindDir     = windDirs[i]  ?? 180;

      // ── CORRECTED fields — only these two are processed ──
      const corrWaveHeight = calcEffectiveWaveHeight(rawSwellHeight, windWaveHeights[i] ?? 0, (waveHeights[i] ?? 0) + waveHeightBiasOffset);
      const corrWindSpeed  = adjustWind(windSpeeds[i] ?? 0, rawWindDir);

      todayHours.push({
        time:        timeStr.substring(0, 5),
        waveHeight:  corrWaveHeight,
        wavePeriod:  +rawWavePeriod.toFixed(1),
        swellHeight: +(rawSwellHeight / 2).toFixed(1),
        swellDir:    degreesToCompass(rawSwellDir),
        swellDeg:    rawSwellDir,
        windSpeed:   corrWindSpeed,
        windDir:     degreesToCompass(rawWindDir),
        windDeg:     rawWindDir,
        rating:      calcRating(corrWaveHeight, rawWavePeriod, corrWindSpeed, rawWaveDir, rawWindDir),
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
      if (hour >= 6 && hour <= 21 && hour % 3 === 0) {
        // ── RAW fields — never modified by any correction ──
        const rawWavePeriod  = wavePeriods[i]  ?? 0;
        const rawSwellHeight = swellHeights[i] ?? 0;
        const rawSwellDir    = swellDirs[i] ?? waveDirs[i] ?? 270;
        const rawWaveDir     = waveDirs[i]  ?? 270;
        const rawWindDir     = windDirs[i]  ?? 180;

        // ── CORRECTED fields — only these two are processed ──
        const corrWaveHeight = calcEffectiveWaveHeight(rawSwellHeight, windWaveHeights[i] ?? 0, (waveHeights[i] ?? 0) + waveHeightBiasOffset);
        const corrWindSpeed  = adjustWind(windSpeeds[i] ?? 0, rawWindDir);

        dayMap[date].hours.push({
          time:        timeStr.substring(0, 5),
          waveHeight:  corrWaveHeight,
          wavePeriod:  +rawWavePeriod.toFixed(1),
          swellHeight: +(rawSwellHeight / 2).toFixed(1),
          swellDir:    degreesToCompass(rawSwellDir),
          swellDeg:    rawSwellDir,
          windSpeed:   corrWindSpeed,
          windDir:     degreesToCompass(rawWindDir),
          windDeg:     rawWindDir,
          rating:      calcRating(corrWaveHeight, rawWavePeriod, corrWindSpeed, rawWaveDir, rawWindDir),
        });
      }
    }

    const today = _ilDate; // reuse Israel local date already computed above
    const avg = (arr: number[]) => arr.length ? arr.reduce((a, b) => a + b, 0) / arr.length : 0;

    const days: SurfDay[] = Object.entries(dayMap).slice(0, 7).map(([date, d]) => {
      const avgWindDir = avg(d.wd);
      const waveMin = d.wh.length ? (Math.min(...d.wh) + waveHeightBiasOffset) / 2 : 0;
      const waveMax = d.wh.length ? (Math.max(...d.wh) + waveHeightBiasOffset) / 2 : 0;
      const period  = avg(d.wp);
      const wind    = adjustWind(avg(d.ws), avgWindDir);
      const windDeg = avgWindDir;
      const waveDirAvg = avg(d.wvd);
      const d0    = new Date(date + 'T00:00:00');
      const dateStr = `${d0.getDate()}.${d0.getMonth() + 1}`;
      const label   = date === today
        ? `היום ${dateStr}`
        : `יום ${HEBREW_DAYS[d0.getDay()]} ${dateStr}`;
      return {
        date, label,
        waveMin: +waveMin.toFixed(1),
        waveMax: +waveMax.toFixed(1),
        period:  +period.toFixed(1),
        windSpeed: +wind.toFixed(0),
        windDir: degreesToCompass(windDeg),
        windDeg: +windDeg.toFixed(0),
        rating:  calcRating(waveMax, period, wind, waveDirAvg, windDeg),
        hours: d.hours,
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
      isramarBuoy ? 'ISRAMAR Hadera Buoy (measured)' : 'StormGlass (ECMWF+NOAA+DWD)',
      'StormGlass (wind/direction)',
      'Open-Meteo Marine',
      'ECMWF IFS Wind',
      'Harmonic Tide Model (FES2014/TPXO)',
    ];

    return {
      current,
      todayHours,
      days,
      tides: tidesMap?.heights.get(todayStr) ?? [],
      tideExtremes: tidesMap?.extremes.get(todayStr) ?? [],
      sources,
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
