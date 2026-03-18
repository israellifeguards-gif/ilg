'use client';

import useSWR from 'swr';
import { useState, useCallback } from 'react';
import { BEACHES } from '@/lib/beaches';
import {
  fetchBeachCalibration,
  setBeachCalibration,
  CAL_DEFAULTS,
} from '@/lib/api/beachCalibration';
import type { BeachCalibration } from '@/lib/api/beachCalibration';
import { calcWaveEnergy } from '@/lib/api/surf';
import {
  fetchHourlyTimeSeries,
  setHourOverride,
  applyOverrideToDay,
} from '@/lib/api/beachTimeSeries';
import type { HourlyEntry } from '@/lib/api/beachTimeSeries';
import {
  fetchTideEventOverrides,
  setTideEventOverrides,
} from '@/lib/api/beachHourlyCal';
import type { TideEventOverride } from '@/lib/api/beachHourlyCal';
import type { TideEvent } from '@/app/api/admin/hourly-forecast/route';

// ── 8 canonical surf time-points ─────────────────────────────────────────────
//
//   PRIMARY (today's Firestore date):  06, 09, 12, 15, 18, 21
//   NIGHT   (tomorrow's Firestore date): 00, 03
//
// Display order: 06 09 12 15 18 21 | 00 03
// ─────────────────────────────────────────────────────────────────────────────

const PRIMARY_HOURS = [6, 9, 12, 15, 18, 21] as const;
const NIGHT_HOURS   = [0, 3]               as const;
const DISPLAY_HOURS = [...PRIMARY_HOURS, ...NIGHT_HOURS] as const;

// ── Types ─────────────────────────────────────────────────────────────────────

type CalMap = Record<string, BeachCalibration>;

interface TideStatus {
  currentHeight: number;
  rising:        boolean;
  hoursToNext:   number;
  nextType:      string;
  nextTime:      string;
  sparkPoints:   { hour: number; height: number }[];
  nowHour:       number;
}

interface BeachHourlyState {
  // 8 entries max — keyed "HH"; "00"/"03" come from tomorrow's Firestore date
  entries:       Record<string, HourlyEntry>;
  tideOverrides: TideEventOverride[];
  tideModel:     TideEvent[];
  loading:       boolean;
  syncing:       boolean;
}

// ── Date helpers ──────────────────────────────────────────────────────────────

function getIsraelDate(): string {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Jerusalem', year: 'numeric', month: '2-digit', day: '2-digit',
  }).formatToParts(new Date());
  const g = (t: string) => parts.find(p => p.type === t)?.value ?? '0';
  return `${g('year')}-${g('month')}-${g('day')}`;
}

function nextCalendarDay(dateStr: string): string {
  const d = new Date(dateStr + 'T12:00:00Z');
  d.setUTCDate(d.getUTCDate() + 1);
  return d.toISOString().split('T')[0];
}

function firestoreDateForHour(hour: number, today: string, tomorrow: string): string {
  return (NIGHT_HOURS as readonly number[]).includes(hour) ? tomorrow : today;
}

function getIsraelHour(): number {
  const h = parseInt(
    new Intl.DateTimeFormat('en-US', { timeZone: 'Asia/Jerusalem', hour: '2-digit', hour12: false })
      .formatToParts(new Date())
      .find(p => p.type === 'hour')?.value ?? '12',
  ) % 24;
  // Snap to nearest DISPLAY_HOURS slot
  return (DISPLAY_HOURS as readonly number[]).reduce((prev, curr) =>
    Math.abs(curr - h) < Math.abs(prev - h) ? curr : prev,
  );
}

// ── Calibration helpers ───────────────────────────────────────────────────────

const REF_HS = 1.0;
const REF_T  = 8.0;

function toAbs(cal: BeachCalibration) {
  return {
    height: +(REF_HS * cal.height_factor).toFixed(2),
    period: +(REF_T  * cal.period_factor).toFixed(1),
    wind:   cal.wind_bias_knots,
    angle:  cal.swell_angle_offset,
  };
}

function toCal(h: number, t: number, wind: number, angle: number): BeachCalibration {
  return {
    height_factor:      Math.max(0.4, Math.min(2.5, h / REF_HS)),
    period_factor:      Math.max(0.5, Math.min(2.0, t / REF_T)),
    wind_bias_knots:    Math.max(-8,  Math.min(8,   wind)),
    swell_angle_offset: Math.max(-45, Math.min(45,  angle)),
  };
}

function energyBar(kwm: number) {
  const pct   = Math.min(100, (kwm / 200) * 100);
  const color = kwm < 50 ? '#3b82f6' : kwm < 150 ? '#22c55e' : '#f97316';
  const label = kwm < 50 ? 'שקט' : kwm < 150 ? 'בינוני' : 'גבוה';
  return { pct, color, label };
}

function hourKey(h: number): string {
  return String(h).padStart(2, '0');
}

// ── Data fetchers ─────────────────────────────────────────────────────────────

async function fetchAllCalibrations(): Promise<CalMap> {
  const results = await Promise.all(
    BEACHES.map(b => fetchBeachCalibration(b.id).then(c => ({ id: b.id, c }))),
  );
  const map: CalMap = {};
  results.forEach(({ id, c }) => { map[id] = c; });
  return map;
}

const fetchTideStatus = (): Promise<TideStatus> =>
  fetch('/api/admin/tide-status').then(r => r.json());

// ── Merge today+tomorrow Firestore entries into 8-slot map ───────────────────

function mergeEntries(
  todayData:    Record<string, HourlyEntry>,
  tomorrowData: Record<string, HourlyEntry>,
): Record<string, HourlyEntry> {
  const result: Record<string, HourlyEntry> = {};
  for (const h of PRIMARY_HOURS) {
    const k = hourKey(h);
    if (todayData[k]) result[k] = todayData[k];
  }
  for (const h of NIGHT_HOURS) {
    const k = hourKey(h);
    if (tomorrowData[k]) result[k] = tomorrowData[k];
  }
  return result;
}

// ── Tide Sparkline ────────────────────────────────────────────────────────────

function TideSparkline({ points, nowHour }: { points: TideStatus['sparkPoints']; nowHour: number }) {
  if (!points.length) return null;
  const W = 300, H = 34;
  const hs  = points.map(p => p.height);
  const mn  = Math.min(...hs), mx = Math.max(...hs), rng = mx - mn || 0.1;
  const px  = (h: number) => (h / 24) * W;
  const py  = (v: number) => H - 3 - ((v - mn) / rng) * (H - 6);
  const d   = points.map((p, i) => `${i ? 'L' : 'M'}${px(p.hour).toFixed(1)},${py(p.height).toFixed(1)}`).join('');
  const fill = `${d}L${px(24)},${H}L${px(0)},${H}Z`;
  const cx  = px(Math.min(nowHour, 24));
  const nowIdx = Math.min(Math.round(nowHour * 2), hs.length - 1);
  return (
    <svg viewBox={`0 0 ${W} ${H}`} className="w-full h-[34px]" preserveAspectRatio="none" aria-hidden>
      <defs>
        <linearGradient id="tg2" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%"   stopColor="#60a5fa" stopOpacity="0.25" />
          <stop offset="100%" stopColor="#60a5fa" stopOpacity="0"    />
        </linearGradient>
      </defs>
      <path d={fill} fill="url(#tg2)" />
      <path d={d} fill="none" stroke="#3b82f6" strokeWidth="1.5" strokeLinecap="round" />
      <line x1={cx} y1="0" x2={cx} y2={H} stroke="#ef4444" strokeWidth="1.2" strokeDasharray="3,2" opacity="0.7" />
      <circle cx={cx} cy={py(hs[nowIdx])} r="3" fill="#ef4444" />
    </svg>
  );
}

// ── Hour Picker (8 slots) ─────────────────────────────────────────────────────

function HourPicker({
  selected, onChange, hasOverride, loading, showNightDivider = false,
}: {
  selected:         number;
  onChange:         (h: number) => void;
  hasOverride:      (h: number) => boolean;
  loading:          boolean;
  showNightDivider?: boolean;
}) {
  return (
    <div className="flex gap-1 overflow-x-auto no-scrollbar" dir="ltr">
      {DISPLAY_HOURS.map((h, idx) => {
        const active   = h === selected;
        const override = hasOverride(h);
        const isNight  = (NIGHT_HOURS as readonly number[]).includes(h);
        // Visual divider before 00:00
        const showDiv  = showNightDivider && idx > 0 && isNight &&
          !(NIGHT_HOURS as readonly number[]).includes(DISPLAY_HOURS[idx - 1]);
        return (
          <div key={h} className="flex items-center gap-1">
            {showDiv && <div className="w-px h-6 bg-gray-200 mx-0.5 shrink-0" />}
            <button
              onClick={() => onChange(h)}
              className={`shrink-0 text-[11px] font-bold px-2.5 py-1 rounded-lg transition relative
                ${active
                  ? 'bg-black text-white'
                  : isNight
                    ? 'bg-indigo-50 text-indigo-500 hover:bg-indigo-100'
                    : 'bg-gray-100 text-gray-500 hover:bg-gray-200'
                }`}
              title={isNight ? `מחר (${String(h).padStart(2,'0')}:00)` : undefined}
            >
              {String(h).padStart(2, '0')}
              {override && (
                <span className="absolute -top-1 -left-1 w-2 h-2 rounded-full bg-amber-400" />
              )}
            </button>
          </div>
        );
      })}
      {loading && <span className="text-[10px] text-gray-400 self-center mr-1">טוען…</span>}
    </div>
  );
}

// ── Field ─────────────────────────────────────────────────────────────────────

function Field({
  label, unit, hint, value, step, min, max, onChange,
}: {
  label: string; unit: string; hint?: string;
  value: string; step: string; min: string; max: string;
  onChange: (v: string) => void;
}) {
  return (
    <div className="space-y-1">
      <div className="flex items-baseline justify-between">
        <label className="text-sm font-semibold">{label}</label>
        {hint && <span className="text-[10px] text-gray-400">{hint}</span>}
      </div>
      <div className="flex items-center gap-2">
        <input
          type="number" step={step} min={min} max={max}
          value={value}
          onChange={e => onChange(e.target.value)}
          className="flex-1 border border-gray-200 rounded-lg px-3 py-2.5 text-center font-mono text-sm
                     focus:outline-none focus:border-black focus:ring-1 focus:ring-black transition"
        />
        <span className="text-sm text-gray-400 min-w-[3rem] text-right">{unit}</span>
      </div>
    </div>
  );
}

// ── Editable Tide Events Table ────────────────────────────────────────────────

function EditableTideTable({
  modelEvents, savedOverrides, onSave,
}: {
  modelEvents:    TideEvent[];
  savedOverrides: TideEventOverride[];
  onSave:         (events: TideEventOverride[]) => Promise<void>;
}) {
  const baseEvents: TideEventOverride[] = savedOverrides.length > 0
    ? savedOverrides
    : modelEvents.map(e => ({ time: e.time, type: e.type }));

  const [rows,   setRows]   = useState<TideEventOverride[]>(baseEvents);
  const [saving, setSaving] = useState(false);

  function update(i: number, patch: Partial<TideEventOverride>) {
    setRows(prev => prev.map((r, j) => j === i ? { ...r, ...patch } : r));
  }
  function remove(i: number) {
    setRows(prev => prev.filter((_, j) => j !== i));
  }
  function add() {
    const lastTime = rows[rows.length - 1]?.time ?? '12:00';
    const [hh, mm] = lastTime.split(':').map(Number);
    const next     = `${String((hh + 6) % 24).padStart(2, '0')}:${String(mm).padStart(2, '0')}`;
    const lastType = rows[rows.length - 1]?.type ?? 'High';
    setRows(prev => [...prev, { time: next, type: lastType === 'High' ? 'Low' : 'High' }]);
  }
  async function save() {
    setSaving(true);
    try { await onSave(rows); }
    finally { setSaving(false); }
  }

  return (
    <div className="space-y-2">
      {rows.map((r, i) => (
        <div key={i} className="flex items-center gap-2">
          <input
            type="time" value={r.time}
            onChange={e => update(i, { time: e.target.value })}
            className="flex-1 border border-gray-200 rounded-lg px-2 py-2 text-sm font-mono
                       focus:outline-none focus:border-black transition"
            dir="ltr"
          />
          <button
            onClick={() => update(i, { type: r.type === 'High' ? 'Low' : 'High' })}
            className={`shrink-0 px-3 py-2 rounded-lg text-xs font-bold border transition ${
              r.type === 'High'
                ? 'bg-blue-50 text-blue-600 border-blue-200 hover:bg-blue-100'
                : 'bg-sky-50 text-sky-500 border-sky-200 hover:bg-sky-100'
            }`}
          >
            {r.type === 'High' ? '▲ גאות' : '▼ שפל'}
          </button>
          <button
            onClick={() => remove(i)}
            className="w-7 h-7 flex items-center justify-center text-gray-300
                       hover:text-red-400 rounded-md hover:bg-red-50 transition text-base"
          >×</button>
        </div>
      ))}
      <div className="flex gap-2 pt-1">
        <button
          onClick={add}
          className="flex-1 py-2 border border-dashed border-gray-300 rounded-lg text-xs
                     text-gray-400 hover:border-gray-500 hover:text-gray-600 transition"
        >+ הוסף אירוע</button>
        <button
          onClick={save} disabled={saving}
          className="px-4 py-2 bg-gray-900 text-white rounded-lg text-xs font-bold
                     disabled:opacity-40 hover:bg-black transition"
        >{saving ? '…' : 'שמור'}</button>
      </div>
      {savedOverrides.length > 0 && (
        <button
          onClick={() => setRows(modelEvents.map(e => ({ time: e.time, type: e.type })))}
          className="text-[10px] text-gray-400 hover:text-red-500 transition"
        >← חזור לחיזוי המודל</button>
      )}
    </div>
  );
}

// ── Advanced Drawer ───────────────────────────────────────────────────────────

interface DrawerProps {
  beach:         { id: string; name: string };
  baseCal:       BeachCalibration;
  selectedHour:  number;
  entries:       Record<string, HourlyEntry>;
  tideOverrides: TideEventOverride[];
  tideModel:     TideEvent[];
  today:         string;
  tomorrow:      string;
  syncing:       boolean;
  onClose:       () => void;
  onSync:        (id: string) => void;
  onSaveGlobal:  (id: string, next: BeachCalibration) => void;
  onSaveHourly:  (id: string, hour: number, ov: { overrideHs: number | null; overrideT: number | null; overrideWind: number | null }) => void;
  onApplyAll:    (id: string, ov: { overrideHs: number | null; overrideT: number | null; overrideWind: number | null }) => void;
  onSaveTideOverrides: (id: string, events: TideEventOverride[]) => void;
  onPreview:     (id: string, next: BeachCalibration) => void;
  onHourChange:  (id: string, h: number) => void;
}

function AdvancedDrawer({
  beach, baseCal, selectedHour, entries, tideOverrides, tideModel, today, tomorrow, syncing,
  onClose, onSync, onSaveGlobal, onSaveHourly, onApplyAll, onSaveTideOverrides, onPreview, onHourChange,
}: DrawerProps) {
  const entry      = entries[hourKey(selectedHour)];
  const absDefault = toAbs(baseCal);
  const isNightSlot = (NIGHT_HOURS as readonly number[]).includes(selectedHour);

  const initH = entry?.overrideHs   ?? entry?.calHs   ?? absDefault.height;
  const initT = entry?.overrideT    ?? entry?.calT    ?? absDefault.period;
  const initW = entry?.overrideWind ?? entry?.calWind ?? absDefault.wind;

  const [height, setHeight] = useState(String(initH));
  const [period, setPeriod] = useState(String(initT));
  const [wind,   setWind]   = useState(String(initW));
  const [angle,  setAngle]  = useState(String(absDefault.angle));
  const [saving, setSaving] = useState(false);
  const [mode,   setMode]   = useState<'hour' | 'global'>('hour');

  const h = parseFloat(height) || initH;
  const t = parseFloat(period) || initT;
  const w = parseFloat(wind)   || 0;
  const a = parseFloat(angle)  || 0;

  const liveEnergy = calcWaveEnergy(h, t);
  const { pct: ePct, color: eColor } = energyBar(liveEnergy);

  function firePreview(nh = h, nt = t, nw = w, na = a) {
    onPreview(beach.id, toCal(nh, nt, nw, na));
  }

  const dateForHour = (hour: number) => firestoreDateForHour(hour, today, tomorrow);

  async function handleSaveHour() {
    setSaving(true);
    try {
      const ov = { overrideHs: h, overrideT: t, overrideWind: w };
      await setHourOverride(beach.id, dateForHour(selectedHour), selectedHour, ov);
      onSaveHourly(beach.id, selectedHour, ov);
      onClose();
    } finally { setSaving(false); }
  }

  async function handleApplyAll() {
    setSaving(true);
    try {
      const ov = { overrideHs: h, overrideT: t, overrideWind: w };
      // Primary hours → today's date; night hours → tomorrow's date
      await Promise.all([
        applyOverrideToDay(beach.id, today,    [...PRIMARY_HOURS], ov),
        applyOverrideToDay(beach.id, tomorrow, [...NIGHT_HOURS],   ov),
      ]);
      onApplyAll(beach.id, ov);
      onClose();
    } finally { setSaving(false); }
  }

  async function handleSaveGlobal() {
    setSaving(true);
    try {
      const patch = toCal(h, t, w, a);
      await setBeachCalibration(beach.id, patch, 'admin_panel');
      onSaveGlobal(beach.id, patch);
      onClose();
    } finally { setSaving(false); }
  }

  async function handleReset() {
    setSaving(true);
    try {
      if (mode === 'hour') {
        const ov = { overrideHs: null, overrideT: null, overrideWind: null };
        await setHourOverride(beach.id, dateForHour(selectedHour), selectedHour, ov);
        onSaveHourly(beach.id, selectedHour, ov);
      } else {
        await setBeachCalibration(beach.id, { ...CAL_DEFAULTS }, 'admin_panel');
        onSaveGlobal(beach.id, { ...CAL_DEFAULTS });
      }
      onClose();
    } finally { setSaving(false); }
  }

  const hasEntries = Object.keys(entries).length > 0;

  return (
    <>
      <div className="fixed inset-0 bg-black/50 z-40 backdrop-blur-sm" onClick={onClose} />
      <div
        className="fixed inset-x-0 bottom-0 z-50 bg-white rounded-t-3xl shadow-2xl max-h-[92vh] overflow-y-auto"
        dir="rtl"
      >
        <div className="sticky top-0 bg-white pt-3 pb-2 flex justify-center border-b border-gray-100 z-10">
          <div className="w-10 h-1 bg-gray-200 rounded-full" />
        </div>

        <div className="px-5 pb-10 space-y-5 pt-4">
          {/* Header */}
          <div className="flex items-center justify-between">
            <div>
              <h3 className="font-black text-xl">{beach.name}</h3>
              <p className="text-xs text-gray-400 mt-0.5">
                {hasEntries
                  ? `${Object.keys(entries).length}/8 נקודות · ${today}`
                  : 'אין נתונים — לחץ סנכרן'}
              </p>
            </div>
            <div className="flex items-center gap-2">
              <button
                onClick={() => onSync(beach.id)}
                disabled={syncing}
                className="text-xs px-3 py-1.5 border border-gray-200 rounded-lg font-medium
                           hover:border-black hover:bg-gray-50 disabled:opacity-40 transition flex items-center gap-1"
              >
                {syncing
                  ? <span className="inline-block w-3 h-3 border-2 border-gray-400 border-t-black rounded-full animate-spin" />
                  : '↻'}
                סנכרן מ-API
              </button>
              <button
                onClick={onClose}
                className="w-8 h-8 flex items-center justify-center rounded-full bg-gray-100
                           hover:bg-gray-200 text-gray-500 text-lg transition"
              >×</button>
            </div>
          </div>

          {/* Mode toggle */}
          <div className="flex gap-1 bg-gray-100 p-1 rounded-xl">
            {(['hour', 'global'] as const).map(m => (
              <button
                key={m}
                onClick={() => setMode(m)}
                className={`flex-1 py-2 rounded-lg text-sm font-semibold transition ${
                  mode === m ? 'bg-white text-black shadow-sm' : 'text-gray-500'
                }`}
              >
                {m === 'hour' ? `עריכת שעה ${String(selectedHour).padStart(2,'0')}:00` : 'תיקון גלובלי'}
              </button>
            ))}
          </div>

          {/* 8-point hour picker (hour mode) */}
          {mode === 'hour' && (
            <div className="bg-gray-50 rounded-2xl p-3 space-y-2">
              <div className="flex items-center justify-between">
                <p className="text-[10px] font-bold text-gray-400 uppercase tracking-widest">שעה לעריכה</p>
                {isNightSlot && (
                  <span className="text-[10px] bg-indigo-50 text-indigo-500 px-2 py-0.5 rounded-full font-medium">
                    מחר ({tomorrow})
                  </span>
                )}
              </div>
              <HourPicker
                selected={selectedHour}
                onChange={h => onHourChange(beach.id, h)}
                hasOverride={h => !!entries[hourKey(h)]?.overrideHs}
                loading={false}
                showNightDivider
              />

              {/* Comparison: גולמי | כיול | שלי */}
              {entry ? (
                <div className="mt-2 grid grid-cols-4 gap-1 text-[10px] text-center">
                  <div />
                  <div className="text-gray-400 font-medium">גולמי</div>
                  <div className="text-gray-400 font-medium">כיול</div>
                  <div className="text-gray-400 font-medium">שלי</div>

                  <div className="text-gray-500 font-semibold text-right">גל (מ׳)</div>
                  <div className="text-gray-400 tabular-nums">{entry.rawHs}</div>
                  <div className="text-gray-500 tabular-nums">{entry.calHs}</div>
                  <div className={`font-bold tabular-nums ${entry.overrideHs != null ? 'text-amber-600' : 'text-gray-400'}`}>
                    {(entry.overrideHs ?? entry.calHs).toFixed(2)}
                  </div>

                  <div className="text-gray-500 font-semibold text-right">T (ש׳)</div>
                  <div className="text-gray-400 tabular-nums">{entry.rawT}</div>
                  <div className="text-gray-500 tabular-nums">{entry.calT}</div>
                  <div className={`font-bold tabular-nums ${entry.overrideT != null ? 'text-amber-600' : 'text-gray-400'}`}>
                    {(entry.overrideT ?? entry.calT).toFixed(1)}
                  </div>

                  <div className="text-gray-500 font-semibold text-right">רוח (קש׳)</div>
                  <div className="text-gray-400 tabular-nums">{entry.rawWind}</div>
                  <div className="text-gray-500 tabular-nums">{entry.calWind}</div>
                  <div className={`font-bold tabular-nums ${entry.overrideWind != null ? 'text-amber-600' : 'text-gray-400'}`}>
                    {entry.overrideWind ?? entry.calWind}
                  </div>
                </div>
              ) : (
                <p className="text-[10px] text-gray-400">אין נתוני מודל לשעה זו — לחץ סנכרן</p>
              )}
            </div>
          )}

          {/* Live energy preview */}
          <div className="bg-gray-50 rounded-2xl p-4 space-y-2">
            <div className="flex items-end justify-between">
              <span className="text-xs text-gray-500 font-medium">עוצמת גל (תצוגה מקדימה)</span>
              <span className="font-black text-xl tabular-nums" style={{ color: eColor }}>
                {liveEnergy}
                <span className="text-xs font-normal text-gray-400 mr-1">kW/m</span>
              </span>
            </div>
            <div className="h-3 bg-gray-200 rounded-full overflow-hidden">
              <div className="h-full rounded-full transition-all duration-300"
                   style={{ width: `${ePct}%`, background: eColor }} />
            </div>
            <div className="flex justify-between text-[9px] text-gray-300">
              <span>0</span><span>50</span><span>150</span><span>200 kW/m</span>
            </div>
          </div>

          {/* Wave parameters */}
          <div className="space-y-1">
            <p className="text-[10px] font-bold text-gray-400 uppercase tracking-widest">פרמטרי גל</p>
            <div className="space-y-3 pt-1">
              <Field
                label="גובה גל" unit="מטרים" step="0.1" min="0.1" max="8"
                value={height}
                hint={entry ? `גולמי: ${entry.rawHs} · כיול: ${entry.calHs}` : `פקטור: ×${(h / REF_HS).toFixed(2)}`}
                onChange={v => { setHeight(v); const n = parseFloat(v); if (!isNaN(n)) firePreview(n, t, w, a); }}
              />
              <Field
                label="תקופת גל" unit="שניות" step="0.5" min="2" max="25"
                value={period}
                hint={entry ? `גולמי: ${entry.rawT} · כיול: ${entry.calT}` : `פקטור: ×${(t / REF_T).toFixed(2)}`}
                onChange={v => { setPeriod(v); const n = parseFloat(v); if (!isNaN(n)) firePreview(h, n, w, a); }}
              />
            </div>
          </div>

          {/* Wind */}
          <div className="space-y-1">
            <p className="text-[10px] font-bold text-gray-400 uppercase tracking-widest">רוח וכיוון</p>
            <div className="space-y-3 pt-1">
              <Field
                label="תיקון רוח" unit="קשרים" step="0.5" min="-8" max="8"
                value={wind}
                hint={entry ? `גולמי: ${entry.rawWind} · כיול: ${entry.calWind}` : '+ להוסיף · − להפחית (±8)'}
                onChange={v => { setWind(v); const n = parseFloat(v); if (!isNaN(n)) firePreview(h, t, n, a); }}
              />
              {mode === 'global' && (
                <Field
                  label="כיוון סוול" unit="מעלות" step="1" min="-45" max="45"
                  value={angle}
                  hint="הזזה מכיוון החוף הבסיסי 285° (±45)"
                  onChange={v => { setAngle(v); const n = parseFloat(v); if (!isNaN(n)) firePreview(h, t, w, n); }}
                />
              )}
            </div>
          </div>

          {/* Tide events */}
          <div className="space-y-2">
            <div className="flex items-center justify-between">
              <p className="text-[10px] font-bold text-gray-400 uppercase tracking-widest">אירועי גאות ושפל היום</p>
              {tideOverrides.length > 0 && (
                <span className="text-[10px] bg-amber-50 text-amber-600 px-2 py-0.5 rounded-full font-medium">
                  ערוך ידנית
                </span>
              )}
            </div>
            <div className="bg-gray-50 rounded-2xl px-4 py-3">
              <EditableTideTable
                modelEvents={tideModel}
                savedOverrides={tideOverrides}
                onSave={async events => {
                  await setTideEventOverrides(beach.id, today, events);
                  onSaveTideOverrides(beach.id, events);
                }}
              />
            </div>
          </div>

          {/* Actions */}
          {mode === 'hour' ? (
            <div className="space-y-2 pt-2">
              <button
                onClick={handleSaveHour}
                disabled={saving}
                className="w-full bg-black text-white rounded-xl py-3.5 font-bold text-sm
                           disabled:opacity-40 hover:bg-gray-900 active:scale-[0.98] transition"
              >
                {saving ? '…שומר' : `שמור שעה ${String(selectedHour).padStart(2,'0')}:00${isNightSlot ? ' (מחר)' : ''}`}
              </button>
              <div className="flex gap-2">
                <button
                  onClick={handleApplyAll}
                  disabled={saving}
                  className="flex-1 py-3 border border-gray-200 rounded-xl text-sm font-medium
                             text-gray-600 hover:border-black hover:text-black disabled:opacity-40 transition"
                >
                  החל על כל 8 הנקודות
                </button>
                <button
                  onClick={handleReset}
                  disabled={saving}
                  className="px-4 py-3 border border-gray-200 rounded-xl text-sm text-gray-400
                             hover:border-red-300 hover:text-red-500 disabled:opacity-40 transition"
                >
                  בטל עקיפה
                </button>
              </div>
            </div>
          ) : (
            <div className="flex gap-3 pt-2">
              <button
                onClick={handleSaveGlobal}
                disabled={saving}
                className="flex-1 bg-black text-white rounded-xl py-3.5 font-bold text-sm
                           disabled:opacity-40 hover:bg-gray-900 active:scale-[0.98] transition"
              >
                {saving ? '…שומר' : 'שמור תיקון גלובלי'}
              </button>
              <button
                onClick={handleReset}
                disabled={saving}
                className="px-4 py-3.5 border border-gray-200 rounded-xl text-sm text-gray-500
                           hover:border-red-300 hover:text-red-500 disabled:opacity-40 transition"
              >
                איפוס
              </button>
            </div>
          )}
        </div>
      </div>
    </>
  );
}

// ── Beach Card ────────────────────────────────────────────────────────────────

function BeachCard({
  beach, cal, tide, selectedHour, hourlyState, previewing,
  onOpenDrawer, onHourSelect,
}: {
  beach:        { id: string; name: string };
  cal:          BeachCalibration;
  tide:         TideStatus | null;
  selectedHour: number;
  hourlyState:  BeachHourlyState;
  previewing:   boolean;
  onOpenDrawer: (id: string) => void;
  onHourSelect: (id: string, h: number) => void;
}) {
  const { entries, loading } = hourlyState;
  const entry      = entries[hourKey(selectedHour)];
  const absDefault = toAbs(cal);

  const displayH = entry?.overrideHs   ?? entry?.calHs   ?? absDefault.height;
  const displayT = entry?.overrideT    ?? entry?.calT    ?? absDefault.period;
  const displayW = entry?.overrideWind ?? entry?.calWind ?? absDefault.wind;

  const energy = calcWaveEnergy(displayH, displayT);
  const { pct: ePct, color: eColor, label: eLabel } = energyBar(energy);

  const calibrated  = cal.height_factor !== 1 || cal.period_factor !== 1 ||
                      cal.wind_bias_knots !== 0 || cal.swell_angle_offset !== 0;
  const hasHourlyOv = entry?.overrideHs != null;
  const hasAnyOv    = DISPLAY_HOURS.some(h => entries[hourKey(h)]?.overrideHs != null);

  const statusLabel = hasHourlyOv ? 'עקיפה שעתית' : calibrated ? 'מכוון' : 'ברירת מחדל';
  const statusColor = hasHourlyOv
    ? 'bg-amber-50 text-amber-600'
    : calibrated ? 'bg-blue-50 text-blue-600' : 'bg-gray-100 text-gray-400';

  return (
    <div className="bg-white border border-gray-200 rounded-2xl p-4 space-y-3.5 shadow-sm" dir="rtl">
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0">
          <h3 className="font-black text-base truncate">{beach.name}</h3>
          <span className={`inline-block text-[10px] px-2 py-0.5 rounded-full mt-0.5 font-medium ${statusColor}`}>
            {statusLabel}
          </span>
        </div>
        <button
          onClick={() => onOpenDrawer(beach.id)}
          className="shrink-0 text-xs px-3 py-1.5 border border-gray-200 rounded-lg font-medium
                     hover:border-black hover:bg-gray-50 active:scale-95 transition"
        >
          ניהול מתקדם
        </button>
      </div>

      {/* 8-point hour picker on the card */}
      <HourPicker
        selected={selectedHour}
        onChange={h => onHourSelect(beach.id, h)}
        hasOverride={h => !!entries[hourKey(h)]?.overrideHs}
        loading={loading}
        showNightDivider
      />

      {/* Wave height + energy */}
      <div className="flex items-end justify-between">
        <div>
          <p className="text-[10px] text-gray-400 mb-0.5">גובה גל</p>
          <p className="font-black text-4xl leading-none tabular-nums">
            {displayH.toFixed(1)}
            <span className="text-sm font-normal text-gray-400 mr-1">מ׳</span>
          </p>
          {entry && !previewing && (
            <p className="text-[10px] text-gray-400 mt-0.5 tabular-nums">
              {hasHourlyOv
                ? <span>מודל: <span className="line-through">{entry.rawHs}</span> → <span className="text-amber-500 font-semibold">{displayH.toFixed(2)}מ׳</span></span>
                : <span>גולמי: {entry.rawHs}מ׳ → כיול: {entry.calHs}מ׳</span>
              }
            </p>
          )}
        </div>
        <div className="text-left">
          <p className="text-[10px] text-gray-400 mb-0.5 text-right">עוצמה</p>
          <p className="font-bold text-lg tabular-nums leading-none" style={{ color: eColor }}>
            {energy}
            <span className="text-xs font-normal text-gray-400 mr-1">kW/m</span>
          </p>
          <p className="text-[10px] text-right mt-0.5" style={{ color: eColor }}>{eLabel}</p>
        </div>
      </div>

      {entry && (
        <p className="text-[10px] text-gray-400 -mt-1 tabular-nums">
          רוח: {displayW} קשרים
          {hasHourlyOv && entry.overrideWind != null && ` (מודל: ${entry.rawWind})`}
        </p>
      )}

      <div className="space-y-1">
        <div className="h-3 bg-gray-100 rounded-full overflow-hidden">
          <div className="h-full rounded-full transition-all duration-500"
               style={{ width: `${ePct}%`, background: eColor }} />
        </div>
        <div className="flex justify-between text-[9px] text-gray-300 select-none px-0.5">
          <span>0</span><span>50</span><span>150</span><span>200 kW/m</span>
        </div>
      </div>

      {tide ? (
        <div className="space-y-1">
          <div className="flex items-center justify-between text-xs">
            <span className={`font-semibold flex items-center gap-1 ${tide.rising ? 'text-blue-500' : 'text-sky-400'}`}>
              <span>{tide.rising ? '↑' : '↓'}</span>
              <span>{tide.rising ? 'עולה' : 'יורד'}</span>
            </span>
            <span className="text-gray-400 tabular-nums">
              {tide.nextType} בעוד {tide.hoursToNext.toFixed(1)}ש׳ · {tide.nextTime}
            </span>
          </div>
          <TideSparkline points={tide.sparkPoints} nowHour={tide.nowHour} />
        </div>
      ) : (
        <div className="h-10 bg-gray-50 rounded-xl animate-pulse" />
      )}

      {hasAnyOv && !hasHourlyOv && (
        <p className="text-[10px] text-amber-500">● יש עקיפות שעתיות בחוף זה</p>
      )}
      {!loading && Object.keys(entries).length === 0 && (
        <p className="text-[10px] text-gray-400">אין נתוני מודל — פתח ניהול מתקדם לסנכרון</p>
      )}
    </div>
  );
}

// ── Panel ─────────────────────────────────────────────────────────────────────

export function BeachCalibrationPanel() {
  const { data: calMap, mutate } = useSWR<CalMap>('beach_calibrations', fetchAllCalibrations, {
    revalidateOnFocus:     false,
    revalidateOnReconnect: false,
    dedupingInterval:      60_000,
  });

  const { data: tide } = useSWR<TideStatus>('tide-status', fetchTideStatus, {
    revalidateOnFocus: false,
    dedupingInterval:  300_000,
    refreshInterval:   600_000,
  });

  const [previews,      setPreviews]      = useState<Record<string, BeachCalibration>>({});
  const [openId,        setOpenId]        = useState<string | null>(null);

  const today    = getIsraelDate();
  const tomorrow = nextCalendarDay(today);

  const defaultHour = getIsraelHour();
  const [selectedHours, setSelectedHours] = useState<Record<string, number>>(
    () => Object.fromEntries(BEACHES.map(b => [b.id, defaultHour])),
  );

  const emptyState = (): BeachHourlyState => ({
    entries: {}, tideOverrides: [], tideModel: [], loading: false, syncing: false,
  });

  const [hourlyStates, setHourlyStates] = useState<Record<string, BeachHourlyState>>(
    () => Object.fromEntries(BEACHES.map(b => [b.id, emptyState()])),
  );

  // ── Load 8-point data for a beach (today primary + tomorrow night) ─────────
  const loadHourlyForBeach = useCallback(async (beachId: string) => {
    setHourlyStates(prev => {
      if (prev[beachId]?.loading) return prev;
      return { ...prev, [beachId]: { ...prev[beachId], loading: true } };
    });
    try {
      const [todayData, tomorrowData, tideOverrides, forecastRes] = await Promise.all([
        fetchHourlyTimeSeries(beachId, today),
        fetchHourlyTimeSeries(beachId, tomorrow),
        fetchTideEventOverrides(beachId, today),
        fetch(`/api/admin/hourly-forecast?beach=${beachId}`)
          .then(r => r.json())
          .catch(() => ({ tideExtremes: [] })),
      ]);
      setHourlyStates(prev => ({
        ...prev,
        [beachId]: {
          entries:       mergeEntries(todayData, tomorrowData),
          tideOverrides,
          tideModel:     forecastRes.tideExtremes ?? [],
          loading:       false,
          syncing:       false,
        },
      }));
    } catch {
      setHourlyStates(prev => ({
        ...prev, [beachId]: { ...prev[beachId], loading: false },
      }));
    }
  }, [today, tomorrow]);

  // ── Sync from Open-Meteo → Firestore (both dates) ─────────────────────────
  async function handleSync(beachId: string) {
    setHourlyStates(prev => ({
      ...prev, [beachId]: { ...prev[beachId], syncing: true },
    }));
    try {
      await Promise.all([
        fetch(`/api/admin/sync-hourly?beach=${beachId}&date=${today}`,    { method: 'POST' }),
        fetch(`/api/admin/sync-hourly?beach=${beachId}&date=${tomorrow}`, { method: 'POST' }),
      ]);
      const [todayData, tomorrowData] = await Promise.all([
        fetchHourlyTimeSeries(beachId, today),
        fetchHourlyTimeSeries(beachId, tomorrow),
      ]);
      setHourlyStates(prev => ({
        ...prev,
        [beachId]: {
          ...prev[beachId],
          entries: mergeEntries(todayData, tomorrowData),
          syncing: false,
        },
      }));
    } catch {
      setHourlyStates(prev => ({
        ...prev, [beachId]: { ...prev[beachId], syncing: false },
      }));
    }
  }

  function handleHourSelect(beachId: string, hour: number) {
    setSelectedHours(prev => ({ ...prev, [beachId]: hour }));
    loadHourlyForBeach(beachId);
  }

  function handlePreview(id: string, next: BeachCalibration) {
    setPreviews(p => ({ ...p, [id]: next }));
  }

  function handleSaveGlobal(id: string, next: BeachCalibration) {
    mutate(prev => ({ ...prev, [id]: next }), { revalidate: false });
    setPreviews(p => { const n = { ...p }; delete n[id]; return n; });
  }

  function handleSaveHourly(
    beachId: string,
    hour: number,
    ov: { overrideHs: number | null; overrideT: number | null; overrideWind: number | null },
  ) {
    const key = hourKey(hour);
    setHourlyStates(prev => {
      const bs = prev[beachId];
      if (!bs || !bs.entries[key]) return prev;
      return {
        ...prev,
        [beachId]: {
          ...bs,
          entries: {
            ...bs.entries,
            [key]: { ...bs.entries[key], ...ov, updatedAt: new Date().toISOString() },
          },
        },
      };
    });
  }

  function handleApplyAll(
    beachId: string,
    ov: { overrideHs: number | null; overrideT: number | null; overrideWind: number | null },
  ) {
    const updatedAt = new Date().toISOString();
    setHourlyStates(prev => {
      const bs = prev[beachId];
      if (!bs) return prev;
      const entries = { ...bs.entries };
      for (const key of Object.keys(entries)) {
        entries[key] = { ...entries[key], ...ov, updatedAt };
      }
      return { ...prev, [beachId]: { ...bs, entries } };
    });
  }

  function handleSaveTideOverrides(beachId: string, events: TideEventOverride[]) {
    setHourlyStates(prev => {
      const bs = prev[beachId];
      if (!bs) return prev;
      return { ...prev, [beachId]: { ...bs, tideOverrides: events } };
    });
  }

  function handleClose() {
    const id = openId;
    setOpenId(null);
    if (id) setPreviews(p => { const n = { ...p }; delete n[id]; return n; });
  }

  const openBeach = openId ? BEACHES.find(b => b.id === openId) ?? null : null;
  const openCal   = openId ? (calMap?.[openId] ?? { ...CAL_DEFAULTS }) : null;

  if (!calMap) {
    return (
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
        {BEACHES.map(b => <div key={b.id} className="h-64 bg-gray-50 rounded-2xl animate-pulse" />)}
      </div>
    );
  }

  return (
    <>
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
        {BEACHES.map(beach => {
          const cal          = previews[beach.id] ?? calMap[beach.id] ?? { ...CAL_DEFAULTS };
          const selectedHour = selectedHours[beach.id] ?? defaultHour;
          const hs           = hourlyStates[beach.id] ?? emptyState();
          return (
            <BeachCard
              key={beach.id}
              beach={beach}
              cal={cal}
              tide={tide ?? null}
              selectedHour={selectedHour}
              hourlyState={hs}
              previewing={!!previews[beach.id]}
              onOpenDrawer={id => { loadHourlyForBeach(id); setOpenId(id); }}
              onHourSelect={handleHourSelect}
            />
          );
        })}
      </div>

      {openBeach && openCal && (
        <AdvancedDrawer
          beach={openBeach}
          baseCal={openCal}
          selectedHour={selectedHours[openBeach.id] ?? defaultHour}
          entries={hourlyStates[openBeach.id]?.entries ?? {}}
          tideOverrides={hourlyStates[openBeach.id]?.tideOverrides ?? []}
          tideModel={hourlyStates[openBeach.id]?.tideModel ?? []}
          today={today}
          tomorrow={tomorrow}
          syncing={hourlyStates[openBeach.id]?.syncing ?? false}
          onClose={handleClose}
          onSync={handleSync}
          onSaveGlobal={handleSaveGlobal}
          onSaveHourly={handleSaveHourly}
          onApplyAll={handleApplyAll}
          onSaveTideOverrides={handleSaveTideOverrides}
          onPreview={handlePreview}
          onHourChange={handleHourSelect}
        />
      )}
    </>
  );
}
