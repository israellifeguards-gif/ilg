import { doc, getDoc, setDoc, addDoc, collection } from 'firebase/firestore';
import { db } from '@/lib/firebase/config';

// ── Firestore schema: beach_calibration/{beachId} ────────────────────────────
//
//   height_factor:      number   [0.4, 2.5]    multiplicative — displayed = model × factor
//   period_factor:      number   [0.5, 2.0]    multiplicative — displayed period × factor
//   wind_bias_knots:    number   [-8,  8]       additive       — displayed wind += bias
//   swell_angle_offset: number   [-45, 45]      degrees        — shifts the effective
//                                               coast-facing direction used in
//                                               coastlineCorrection().  Default 0 = 285°.
//                                               Positive = coast faces more northward,
//                                               negative = more southward.
//   observationCount:   number                  total user observations
//   lastObservedHeight: number
//   lastModelHeight:    number
//   lastDelta:          number                  observed − model (signed)
//   updatedAt:          ISO string
//
// Defaults = no correction (pass-through).
// Applied AFTER all model corrections (EMA, buoy blend, bias offset),
// as the final human-in-the-loop tuning layer.
// ─────────────────────────────────────────────────────────────────────────────

export interface BeachCalibration {
  height_factor:      number;
  period_factor:      number;
  wind_bias_knots:    number;
  swell_angle_offset: number;
  current_beach_bias?: number;  // Hs ratio from last TLV override (override / raw)
  current_t_ratio?:   number;   // Period ratio from last TLV override
  current_wind_ratio?: number;  // Wind speed ratio from last TLV override
  // Custom DNA — set via Beach Calibration Tool in admin panel
  proxy_hs_multiplier?:   number;  // overrides BEACH_PROXY_CONFIG.hsMultiplier
  proxy_wind_multiplier?: number;  // overrides BEACH_PROXY_CONFIG.windMultiplier
  proxy_wind_dir_offset?: number;  // overrides BEACH_PROXY_CONFIG.windDirOffset
}

export interface CalibrationDoc extends BeachCalibration {
  observationCount:    number;
  lastObservedHeight:  number;
  lastModelHeight:     number;
  lastDelta:           number;
  updatedAt:           string;
}

export const CAL_DEFAULTS: BeachCalibration = {
  height_factor:      1.0,
  period_factor:      1.0,
  wind_bias_knots:    0,
  swell_angle_offset: 0,
};

// EMA learning rate — α = 0.25 → ~8 honest observations to converge.
const CAL_ALPHA = 0.25;

// ── Audit trail ───────────────────────────────────────────────────────────────
// Every calibration change writes to Firestore: calibration_logs/{auto_id}
// Non-blocking (fire-and-forget) — never holds up the main operation.
// Answers "who changed what and when" for debugging sudden forecast shifts.

interface AuditEntry {
  beachId:   string;
  action:    'observation' | 'manual_override' | 'reset';
  source:    'api' | 'admin_panel';
  timestamp: string;
  before:    Partial<CalibrationDoc>;
  after:     Partial<CalibrationDoc>;
  meta?:     Record<string, unknown>;
}

function writeAuditLog(entry: AuditEntry): void {
  // Fire-and-forget — log failure is non-critical
  addDoc(collection(db, 'calibration_logs'), entry).catch(e =>
    console.error('[calibration] audit log write failed:', e)
  );
}

// Hard clamps
const H_CLAMP: [number, number] = [0.4,  2.5];
const P_CLAMP: [number, number] = [0.5,  2.0];
const W_CLAMP: [number, number] = [-8,   8  ];
const A_CLAMP: [number, number] = [-45,  45 ];

function clamp(v: number, lo: number, hi: number): number {
  return Math.max(lo, Math.min(hi, v));
}

// ── Read ──────────────────────────────────────────────────────────────────────

/** Returns the full calibration document (includes lastModelHeight for "update height" UX). */
export async function fetchCalibrationDoc(beachId: string): Promise<Partial<CalibrationDoc>> {
  try {
    const snap = await getDoc(doc(db, 'beach_calibration', beachId));
    return snap.exists() ? (snap.data() as Partial<CalibrationDoc>) : {};
  } catch {
    return {};
  }
}

export async function fetchBeachCalibration(beachId: string): Promise<BeachCalibration> {
  try {
    const snap = await getDoc(doc(db, 'beach_calibration', beachId));
    if (!snap.exists()) return { ...CAL_DEFAULTS };
    const d = snap.data() as Partial<CalibrationDoc>;
    return {
      height_factor:        clamp(d.height_factor      ?? 1.0, ...H_CLAMP),
      period_factor:        clamp(d.period_factor      ?? 1.0, ...P_CLAMP),
      wind_bias_knots:      clamp(d.wind_bias_knots    ?? 0,   ...W_CLAMP),
      swell_angle_offset:   clamp(d.swell_angle_offset ?? 0,   ...A_CLAMP),
      current_beach_bias:   d.current_beach_bias,
      current_t_ratio:      d.current_t_ratio,
      current_wind_ratio:   d.current_wind_ratio,
      proxy_hs_multiplier:  d.proxy_hs_multiplier,
      proxy_wind_multiplier: d.proxy_wind_multiplier,
      proxy_wind_dir_offset: d.proxy_wind_dir_offset,
    };
  } catch {
    return { ...CAL_DEFAULTS };
  }
}

// ── Write (admin override) ────────────────────────────────────────────────────

export async function setBeachCalibration(
  beachId: string,
  patch: Partial<BeachCalibration>,
  source: 'api' | 'admin_panel' = 'api',
): Promise<void> {
  const ref  = doc(db, 'beach_calibration', beachId);
  const snap = await getDoc(ref);
  const prev = snap.exists() ? (snap.data() as Partial<CalibrationDoc>) : {};

  const next: CalibrationDoc = {
    height_factor:      clamp(patch.height_factor      ?? prev.height_factor      ?? 1.0, ...H_CLAMP),
    period_factor:      clamp(patch.period_factor      ?? prev.period_factor      ?? 1.0, ...P_CLAMP),
    wind_bias_knots:    clamp(patch.wind_bias_knots    ?? prev.wind_bias_knots    ?? 0,   ...W_CLAMP),
    swell_angle_offset: clamp(patch.swell_angle_offset ?? prev.swell_angle_offset ?? 0,   ...A_CLAMP),
    observationCount:   prev.observationCount   ?? 0,
    lastObservedHeight: prev.lastObservedHeight ?? 0,
    lastModelHeight:    prev.lastModelHeight    ?? 0,
    lastDelta:          prev.lastDelta          ?? 0,
    updatedAt:          new Date().toISOString(),
  };

  await setDoc(ref, next);

  const isReset = next.height_factor === 1.0 && next.period_factor === 1.0 &&
                  next.wind_bias_knots === 0  && next.swell_angle_offset === 0;

  writeAuditLog({
    beachId,
    action:    isReset ? 'reset' : 'manual_override',
    source,
    timestamp: next.updatedAt,
    before: {
      height_factor:      prev.height_factor      ?? 1.0,
      period_factor:      prev.period_factor      ?? 1.0,
      wind_bias_knots:    prev.wind_bias_knots    ?? 0,
      swell_angle_offset: prev.swell_angle_offset ?? 0,
    },
    after: {
      height_factor:      next.height_factor,
      period_factor:      next.period_factor,
      wind_bias_knots:    next.wind_bias_knots,
      swell_angle_offset: next.swell_angle_offset,
    },
  });

  console.log(JSON.stringify({
    level:     'info',
    event:     isReset ? 'calibration_reset' : 'calibration_override',
    beachId,
    source,
    patch,
    timestamp: next.updatedAt,
  }));
}

// ── submitBeachObservation ────────────────────────────────────────────────────
// EMA update on height_factor only.
// ratio = observed / model_raw → new_factor = old × (1−α) + ratio × α
// Other factors (period, wind, angle) are set manually via setBeachCalibration.

export async function submitBeachObservation(
  beachId:        string,
  observedHeight: number,
  modelHeight:    number,
): Promise<{ oldFactor: number; newFactor: number; ratio: number; observationCount: number }> {
  if (modelHeight   <= 0) throw new Error('modelHeight must be > 0');
  if (observedHeight <= 0) throw new Error('observedHeight must be > 0');

  // Garbage-report guard — reject if observed deviates >50% from model
  const deviation = Math.abs(observedHeight - modelHeight) / modelHeight;
  if (deviation > 0.5) {
    console.warn(
      `[calibration] GARBAGE_REPORT rejected for ${beachId}: ` +
      `observed=${observedHeight}m model=${modelHeight}m deviation=${(deviation * 100).toFixed(1)}%`
    );
    throw new Error(
      `GARBAGE_REPORT: observed=${observedHeight}m deviates ${(deviation * 100).toFixed(1)}% from model=${modelHeight}m (max 50%)`
    );
  }

  const ref  = doc(db, 'beach_calibration', beachId);
  const snap = await getDoc(ref);
  const prev = snap.exists() ? (snap.data() as Partial<CalibrationDoc>) : {};

  const oldFactor = clamp(prev.height_factor ?? 1.0, ...H_CLAMP);
  const ratio     = observedHeight / modelHeight;
  const newFactor = clamp(oldFactor * (1 - CAL_ALPHA) + ratio * CAL_ALPHA, ...H_CLAMP);
  const count     = (prev.observationCount ?? 0) + 1;

  await setDoc(ref, {
    height_factor:      +newFactor.toFixed(4),
    period_factor:      prev.period_factor      ?? 1.0,
    wind_bias_knots:    prev.wind_bias_knots    ?? 0,
    swell_angle_offset: prev.swell_angle_offset ?? 0,
    observationCount:   count,
    lastObservedHeight: observedHeight,
    lastModelHeight:    modelHeight,
    lastDelta:          +(observedHeight - modelHeight).toFixed(3),
    updatedAt:          new Date().toISOString(),
  } satisfies CalibrationDoc);

  writeAuditLog({
    beachId,
    action:    'observation',
    source:    'api',
    timestamp: new Date().toISOString(),
    before: { height_factor: +oldFactor.toFixed(4) },
    after:  { height_factor: +newFactor.toFixed(4), observationCount: count },
    meta: { observedHeight, modelHeight, ratio: +ratio.toFixed(3) },
  });

  // Structured log — Vercel Log Drain parses this as JSON for filtering / alerting
  console.log(JSON.stringify({
    level:            'info',
    event:            'calibration_observation',
    beachId,
    observationCount: count,
    observed:         observedHeight,
    model:            modelHeight,
    ratio:            +ratio.toFixed(3),
    oldFactor:        +oldFactor.toFixed(4),
    newFactor:        +newFactor.toFixed(4),
    factorDelta:      +(newFactor - oldFactor).toFixed(4),
    timestamp:        new Date().toISOString(),
  }));
  return { oldFactor: +oldFactor.toFixed(4), newFactor: +newFactor.toFixed(4), ratio: +ratio.toFixed(3), observationCount: count };
}

// ── setBeachBias ──────────────────────────────────────────────────────────────
// Persists the correction ratios (override / raw) computed from a TLV manual override.
// These are used by the sync pipeline as forward-looking calibration signals.

// ── setBeachProxyConfig ────────────────────────────────────────────────────────
// Saves custom DNA multipliers for a beach set via the Beach Calibration Tool.
// These override the hardcoded BEACH_PROXY_CONFIG during master propagation.

export async function setBeachProxyConfig(
  beachId: string,
  config: { hsMultiplier: number; windMultiplier: number; windDirOffset: number },
): Promise<void> {
  const ref = doc(db, 'beach_calibration', beachId);
  await setDoc(ref, {
    proxy_hs_multiplier:   +Math.min(5.0, Math.max(0.1, config.hsMultiplier)).toFixed(4),
    proxy_wind_multiplier: +Math.min(5.0, Math.max(0.1, config.windMultiplier)).toFixed(4),
    proxy_wind_dir_offset: +Math.max(-180, Math.min(180, config.windDirOffset)).toFixed(0),
    updatedAt: new Date().toISOString(),
  }, { merge: true });
}

// ── setBeachBias ──────────────────────────────────────────────────────────────
// Persists the correction ratios (override / raw) computed from a TLV manual override.
// These are used by the sync pipeline as forward-looking calibration signals.

export async function setBeachBias(
  beachId: string,
  ratios: { hs: number; t?: number | null; wind?: number | null },
): Promise<void> {
  const ref   = doc(db, 'beach_calibration', beachId);
  const patch: Record<string, number | string> = {
    current_beach_bias: +clamp(ratios.hs,   H_CLAMP[0], H_CLAMP[1]).toFixed(4),
    updatedAt:          new Date().toISOString(),
  };
  if (ratios.t    != null) patch.current_t_ratio    = +clamp(ratios.t,    P_CLAMP[0], P_CLAMP[1]).toFixed(4);
  if (ratios.wind != null) patch.current_wind_ratio = +Math.max(0.1, ratios.wind).toFixed(4);
  await setDoc(ref, patch, { merge: true });
}
