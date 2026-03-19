'use client';

import React from 'react';
import type { TidePoint, TideExtreme } from '@/lib/api/surf';

// ── Types ─────────────────────────────────────────────────────────────────────

type TideLabel = { hour: number; height: number; type: 'high' | 'low'; timeStr: string };

// ── Sinusoidal tide engine ─────────────────────────────────────────────────────

/** Standard harmonic cosine between two consecutive extremes. */
function cosInterp(
  e0: { hour: number; height: number },
  e1: { hour: number; height: number },
  t:  number,
): number {
  const frac = (t - e0.hour) / (e1.hour - e0.hour);
  return (e0.height + e1.height) / 2 + (e0.height - e1.height) / 2 * Math.cos(Math.PI * frac);
}

/**
 * Build a dense 481-point curve (step = 0.05 h ≈ 3 min) from a sorted extreme list.
 * Uses cosInterp per segment + linear extrapolation at the day edges so the
 * curve always spans h ∈ [0, 24].  At typical SVG widths this is sub-pixel
 * smooth — no Catmull-Rom or bezier smoothing needed.
 */
function buildSineCurve(sorted: { hour: number; height: number }[]): { hour: number; height: number }[] {
  if (sorted.length < 2) return [];
  const STEPS = 480;
  const hp0 = sorted[1].hour - sorted[0].hour;
  const hpN = sorted[sorted.length - 1].hour - sorted[sorted.length - 2].hour;
  const pre  = { hour: sorted[0].hour - hp0,                     height: sorted[1].height };
  const post = { hour: sorted[sorted.length - 1].hour + hpN,     height: sorted[sorted.length - 2].height };

  const pts: { hour: number; height: number }[] = [];
  for (let i = 0; i <= STEPS; i++) {
    const h = (i / STEPS) * 24;
    let height: number;
    if (h <= sorted[0].hour) {
      height = cosInterp(pre, sorted[0], h);
    } else if (h >= sorted[sorted.length - 1].hour) {
      height = cosInterp(sorted[sorted.length - 1], post, h);
    } else {
      let j = 0;
      while (j < sorted.length - 1 && sorted[j + 1].hour <= h) j++;
      height = cosInterp(sorted[j], sorted[j + 1], h);
    }
    pts.push({ hour: h, height });
  }
  return pts;
}

/** Linear interpolation of height at hour `h` from a dense point array. */
function interpHeight(pts: { hour: number; height: number }[], h: number): number | null {
  if (pts.length < 2) return null;
  if (h <= pts[0].hour) return pts[0].height;
  if (h >= pts[pts.length - 1].hour) return pts[pts.length - 1].height;
  let i = 0;
  while (i < pts.length - 1 && pts[i + 1].hour <= h) i++;
  const lo = pts[i], hi = pts[i + 1];
  if (lo.hour === hi.hour) return lo.height;
  return lo.height + (h - lo.hour) / (hi.hour - lo.hour) * (hi.height - lo.height);
}

/**
 * Ensures the extreme list produces ≥ 4 visible labels within [0, 24] by
 * predicting missing High/Low events using the measured half-period
 * (clamped to the natural tidal range 4.5–7.5 h).
 */
function completeTidalCycle(userExtremes: TideLabel[]): TideLabel[] {
  if (userExtremes.length === 0) return [];
  const sorted = [...userExtremes].sort((a, b) => a.hour - b.hour);

  const measured = sorted.length >= 2
    ? (sorted[sorted.length - 1].hour - sorted[0].hour) / (sorted.length - 1)
    : 6.2;
  const HP = Math.max(4.5, Math.min(7.5, measured));

  const highs = sorted.filter(e => e.type === 'high');
  const lows  = sorted.filter(e => e.type === 'low');
  const avgHi = highs.length ? highs.reduce((s, e) => s + e.height, 0) / highs.length : 1.5;
  const avgLo = lows.length  ? lows.reduce((s,  e) => s + e.height, 0) / lows.length  : 0.3;

  const fmtH = (h: number): string => {
    const norm = ((h % 24) + 24) % 24;
    const hh = Math.floor(norm);
    const mm = Math.round((norm - hh) * 60);
    return `${String(hh).padStart(2, '0')}:${String(mm >= 60 ? 0 : mm).padStart(2, '0')}`;
  };
  const flip     = (tp: 'high' | 'low'): 'high' | 'low' => tp === 'high' ? 'low' : 'high';
  const heightOf = (tp: 'high' | 'low') => tp === 'high' ? avgHi : avgLo;

  const result: TideLabel[] = [...sorted];

  // Extend backward until we have a point comfortably before h = 0
  for (let guard = 0; guard < 10 && result[0].hour > -HP * 0.5; guard++) {
    const newType = flip(result[0].type);
    const newH    = result[0].hour - HP;
    result.unshift({ hour: newH, height: heightOf(newType), type: newType, timeStr: fmtH(newH) });
  }
  // Extend forward until we have a point comfortably after h = 24
  for (let guard = 0; guard < 10 && result[result.length - 1].hour < 24 + HP * 0.5; guard++) {
    const newType = flip(result[result.length - 1].type);
    const newH    = result[result.length - 1].hour + HP;
    result.push({ hour: newH, height: heightOf(newType), type: newType, timeStr: fmtH(newH) });
  }

  return result;
}

// ── TideChart ─────────────────────────────────────────────────────────────────

const DARK  = { axis: '#475569', fill: '#38bdf8', hi: '#7dd3fc', lo: '#94a3b8', base: '#1e293b' };
const LIGHT = { axis: '#94a3b8', fill: '#2563eb', hi: '#1d4ed8', lo: '#64748b', base: '#e2e8f0' };

export function TideChart({
  tides,
  exactExtremes = [],
  isDark = true,
}: {
  tides: TidePoint[];
  exactExtremes?: TideExtreme[];
  isDark?: boolean;
}) {
  const [nowHour, setNowHour] = React.useState<number | null>(null);
  React.useEffect(() => {
    setNowHour(new Date().getHours() + new Date().getMinutes() / 60);
  }, []);

  // Unique gradient/clip IDs so multiple instances don't clash
  const uid     = React.useId().replace(/:/g, '');
  const gradId  = `tcGrad${uid}`;
  const clipId  = `tcClip${uid}`;

  const colors = isDark ? DARK : LIGHT;

  // ── Layout constants ───────────────────────────────────────────────────────
  const W  = 360;
  const H  = 200;
  //  left/right pad wide enough that "00:00" (≈33 px at 11 px font, centered)
  //  stays fully inside the viewBox on both sides.
  const PAD = { top: 44, bottom: 48, left: 28, right: 28 };
  const innerW = W - PAD.left - PAD.right;   // 304
  const innerH = H - PAD.top  - PAD.bottom;  // 108

  // ── Build normalised extreme list ──────────────────────────────────────────
  const userExtremes: TideLabel[] = exactExtremes.map(e => {
    const [hh, mm] = e.timeStr.split(':').map(Number);
    return {
      hour:    hh + (mm || 0) / 60,
      height:  e.height,
      type:    e.type === 'High' ? 'high' : 'low',
      timeStr: e.timeStr,
    };
  });

  // Always complete cycle so we get ≥ 4 labels; even a single extreme produces
  // a plausible 24-hour wave via prediction.
  const allExtremes: TideLabel[] =
    userExtremes.length >= 1
      ? completeTidalCycle(userExtremes)
      : [];

  const labelExtremes: TideLabel[] = allExtremes.filter(e => e.hour >= 0 && e.hour <= 24);

  // ── Dense sinusoidal curve — always use cosine engine ─────────────────────
  // 481 points (every 3 min) → ~0.63 px/step at innerW=304, visually perfect.
  const curvePts: { hour: number; height: number }[] =
    allExtremes.length >= 2
      ? buildSineCurve(allExtremes)
      : tides; // raw hourly fallback only when no extreme data at all

  // ── Vertical scale with 15 % breathing room ────────────────────────────────
  const allH    = curvePts.map(p => p.height);
  const rawMin  = Math.min(...allH);
  const rawMax  = Math.max(...allH);
  const pad15   = (rawMax - rawMin || 0.01) * 0.15;
  const domMin  = rawMin - pad15;
  const domMax  = rawMax + pad15;
  const domRange = domMax - domMin;

  const toX = (h: number) => PAD.left + (h / 24) * innerW;
  const toY = (v: number) => PAD.top + innerH - ((v - domMin) / domRange) * innerH;

  // ── Smooth cubic-bezier path ───────────────────────────────────────────────
  // Each cosine segment has zero derivative at both endpoints (extremes), so the
  // perfect cubic-bezier approximation uses horizontal control points at ±1/3 dx.
  // For the edges (before first extreme, after last extreme) we use the dense
  // L-command polyline from buildSineCurve, which is sub-pixel smooth.
  //
  // Practical approach: generate the SVG path as one M + a series of C commands,
  // one per consecutive extreme pair, clipped to [0, 24].
  let pathD = '';
  let fillD = '';

  if (curvePts.length >= 2) {
    // Dense polyline path (smooth at this resolution)
    pathD = curvePts
      .map((p, i) => `${i === 0 ? 'M' : 'L'}${toX(p.hour).toFixed(1)},${toY(p.height).toFixed(1)}`)
      .join(' ');
    fillD = `${pathD} L${toX(24).toFixed(1)},${(PAD.top + innerH).toFixed(1)} L${toX(0).toFixed(1)},${(PAD.top + innerH).toFixed(1)}Z`;
  }

  // ── Now marker ─────────────────────────────────────────────────────────────
  const nowX      = nowHour !== null && nowHour >= 0 && nowHour <= 24 ? toX(nowHour) : null;
  const nowHeight = nowHour !== null ? interpHeight(curvePts, nowHour) : null;

  const hourLabels = [0, 6, 12, 18, 24];

  return (
    // overflow: hidden prevents any label bleed from causing horizontal scroll
    <div style={{ width: '100%', overflow: 'hidden' }}>
      <svg
        viewBox={`0 0 ${W} ${H}`}
        width="100%"
        style={{ display: 'block', overflow: 'visible' }}
        aria-label="גרף גאות ושפל"
      >
        <defs>
          <linearGradient id={gradId} x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%"   stopColor={colors.fill} stopOpacity="0.40" />
            <stop offset="70%"  stopColor={colors.fill} stopOpacity="0.06" />
            <stop offset="100%" stopColor={colors.fill} stopOpacity="0"    />
          </linearGradient>
          <clipPath id={clipId}>
            <rect x={PAD.left} y={PAD.top} width={innerW} height={innerH} />
          </clipPath>
        </defs>

        {/* Gradient fill — clipped to chart area */}
        {fillD && <path d={fillD} fill={`url(#${gradId})`} clipPath={`url(#${clipId})`} />}

        {/* Smooth curve — 481 dense L-commands, sub-pixel at all mobile widths */}
        {pathD && (
          <path
            d={pathD}
            fill="none"
            stroke={colors.fill}
            strokeWidth={2.8}
            strokeLinejoin="round"
            strokeLinecap="round"
          />
        )}

        {/* Extreme dots + labels ───────────────────────────────────────────── */}
        {labelExtremes.map((e, i) => {
          const isHigh = e.type === 'high';
          const cx = toX(e.hour);
          const cy = toY(e.height);

          // Breathing room targets (dot radius = 5):
          //   HIGH → label baseline 22 px above cy:
          //          visual label-bottom ≈ cy−19, dot-top = cy−5, gap ≈ 14 px ✓
          //   LOW  → label baseline 26 px below cy:
          //          visual label-top    ≈ cy+17, dot-bottom = cy+5, gap ≈ 12 px ✓
          const rawLY  = isHigh ? cy - 22 : cy + 26;
          const labelY = Math.max(14, Math.min(H - 14, rawLY));

          const labelColor = isHigh ? colors.hi : colors.lo;

          return (
            <g key={i}>
              {/* Dot */}
              <circle cx={cx} cy={cy} r={5} fill={isHigh ? colors.fill : '#64748b'} />
              <circle cx={cx} cy={cy} r={2} fill="#ffffff" />

              {/* Label: type + time, centered on the dot's x position */}
              <text
                x={cx}
                y={labelY}
                textAnchor="middle"
                fontSize={11}
                fontWeight="700"
                fontFamily="Inter,Assistant,system-ui,sans-serif"
                fill={labelColor}
              >
                {isHigh ? 'גאות' : 'שפל'}
              </text>
              <text
                x={cx}
                y={labelY + 13}
                textAnchor="middle"
                fontSize={10}
                fontWeight="600"
                fontFamily="Inter,Assistant,system-ui,sans-serif"
                fill={labelColor}
              >
                {e.timeStr}
              </text>
            </g>
          );
        })}

        {/* Current time: red dashed line + white dot with red border */}
        {nowX !== null && (
          <>
            <line
              x1={nowX} y1={PAD.top}
              x2={nowX} y2={PAD.top + innerH}
              stroke="#ef4444" strokeWidth={1.5} strokeDasharray="5 3"
            />
            {nowHeight !== null && (
              <circle
                cx={nowX} cy={toY(nowHeight)} r={4.5}
                fill="#ffffff" stroke="#ef4444" strokeWidth={2}
              />
            )}
          </>
        )}

        {/* X-axis time labels ─────────────────────────────────────────────── */}
        {/*  All five labels use textAnchor="middle" so they center on their   */}
        {/*  tick.  PAD.left=28 & PAD.right=28 keep toX(0)=28 and toX(24)=332, */}
        {/*  so "00:00" (≈33 px wide) extends to x≈11.5 and x≈348.5 — both    */}
        {/*  well inside the 0–360 viewBox.                                    */}
        {hourLabels.map(h => (
          <text
            key={h}
            x={toX(h)}
            y={H - 10}
            textAnchor="middle"
            fontSize={11}
            fontWeight="700"
            fontFamily="Inter,Assistant,system-ui,sans-serif"
            fill={colors.axis}
          >
            {h === 24 ? '00:00' : `${String(h).padStart(2, '0')}:00`}
          </text>
        ))}

        {/* Baseline */}
        <line
          x1={PAD.left} y1={PAD.top + innerH}
          x2={PAD.left + innerW} y2={PAD.top + innerH}
          stroke={colors.base} strokeWidth={1}
        />
      </svg>
    </div>
  );
}
