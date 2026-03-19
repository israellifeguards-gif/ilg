'use client';

import React, { useState, useEffect } from 'react';
import Link from 'next/link';
import type { SurfForecastData } from '@/lib/api/surf';
import { BeachSelector } from './BeachSelector';
import { TideChart } from './TideChart';

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
        <div className="flex items-center gap-3 mt-6 mb-3">
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
          <WaveBarChart days={data.days} t={t} isDark={isDark} />
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
              <StatCard t={t} label="גובה גלים" value={`${current.waveHeight}m`}
                sub={<>כיוון <span style={{ color: t.gold }}>{current.waveDirection}</span></>}
                onClick={() => setShowWaveEnergy(v => !v)}
                extra={showWaveEnergy && <div className="mt-1 text-sm font-bold" style={{ color: t.gold }}>אנרגיה: {(0.49 * current.waveHeight * current.waveHeight * current.wavePeriod).toFixed(1)} kJ</div>}
              />
              <StatCard t={t} label="סוואל" value={`${current.wavePeriod}s`}
                sub={<>{current.waterTemp}<span style={{ color: '#ef4444' }}>°C</span> מים · <span style={{ color: '#a855f7', fontWeight: 900 }}>UV</span> {current.uvIndex}</>}
                deg={(current.swellDeg + 180) % 360} onClick={() => setShowCurrentSwell(v => !v)}
                extra={showCurrentSwell && <div className="mt-1 text-sm font-bold" style={{ color: t.gold }}>{current.swellDirection} · {current.swellDeg}°</div>}
              />
              <StatCard t={t} label="רוח" value={`${current.windSpeed} kts`}
                sub={<span style={{ color: t.gold }}>{current.windDirection}</span>}
                deg={(current.windDeg + 180) % 360}
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
          {todayHours.length > 0 && (
            <div style={{ backgroundColor: t.headBg }} className="p-4 space-y-3 flex-1">
              <div className="text-sm font-bold uppercase tracking-widest" style={{ color: t.sectionTxt }}>תחזית שעתית – היום</div>
              <div className="space-y-1.5">
                <div className="grid grid-cols-4 gap-2 text-center text-xs px-2 py-1" style={{ color: t.sectionTxt }}>
                  <div>שעה</div><div>גלים</div><div>סוול</div><div>רוח</div>
                </div>
                {todayHours.map(h => (
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
          {days.filter(day => !day.label.startsWith('היום')).map((day) => {
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
