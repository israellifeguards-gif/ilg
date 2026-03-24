'use client';

import React, { useState, useEffect } from 'react';
import Link from 'next/link';
import type { SurfForecastData } from '@/lib/api/surf';
import { calcRating } from '@/lib/api/surf';
import { subscribeToHourlyTimeSeries } from '@/lib/api/beachTimeSeries';
import type { HourlyEntry } from '@/lib/api/beachTimeSeries';
import { BeachSelector } from './BeachSelector';
import { TideChart } from './TideChart';

function todayIsrael(): string {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Jerusalem', year: 'numeric', month: '2-digit', day: '2-digit',
  }).formatToParts(new Date());
  const g = (type: string) => parts.find(p => p.type === type)?.value ?? '0';
  return `${g('year')}-${g('month')}-${g('day')}`;
}

// Night slots 00:00 and 03:00 are stored in tomorrow's Firestore document.
// Compute tomorrow as UTC-noon anchor to avoid any local-timezone date shift.
function tomorrowIsrael(): string {
  const d = new Date(todayIsrael() + 'T12:00:00Z');
  d.setUTCDate(d.getUTCDate() + 1);
  return d.toISOString().split('T')[0];
}

function currentIsraelFractionalHour(): number {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Jerusalem', hour: '2-digit', minute: '2-digit', hour12: false,
  }).formatToParts(new Date());
  const h = parseInt(parts.find(p => p.type === 'hour')?.value   ?? '0');
  const m = parseInt(parts.find(p => p.type === 'minute')?.value ?? '0');
  return h + m / 60;
}

// Night slots (00, 03) are next-day — map to 24/27 so they only win past midnight
function normalizeSlotHour(time: string): number {
  const n = parseInt(time);
  return n < 6 ? n + 24 : n;
}

// Shortest-path angular interpolation (handles 0°/360° wrap)
function interpolateAngle(a: number, b: number, t: number): number {
  let diff = b - a;
  if (diff >  180) diff -= 360;
  if (diff < -180) diff += 360;
  return Math.round(((a + diff * t) % 360 + 360) % 360);
}

function degreesToCompassLocal(deg: number): string {
  const dirs = ['N', 'NE', 'E', 'SE', 'S', 'SW', 'W', 'NW'];
  return dirs[Math.round(((deg % 360) + 360) % 360 / 45) % 8];
}

// ── Theme ─────────────────────────────────────────────────────────────────────
const DARK_THEME = {
  bg:          '#060f1e',
  bgCard:      '#0a1628',
  bgRow:       '#0f2035',
  bgRow2:      '#060f1e',
  border:      '#1e293b',
  txt:         '#ffffff',
  txt2:        '#64748b',
  txt3:        '#94a3b8',
  gold:        '#f59e0b',
  blue:        '#38bdf8',
  btnBg:       '#1e3a5f',
  btnTxt:      '#38bdf8',
  btnBorder:   '#2d4f7a',
  statBg:      '#0f2035',
  ratingEmpty: '#1e293b',
  waveFillBg:  '#1e293b',
  sectionTxt:  '#64748b',
  headBg:      '#0a1628',
  tideGrid:    '#1e293b',
  tideSea:     '#334155',
  tideLabel:   '#ffffff',
  dropdownBg:  '#0f2035',
  dropdownBorder: '#1e3a5f',
  dropdownItem:   '#cbd5e1',
  dropdownSel:    '#38bdf8',
  dropdownSelBg:  '#1e3a5f',
  dropdownDiv:    '#1e293b',
};

const LIGHT_THEME = {
  bg:          '#f9fafb',
  bgCard:      '#ffffff',
  bgRow:       '#ffffff',
  bgRow2:      '#f9fafb',
  border:      '#000000',
  txt:         '#0f172a',
  txt2:        '#374151',
  txt3:        '#6b7280',
  gold:        '#d97706',
  blue:        '#2563eb',
  btnBg:       '#2a2a2a',
  btnTxt:      '#ffffff',
  btnBorder:   '#000000',
  statBg:      '#ffffff',
  ratingEmpty: '#e2e8f0',
  waveFillBg:  '#f1f5f9',
  sectionTxt:  '#374151',
  headBg:      '#ffffff',
  tideGrid:    '#e2e8f0',
  tideSea:     '#cbd5e1',
  tideLabel:   '#0f172a',
  dropdownBg:  '#ffffff',
  dropdownBorder: '#000000',
  dropdownItem:   '#0f172a',
  dropdownSel:    '#ffffff',
  dropdownSelBg:  '#000000',
  dropdownDiv:    '#000000',
};

type Theme = typeof DARK_THEME;

// ── Rating helpers ─────────────────────────────────────────────────────────────
const RATING_COLOR: Record<number, string> = {
  1: '#64748b', 2: '#64748b',
  3: '#3b82f6', 4: '#3b82f6',
  5: '#10b981', 6: '#10b981',
  7: '#f59e0b', 8: '#f59e0b',
  9: '#ef4444', 10: '#ef4444',
};
const RATING_LABEL: Record<number, string> = {
  1: 'סגור', 2: 'גרוע', 3: 'חלש', 4: 'בינוני',
  5: 'סביר', 6: 'טוב', 7: 'טוב מאוד', 8: 'מצוין',
  9: 'אפי', 10: 'מושלם',
};
function ratingColor(r: number) {
  return RATING_COLOR[Math.max(1, Math.min(10, r))] ?? '#64748b';
}

// ── Shared components ─────────────────────────────────────────────────────────
function Stars({ rating, t }: { rating: number; t: Theme }) {
  const filled = Math.round(rating / 2);
  return (
    <div className="flex gap-px">
      {Array.from({ length: 5 }, (_, i) => (
        <span key={i} style={{ fontSize: 14, color: i < filled ? '#f59e0b' : t.ratingEmpty, lineHeight: 1 }}>★</span>
      ))}
    </div>
  );
}

function WaveFill({ waveHeight, rating, t }: { waveHeight: number; rating: number; t: Theme }) {
  const color = ratingColor(rating);
  const W = 44, H = 44;
  const fillRatio = Math.min(1, Math.max(0, waveHeight / 3));
  const fillY = H - fillRatio * H;
  const amp = 3, wl = W / 1.5;
  let wavePath = `M 0 ${fillY}`;
  for (let x = 0; x <= W; x += 1) {
    wavePath += ` L ${x} ${fillY + amp * Math.sin((x / wl) * 2 * Math.PI)}`;
  }
  wavePath += ` L ${W} ${H} L 0 ${H} Z`;
  return (
    <svg width={W} height={H} viewBox={`0 0 ${W} ${H}`} style={{ display: 'block', margin: '0 auto', borderRadius: 4 }}>
      <rect width={W} height={H} fill={t.waveFillBg} rx={4} />
      <path d={wavePath} fill={color} opacity={0.85} />
    </svg>
  );
}

function Arrow({ deg, size = 14, color }: { deg: number; size?: number; color: string }) {
  return (
    <span style={{ display: 'inline-block', transform: `rotate(${deg}deg)`, fontSize: size, lineHeight: 1, fontWeight: 900, color }}>
      ⬆
    </span>
  );
}


function windColor(speed: number): string {
  if (speed < 4)  return '#b4f0fa'; // <4 kts  = calm        (Windy light blue)
  if (speed < 8)  return '#74d0f0'; // 4-7 kts  = light      (Windy cyan)
  if (speed < 13) return '#66bd48'; // 8-12 kts = gentle     (Windy green)
  if (speed < 18) return '#8db82a'; // 13-17 kts = moderate  (Windy yellow-green)
  if (speed < 24) return '#f0d800'; // 18-23 kts = fresh     (Windy yellow)
  if (speed < 30) return '#f09000'; // 24-29 kts = strong    (Windy orange)
  if (speed < 37) return '#d85800'; // 30-36 kts = very strong (Windy dark orange)
  return '#d81400';                 // 37+ kts = storm       (Windy red)
}

// ── Wave Bar Chart ────────────────────────────────────────────────────────────

const SLOTS = [
  { label: 'בוקר', hours: ['06:00', '07:00', '08:00', '09:00'] },
  { label: 'צהריים', hours: ['11:00', '12:00', '13:00', '14:00'] },
  { label: 'ערב', hours: ['17:00', '18:00', '19:00', '20:00'] },
];

function slotWave(hours: { time: string; waveHeight: number }[], slotHours: string[]): number {
  const vals = hours.filter(h => slotHours.includes(h.time)).map(h => h.waveHeight);
  if (!vals.length) return 0;
  return +(vals.reduce((a, b) => a + b, 0) / vals.length).toFixed(1);
}

function WaveBarChart({ days, t }: { days: import('@/lib/api/surf').SurfDay[]; t: Theme; isDark: boolean }) {
  const chartDays = days;
  const slotColors = ['#60a5fa', '#4ade80', '#ef4444'];

  const allVals: number[] = [];
  const rows = chartDays.map(day => {
    const vals = SLOTS.map(s => slotWave(day.hours, s.hours));
    allVals.push(...vals);
    const parts = day.label.split(' ');
    const dateStr = parts[parts.length - 1];
    const [d, m] = dateStr.split('.');
    const dayName = parts.length >= 3 ? parts[1] : parts[0];
    return { dayName, dateStr: `${d}/${m}`, vals };
  });
  const maxVal = Math.max(...allVals, 0.5);
  const BAR_MAX_H = 110;

  return (
    <div className="mt-3 pt-4 pb-2" style={{ borderTop: `1px solid ${t.border}` }}>
      {/* Legend */}
      <div className="flex gap-4 mb-4 text-xs font-bold" style={{ color: t.txt3 }}>
        {SLOTS.map((s, i) => (
          <div key={s.label} className="flex items-center gap-1">
            <span style={{ width: 10, height: 10, borderRadius: 2, backgroundColor: slotColors[i], display: 'inline-block' }} />
            {s.label}
          </div>
        ))}
      </div>

      {/* Vertical bar chart — groups separated by background cards */}
      <div className="flex gap-1.5" style={{ alignItems: 'flex-end' }}>
        {rows.map((row, di) => (
          <div
            key={di}
            className="flex flex-col items-center"
            style={{
              flex: 1,
              borderRadius: 6,
              padding: '8px 4px 8px 4px',
              backgroundColor: t.bgCard,
              border: `1px solid ${t.border}`,
            }}
          >
            {/* Bars area */}
            <div className="flex items-end gap-0.5 w-full justify-center" style={{ height: BAR_MAX_H }}>
              {row.vals.map((val, si) => {
                const barH = val > 0 ? Math.max((val / maxVal) * (BAR_MAX_H - 16), 4) : 0;
                return (
                  <div key={si} className="flex flex-col items-center justify-end" style={{ width: 8, flexShrink: 0, height: BAR_MAX_H }}>
                    {val > 0 && si !== 1 && (
                      <span style={{ fontSize: 8, fontWeight: 800, color: slotColors[si], lineHeight: 1, marginBottom: 2 }}>
                        {val}
                      </span>
                    )}
                    <div style={{
                      width: 8,
                      height: barH,
                      backgroundColor: slotColors[si],
                      borderRadius: '2px 2px 0 0',
                    }} />
                  </div>
                );
              })}
            </div>
            {/* Date */}
            <div style={{ fontSize: 11, fontWeight: 800, color: t.txt, marginTop: 6, lineHeight: 1.3 }}>
              {row.dateStr}
            </div>
            {/* Day name */}
            <div style={{ fontSize: 10, color: t.txt3, lineHeight: 1.2 }}>
              {row.dayName}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

function WindBadge({ speed, deg, arrowColor }: { speed: number; deg: number; arrowColor: string }) {
  const bg = windColor(speed);
  return (
    <div className="flex items-center justify-center gap-1.5" dir="ltr">
      <div style={{ backgroundColor: bg, borderRadius: 5, minWidth: 38, padding: '3px 6px', textAlign: 'center' }}>
        <div style={{ fontSize: 16, fontWeight: 900, color: '#fff', lineHeight: 1.1 }}>{speed}</div>
        <div style={{ fontSize: 9, color: 'rgba(255,255,255,0.85)', fontWeight: 700 }}>kts</div>
      </div>
      <Arrow deg={(deg + 180) % 360} size={20} color={arrowColor} />
    </div>
  );
}

function RatingBar({ rating, t }: { rating: number; t: Theme }) {
  const r = Math.max(1, Math.min(10, rating));
  const color = ratingColor(r);
  return (
    <div className="flex items-center gap-2">
      <div className="flex gap-px h-2 flex-1">
        {Array.from({ length: 10 }, (_, i) => (
          <div key={i} className="flex-1 rounded-sm" style={{ backgroundColor: i < r ? color : t.ratingEmpty }} />
        ))}
      </div>
      <span className="text-xs font-black whitespace-nowrap" style={{ color }}>
        {r}/10 {RATING_LABEL[r]}
      </span>
    </div>
  );
}

function StatCard({ label, value, sub, deg, arrowColor, onClick, extra, t }: {
  label: string; value: React.ReactNode; sub?: React.ReactNode;
  deg?: number; arrowColor?: string; onClick?: () => void; extra?: React.ReactNode; t: Theme;
}) {
  return (
    <div
      style={{ backgroundColor: t.statBg, cursor: onClick ? 'pointer' : undefined, borderRadius: 6, border: `1px solid ${t.border}` }}
      className="p-3 flex flex-col gap-1"
      onClick={onClick}
    >
      <div className="text-sm font-bold uppercase tracking-widest" style={{ color: t.txt3 }}>{label}</div>
      <div className="text-2xl font-black flex items-center gap-1" style={{ color: t.txt }}>
        {deg !== undefined && <Arrow deg={deg} size={28} color={arrowColor ?? t.gold} />}
        {value}
      </div>
      {sub && <div className="text-sm font-medium" style={{ color: t.txt2 }}>{sub}</div>}
      {extra}
    </div>
  );
}

// ── Main component ─────────────────────────────────────────────────────────────
export function SurfForecast({ data, beachName, selectedBeachId, hasExplicitCity }: {
  data: SurfForecastData; beachName?: string; selectedBeachId?: string; hasExplicitCity?: boolean
}) {
  const { current, todayHours, days } = data;

  const [isDark, setIsDark] = useState(true);
  const [fetchTime, setFetchTime] = useState<string>('');
  // Overrides keyed by Firestore date → hour key ("06", "12", …) → entry.
  // Covers today through today+6 so future-day overrides update the UI live.
  const [liveOverridesByDate, setLiveOverridesByDate] = useState<Record<string, Record<string, HourlyEntry>>>({});
  // Fractional Israel hour — re-evaluated every minute so interpolation drifts naturally.
  const [nowFrac, setNowFrac] = useState(() => currentIsraelFractionalHour());
  useEffect(() => {
    const id = setInterval(() => setNowFrac(currentIsraelFractionalHour()), 60_000);
    return () => clearInterval(id);
  }, []);

  // Subscribe to today + the next 6 dates so every day in the 6-day forecast
  // receives live override updates without a hard refresh.
  // Night slots (00, 03) for day N are stored in day N+1's Firestore doc, so
  // we subscribe to today through today+6 (7 listeners) and look up by date+key.
  useEffect(() => {
    if (!selectedBeachId) return;
    const base = todayIsrael();
    const dates = Array.from({ length: 7 }, (_, i) => {
      const d = new Date(base + 'T12:00:00Z');
      d.setUTCDate(d.getUTCDate() + i);
      return d.toISOString().split('T')[0];
    });

    console.log(`[ILG] Subscribing to ${dates.length} dates for beach=${selectedBeachId}`);
    const unsubs = dates.map(date =>
      subscribeToHourlyTimeSeries(selectedBeachId, date, snap => {
        const overrideCount = Object.values(snap).filter(e => e.overrideHs != null).length;
        console.log(`[ILG] Overrides updated: beach=${selectedBeachId} date=${date} entries=${Object.keys(snap).length} activeOverrides=${overrideCount}`);
        setLiveOverridesByDate(prev => ({ ...prev, [date]: snap }));
      }),
    );

    return () => {
      console.log(`[ILG] Unsubscribed from beach=${selectedBeachId}`);
      unsubs.forEach(f => f());
    };
  }, [selectedBeachId]);

  useEffect(() => {
    if (localStorage.getItem('ilg_forecast_theme') === 'light') setIsDark(false);
  }, []);

  useEffect(() => {
    localStorage.setItem('ilg_forecast_theme', isDark ? 'dark' : 'light');
  }, [isDark]);

  useEffect(() => {
    const d = new Date(data.fetchedAt);
    setFetchTime(`${String(d.getHours()).padStart(2,'0')}:${String(d.getMinutes()).padStart(2,'0')}`);
  }, [data.fetchedAt]);

  const t = isDark ? DARK_THEME : LIGHT_THEME;

  const _todayDate    = todayIsrael();
  const _tomorrowDate = tomorrowIsrael();
  const _todayOv      = liveOverridesByDate[_todayDate]    ?? {};
  const _tomorrowOv   = liveOverridesByDate[_tomorrowDate] ?? {};

  const effectiveHours = todayHours.map(h => {
    const key     = h.time.split(':')[0].padStart(2, '0');
    const isNight = key === '00' || key === '03';
    const ov      = isNight ? _tomorrowOv[key] : _todayOv[key];

    // Treat overrideWind === 0 as "not set" — Firestore merge:true can store 0
    // sentinels that are indistinguishable from an intentional calm-wind override.
    // Wind direction 0° (North) is legitimate, so only speed uses the > 0 guard.
    const hasHsOv   = ov?.overrideHs   != null;
    const hasTOv    = ov?.overrideT    != null;
    const hasWindOv = ov?.overrideWind != null && ov.overrideWind > 0;
    const hasDirOv  = ov?.overrideWindDir != null;

    const newHs      = hasHsOv   ? ov!.overrideHs!      : h.waveHeight;
    const newT       = hasTOv    ? ov!.overrideT!        : h.wavePeriod;
    const newWind    = hasWindOv ? ov!.overrideWind!     : h.windSpeed;
    const newWindDeg = hasDirOv  ? ov!.overrideWindDir!  : h.windDeg;

    // Always return rounded values regardless of override path
    const hsR   = +newHs.toFixed(1);
    const tR    = +newT.toFixed(1);
    const wR    = Math.round(newWind);

    if (!hasHsOv && !hasTOv && !hasWindOv && !hasDirOv) {
      // No active overrides — return base data with display rounding applied
      return { ...h, waveHeight: hsR, wavePeriod: tR, windSpeed: wR };
    }

    return {
      ...h,
      waveHeight: hsR,
      wavePeriod: tR,
      windSpeed:  wR,
      windDeg:    newWindDeg,
      waveEnergy: +(0.4903 * hsR * hsR * tR).toFixed(1),
      rating: calcRating(hsR, tR, wR, h.swellDeg, newWindDeg),
    };
  });

  // ── Future days with live Firestore overrides applied ─────────────────────────
  // For each day, look up overrides by date. Primary hours (06-21) come from
  // day.date; night hours (00, 03) are stored in the next calendar date's doc.
  const effectiveDays = days.map(day => {
    const nd = new Date(day.date + 'T12:00:00Z');
    nd.setUTCDate(nd.getUTCDate() + 1);
    const nextDate = nd.toISOString().split('T')[0];
    const dayOv    = liveOverridesByDate[day.date] ?? {};
    const nextOv   = liveOverridesByDate[nextDate]  ?? {};

    const hours = day.hours.map(h => {
      const key     = h.time.split(':')[0].padStart(2, '0');
      const isNight = key === '00' || key === '03';
      const ov      = isNight ? nextOv[key] : dayOv[key];
      if (!ov) return h;

      const hasHsOv   = ov.overrideHs   != null;
      const hasTOv    = ov.overrideT    != null;
      const hasWindOv = ov.overrideWind != null && ov.overrideWind > 0;
      const hasDirOv  = ov.overrideWindDir != null;
      if (!hasHsOv && !hasTOv && !hasWindOv && !hasDirOv) return h;

      const newHs  = hasHsOv   ? ov.overrideHs!     : h.waveHeight;
      const newT   = hasTOv    ? ov.overrideT!       : h.wavePeriod;
      const newW   = hasWindOv ? ov.overrideWind!    : h.windSpeed;
      const newDir = hasDirOv  ? ov.overrideWindDir! : h.windDeg;
      const hsR = +newHs.toFixed(1);
      const tR  = +newT.toFixed(1);
      const wR  = Math.round(newW);
      return {
        ...h,
        waveHeight: hsR,
        wavePeriod: tR,
        windSpeed:  wR,
        windDeg:    newDir,
        windDir:    degreesToCompassLocal(newDir),
        waveEnergy: +(0.4903 * hsR * hsR * tR).toFixed(1),
        rating:     calcRating(hsR, tR, wR, h.swellDeg, newDir),
      };
    });

    // Recalculate day-level summary from primary (daytime) hours only
    const primaryHs = hours
      .filter(h => ['06', '09', '12', '15', '18', '21'].includes(h.time.split(':')[0]))
      .map(h => h.waveHeight);
    return {
      ...day,
      hours,
      waveMin: primaryHs.length ? +Math.min(...primaryHs).toFixed(1) : day.waveMin,
      waveMax: primaryHs.length ? +Math.max(...primaryHs).toFixed(1) : day.waveMax,
    };
  });

  // ── Live current conditions — linear interpolation between surrounding slots ─
  // Slots are ordered [06,09,12,15,18,21,00,03]; night slots normalised to 24/27.
  const nowNorm = nowFrac < 6 ? nowFrac + 24 : nowFrac;
  const sortedSlots = [...effectiveHours].sort(
    (a, b) => normalizeSlotHour(a.time) - normalizeSlotHour(b.time),
  );
  const prevSlot = [...sortedSlots].reverse().find(h => normalizeSlotHour(h.time) <= nowNorm)
                   ?? sortedSlots[0];
  const nextSlot = sortedSlots.find(h => normalizeSlotHour(h.time) > nowNorm)
                   ?? sortedSlots[sortedSlots.length - 1];

  let activeCurrent: typeof current;
  if (!prevSlot) {
    activeCurrent = current;
  } else if (!nextSlot || prevSlot.time === nextSlot.time) {
    // At or beyond the window boundary — use the single nearest slot
    console.log(`[ILG] Current Conditions using slot: ${prevSlot.time} (boundary, nowNorm=${nowNorm.toFixed(2)})`);
    activeCurrent = {
      ...current,
      waveHeight:     prevSlot.waveHeight,
      wavePeriod:     prevSlot.wavePeriod,
      windSpeed:      prevSlot.windSpeed,
      windDeg:        prevSlot.windDeg,
      windDirection:  prevSlot.windDir,
      swellDeg:       prevSlot.swellDeg,
      swellDirection: prevSlot.swellDir,
    };
  } else {
    // Interpolate between prevSlot and nextSlot
    const prevNorm = normalizeSlotHour(prevSlot.time);
    const nextNorm = normalizeSlotHour(nextSlot.time);
    const t = (nowNorm - prevNorm) / (nextNorm - prevNorm); // 0..1

    const waveHeight = +(prevSlot.waveHeight + (nextSlot.waveHeight - prevSlot.waveHeight) * t).toFixed(1);
    const wavePeriod = +(prevSlot.wavePeriod + (nextSlot.wavePeriod - prevSlot.wavePeriod) * t).toFixed(1);
    const windSpeed  = Math.round(prevSlot.windSpeed  + (nextSlot.windSpeed  - prevSlot.windSpeed)  * t);
    const windDeg    = interpolateAngle(prevSlot.windDeg,  nextSlot.windDeg,  t);
    const swellDeg   = interpolateAngle(prevSlot.swellDeg, nextSlot.swellDeg, t);

    console.log(
      `[ILG] Current Conditions using slot: ${prevSlot.time}→${nextSlot.time} ` +
      `t=${(t * 100).toFixed(0)}% nowNorm=${nowNorm.toFixed(2)} ` +
      `Hs=${waveHeight}m T=${wavePeriod}s wind=${windSpeed}kts`,
    );

    activeCurrent = {
      ...current,
      waveHeight,
      wavePeriod,
      windSpeed,
      windDeg,
      windDirection:  degreesToCompassLocal(windDeg),
      swellDeg,
      swellDirection: degreesToCompassLocal(swellDeg),
    };
  }

  const [expandedSwell, setExpandedSwell] = useState<string | null>(null);
  const [expandedDay, setExpandedDay] = useState<string | null>(null);
  const [expandedDaySwell, setExpandedDaySwell] = useState<string | null>(null);
  const [showDayTides, setShowDayTides] = useState<string | null>(null);
  const [showCurrentSwell, setShowCurrentSwell] = useState(false);
  const [showWaveEnergy, setShowWaveEnergy] = useState(false);
  const [expandedWaveEnergy, setExpandedWaveEnergy] = useState<string | null>(null);
  const [showTides, setShowTides] = useState(false);
  const [showWaveChart, setShowWaveChart] = useState(false);

  return (
    <div className="font-sans" dir="rtl" style={{ backgroundColor: t.bg, minHeight: '100vh', paddingBottom: '80px' }}>

      {/* ── HEADER ── */}
      <div style={{ backgroundColor: t.headBg, borderBottom: `1px solid ${t.border}` }} className="px-4 py-3">
        <div className="flex items-center gap-3 mt-2 mb-3">
          <h1 className="text-2xl font-black" style={{ color: t.txt }}>תחזית ים</h1>
        </div>
        <div className="flex items-center gap-2 mb-2">
          <BeachSelector selected={selectedBeachId ?? 'tlv'} hasExplicitCity={hasExplicitCity ?? false} isDark={isDark} />
          <div className="hidden md:block text-xs" style={{ color: t.txt2 }}>
            עודכן {fetchTime}
            {!data.buoyLive && <span title="המצוף לא זמין — תחזית מבוססת מודל בלבד"> · ⚠️ מודל בלבד</span>}
            {' · '}{data.sources.join(' · ')}
          </div>
        </div>
        <div className="flex items-center gap-2 mb-3">
          <button
            onClick={() => setIsDark(v => !v)}
            className="text-sm font-bold px-5 py-2.5 rounded shrink-0 transition-colors"
            style={{ backgroundColor: t.btnBg, color: t.btnTxt, border: `1px solid ${t.btnBorder}` }}
            title={isDark ? 'מצב בהיר' : 'מצב כהה'}
          >
            {isDark ? 'בהיר' : 'כהה'}
          </button>
          <Link
            href="/dashboard/maps"
            className="text-sm font-bold px-5 py-2.5 rounded shrink-0"
            style={{ backgroundColor: t.btnBg, color: t.btnTxt, border: `1px solid ${t.btnBorder}` }}
          >
            מפות
          </Link>
          <button
            onClick={() => setShowWaveChart(v => !v)}
            className="text-sm font-bold px-5 py-2.5 rounded shrink-0 transition-colors"
            style={{
              backgroundColor: showWaveChart ? '#1e40af' : t.btnBg,
              color: showWaveChart ? '#fff' : t.btnTxt,
              border: `1px solid ${t.btnBorder}`,
            }}
          >
            גרף
          </button>
        </div>

        {/* ── WAVE CHART PANEL ── */}
        {showWaveChart && (
          <WaveBarChart days={effectiveDays} t={t} isDark={isDark} />
        )}
        <div className="md:hidden text-xs mt-1.5" style={{ color: t.txt2 }}>עודכן {fetchTime}</div>
      </div>

      {/* ── DESKTOP: two columns ── */}
      <div className="lg:grid lg:grid-cols-5 gap-0" style={{ borderBottom: `1px solid ${t.border}` }}>

        {/* LEFT: current conditions + tides */}
        <div className="lg:col-span-2 flex flex-col" style={{ borderLeft: `1px solid ${t.border}` }}>
          <div style={{ backgroundColor: t.headBg, borderBottom: `1px solid ${t.border}` }} className="p-4 space-y-3">
            <div className="text-sm font-bold uppercase tracking-widest" style={{ color: t.sectionTxt }}>תנאים עכשיו</div>
            <div className="grid grid-cols-2 gap-2">
              <StatCard t={t} label="גובה גלים" value={`${activeCurrent.waveHeight}m`}
                sub={<>כיוון <span style={{ color: t.gold }}>{activeCurrent.waveDirection}</span></>}
                onClick={() => setShowWaveEnergy(v => !v)}
                extra={showWaveEnergy && <div className="mt-1 text-sm font-bold" style={{ color: t.gold }}>אנרגיה: {(0.49 * activeCurrent.waveHeight * activeCurrent.waveHeight * activeCurrent.wavePeriod).toFixed(1)} kJ</div>}
              />
              <StatCard t={t} label="סוואל" value={`${activeCurrent.wavePeriod}s`}
                sub={<>{activeCurrent.waterTemp}<span style={{ color: '#ef4444' }}>°C</span> מים · <span style={{ color: '#a855f7', fontWeight: 900 }}>UV</span> {activeCurrent.uvIndex}</>}
                deg={(activeCurrent.swellDeg + 180) % 360} onClick={() => setShowCurrentSwell(v => !v)}
                extra={showCurrentSwell && <div className="mt-1 text-sm font-bold" style={{ color: t.gold }}>{activeCurrent.swellDirection} · {activeCurrent.swellDeg}°</div>}
              />
              <StatCard t={t} label="רוח" value={`${activeCurrent.windSpeed} kts`}
                sub={<span style={{ color: t.gold }}>{activeCurrent.windDirection}</span>}
                deg={(activeCurrent.windDeg + 180) % 360}
              />
              <div style={{ backgroundColor: t.statBg, borderRadius: 6, border: `1px solid ${t.border}` }} className="p-3 flex flex-col justify-between h-full gap-1.5">
                {[
                  { label: 'אור ראשון', value: data.firstLight },
                  { label: 'זריחה',     value: data.sunrise    },
                  { label: 'שקיעה',     value: data.sunset     },
                  { label: 'אור אחרון', value: data.lastLight  },
                ].map(({ label, value }) => (
                  <div key={label} className="flex items-center justify-between">
                    <span style={{ fontSize: 11, fontWeight: 700, color: t.txt3 }}>{label}</span>
                    <span style={{ fontSize: 14, fontWeight: 900, color: t.txt }}>{value || '--:--'}</span>
                  </div>
                ))}
              </div>
            </div>
          </div>

          <div style={{ backgroundColor: t.headBg }} className="p-4 mt-auto">
            <div className="hidden lg:block">
              <div className="text-sm font-bold uppercase tracking-widest mb-2" style={{ color: t.sectionTxt }}>גאות ושפל – היום</div>
              <TideChart tides={data.tides} exactExtremes={data.tideExtremes} isDark={isDark} />
            </div>
            <div className="lg:hidden">
              <button onClick={() => setShowTides(v => !v)} className="w-full py-2 text-sm font-bold rounded"
                style={{ backgroundColor: t.btnBg, color: t.btnTxt, border: `1px solid ${t.btnBorder}` }}>
                {showTides ? 'הסתר נתוני גאות ושפל' : 'נתוני גאות ושפל'}
              </button>
              {showTides && (
                <div className="pt-3">
                  <TideChart tides={data.tides} exactExtremes={data.tideExtremes} isDark={isDark} />
                </div>
              )}
            </div>
          </div>
        </div>

        {/* RIGHT: hourly */}
        <div className="lg:col-span-3 flex flex-col" style={{ borderLeft: `1px solid ${t.border}` }}>
          {effectiveHours.length > 0 && (
            <div style={{ backgroundColor: t.headBg }} className="p-4 space-y-3 flex-1">
              <div className="text-sm font-bold uppercase tracking-widest" style={{ color: t.sectionTxt }}>תחזית שעתית – היום</div>
              <div className="space-y-1.5">
                <div className="grid grid-cols-4 gap-2 text-center text-xs px-2 py-1" style={{ color: t.sectionTxt }}>
                  <div>שעה</div><div>גלים</div><div>סוול</div><div>רוח</div>
                </div>
                {effectiveHours.map(h => (
                  <div key={h.time} style={{ backgroundColor: t.bgRow, borderRadius: 6, border: `1px solid ${t.border}` }} className="grid grid-cols-4 gap-2 items-center text-center p-3">
                    <div className="text-lg font-black" style={{ color: t.txt }}>{h.time}</div>
                    <div className="text-base font-bold cursor-pointer select-none" style={{ color: t.txt }}
                      onClick={() => setExpandedWaveEnergy(expandedWaveEnergy === h.time ? null : h.time)}>
                      {h.waveHeight}m
                      <div className="flex justify-center mt-0.5"><Stars rating={h.rating} t={t} /></div>
                      {expandedWaveEnergy === h.time && <div className="text-xs font-bold" style={{ color: t.gold }}>{(0.49 * h.waveHeight * h.waveHeight * h.wavePeriod).toFixed(1)} kJ</div>}
                    </div>
                    <div className="text-base font-black cursor-pointer select-none" style={{ color: t.txt }}
                      onClick={() => setExpandedSwell(expandedSwell === h.time ? null : h.time)}>
                      <div className="flex items-center justify-center gap-1">
                        <Arrow deg={(h.swellDeg + 180) % 360} size={22} color={t.blue} />
                        <span className="text-base font-bold">{h.wavePeriod}s</span>
                      </div>
                      {expandedSwell === h.time && <div className="mt-1 text-xs font-normal" style={{ color: t.gold }}>{h.swellDir} · {h.swellDeg}°</div>}
                    </div>
                    <div className="flex justify-center">
                      <WindBadge speed={h.windSpeed} deg={h.windDeg} arrowColor={t.blue} />
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>
      </div>

      {/* ── 6-DAY FORECAST ── */}
      <div style={{ backgroundColor: t.headBg }}>
        <div style={{ maxWidth: 900, margin: '0 auto' }}>
          <div className="px-6 py-3 text-sm font-bold uppercase tracking-widest" style={{ color: t.sectionTxt, borderBottom: `1px solid ${t.border}` }}>
            תחזית ל-6 ימים
          </div>
          {effectiveDays.filter(day => !day.label.startsWith('היום')).map((day) => {
            const slots = ['06:00', '12:00', '18:00'].map(t2 => day.hours.find(h => h.time === t2) ?? null);
            const isExpanded = expandedDay === day.date;
            return (
              <div key={day.date} style={{ borderBottom: `1px solid ${t.border}` }}>
                {/* Day header — clickable */}
                <div
                  className="px-4 pt-3 pb-1 flex items-center justify-between cursor-pointer"
                  onClick={() => setExpandedDay(isExpanded ? null : day.date)}
                >
                  <span className="text-sm font-black" style={{ color: isExpanded ? t.gold : t.txt }}>{day.label}</span>
                  <span style={{ color: t.txt3, fontSize: 11 }}>{isExpanded ? '▲' : '▼'}</span>
                </div>

                {/* Column headers */}
                <div className="grid grid-cols-4 gap-2 text-center px-4 pb-1" style={{ color: t.sectionTxt, fontSize: 10 }}>
                  <div>שעה</div><div>גלים</div><div>סוול</div><div>רוח</div>
                </div>

                {/* Default: 3 key times */}
                {!isExpanded && slots.map((h, i) => {
                  const label = ['06:00', '12:00', '18:00'][i];
                  if (!h) return (
                    <div key={label} className="grid grid-cols-4 gap-2 items-center text-center px-4 py-2" style={{ borderTop: `1px solid ${t.border}`, color: t.txt3, fontSize: 12 }}>
                      <div className="font-black">{label}</div>
                      <div style={{ gridColumn: '2 / span 3' }}>—</div>
                    </div>
                  );
                  return (
                    <div key={label} className="grid grid-cols-4 gap-2 items-center text-center px-4 py-2" style={{ borderTop: `1px solid ${t.border}` }}>
                      <div className="text-sm font-black" style={{ color: t.txt }}>{h.time}</div>
                      <div className="text-sm font-black" style={{ color: t.blue }}>{h.waveHeight}m</div>
                      <div className="flex items-center justify-center gap-1">
                        <Arrow deg={(h.swellDeg + 180) % 360} size={14} color={t.blue} />
                        <span className="text-sm font-bold" style={{ color: t.txt }}>{h.wavePeriod}s</span>
                      </div>
                      <div className="flex justify-center">
                        <WindBadge speed={h.windSpeed} deg={h.windDeg} arrowColor={t.blue} />
                      </div>
                    </div>
                  );
                })}

                {/* Expanded: all hours */}
                {isExpanded && day.hours.length > 0 && (
                  <div style={{ backgroundColor: t.bg, borderTop: `1px solid ${t.border}` }} className="px-4 pb-4 pt-1 space-y-2">
                    {day.hours.map(h => {
                      const key = `${day.date}-${h.time}`;
                      return (
                        <div key={h.time} style={{ backgroundColor: t.bgRow, borderRadius: 6, border: `1px solid ${t.border}` }} className="grid grid-cols-4 gap-2 items-center text-center p-3">
                          <div className="text-base font-black" style={{ color: t.txt }}>{h.time}</div>
                          <div className="text-base font-bold cursor-pointer select-none" style={{ color: t.txt }}
                            onClick={() => setExpandedWaveEnergy(expandedWaveEnergy === key ? null : key)}>
                            {h.waveHeight}m
                            <div className="flex justify-center mt-0.5"><Stars rating={h.rating} t={t} /></div>
                            {expandedWaveEnergy === key && <div className="text-xs font-bold" style={{ color: t.gold }}>{(0.49 * h.waveHeight * h.waveHeight * h.wavePeriod).toFixed(1)} kJ</div>}
                          </div>
                          <div className="text-base font-black cursor-pointer select-none" style={{ color: t.txt }}
                            onClick={() => setExpandedDaySwell(expandedDaySwell === key ? null : key)}>
                            <div className="flex items-center justify-center gap-1">
                              <Arrow deg={(h.swellDeg + 180) % 360} size={20} color={t.blue} />
                              <span className="text-base font-bold">{h.wavePeriod}s</span>
                            </div>
                            {expandedDaySwell === key && <div className="mt-1 text-xs font-normal" style={{ color: t.gold }}>{h.swellDir} · {h.swellDeg}°</div>}
                          </div>
                          <div className="flex justify-center">
                            <WindBadge speed={h.windSpeed} deg={h.windDeg} arrowColor={t.blue} />
                          </div>
                        </div>
                      );
                    })}
                    <button onClick={() => setShowDayTides(showDayTides === day.date ? null : day.date)}
                      className="w-full mt-1 py-2 text-xs font-bold rounded"
                      style={{ backgroundColor: t.btnBg, color: t.btnTxt, border: `1px solid ${t.btnBorder}` }}>
                      {showDayTides === day.date ? 'הסתר נתוני גאות ושפל' : 'נתוני גאות ושפל'}
                    </button>
                    {showDayTides === day.date && (
                      <div className="pt-2">
                        <div className="text-xs font-bold mb-2" style={{ color: t.blue }}>גאות ושפל – {day.label}</div>
                        <TideChart tides={day.tides} exactExtremes={day.tideExtremes} isDark={isDark} />
                      </div>
                    )}
                  </div>
                )}
                <div className="pb-1" />
              </div>
            );
          })}
        </div>
      </div>

    </div>
  );
}
