'use client';

import useSWR from 'swr';
import { useState, useCallback, useEffect, useRef } from 'react';
import { BEACHES } from '@/lib/beaches';
import {
  fetchBeachCalibration,
  setBeachCalibration,
  setBeachBias,
  setBeachProxyConfig,
  CAL_DEFAULTS,
} from '@/lib/api/beachCalibration';
import type { BeachCalibration } from '@/lib/api/beachCalibration';
import { calcWaveEnergy } from '@/lib/api/surf';
import {
  fetchHourlyTimeSeries,
  setHourOverride,
  applyOverrideToDay,
  batchHourOverrides,
  subscribeToHourlyTimeSeries,
  deleteNullWindOverrides,
  propagateMasterOverride,
  MASTER_BEACH_ID,
  BEACH_PROXY_CONFIG,
} from '@/lib/api/beachTimeSeries';
import type { HourlyEntry, HourOverridePatch } from '@/lib/api/beachTimeSeries';
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

function addDays(dateStr: string, n: number): string {
  const d = new Date(dateStr + 'T12:00:00Z');
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().split('T')[0];
}

function formatDayLabel(dateStr: string, todayStr: string): string {
  const diff = Math.round(
    (new Date(dateStr + 'T12:00:00Z').getTime() - new Date(todayStr + 'T12:00:00Z').getTime()) / 86_400_000,
  );
  const d = new Date(dateStr + 'T12:00:00Z');
  const DAY_HE = ['ראשון', 'שני', 'שלישי', 'רביעי', 'חמישי', 'שישי', 'שבת'];
  const dayName  = `יום ${DAY_HE[d.getUTCDay()]}`;
  const dateLabel = `${String(d.getUTCDate()).padStart(2, '0')}/${String(d.getUTCMonth() + 1).padStart(2, '0')}`;
  if (diff === 0) return `היום (${dayName}) \u2014 ${dateLabel}`;
  if (diff === 1) return `מחר (${dayName}) \u2014 ${dateLabel}`;
  return `${dayName} \u2014 ${dateLabel}`;
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
  selected, onChange, hasOverride, loading,
}: {
  selected:          number;
  onChange:          (h: number) => void;
  hasOverride:       (h: number) => boolean;
  loading:           boolean;
  showNightDivider?: boolean;  // kept for call-site compatibility, unused
}) {
  return (
    <div className="grid grid-cols-4 gap-2" dir="ltr">
      {DISPLAY_HOURS.map(h => {
        const active   = h === selected;
        const override = hasOverride(h);
        const isNight  = (NIGHT_HOURS as readonly number[]).includes(h);
        return (
          <button
            key={h}
            onClick={() => onChange(h)}
            title={isNight ? `מחר (${String(h).padStart(2, '0')}:00)` : undefined}
            className={`relative flex flex-col items-center justify-center rounded-xl min-h-[62px]
                        font-black transition select-none active:scale-95
                        ${active
                          ? 'bg-blue-600 text-white shadow-md border-2 border-blue-700'
                          : isNight
                            ? 'bg-indigo-50 text-indigo-500 hover:bg-indigo-100 border-2 border-transparent'
                            : 'bg-gray-100 text-gray-600 hover:bg-gray-200 border-2 border-transparent'
                        }`}
          >
            <span className="text-[17px] leading-none tabular-nums">
              {String(h).padStart(2, '0')}:00
            </span>
            {isNight && (
              <span className={`text-[9px] font-medium mt-0.5 ${active ? 'opacity-70' : 'opacity-50'}`}>
                מחר
              </span>
            )}
            {override && (
              <span className={`absolute top-1.5 right-1.5 w-2 h-2 rounded-full ${active ? 'bg-amber-300' : 'bg-amber-400'}`} />
            )}
          </button>
        );
      })}
      {loading && (
        <div className="col-span-4 text-center text-[10px] text-gray-400 py-0.5">טוען…</div>
      )}
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
  onSaveHourly:  (id: string, hour: number, ov: { overrideHs: number | null; overrideT: number | null; overrideWind: number | null; overrideWindDir: number | null }) => void;
  onAutoPropagateAll: (id: string, updates: Record<string, { overrideHs: number | null; overrideT: number | null }>) => void;
  onSaveTideOverrides: (id: string, events: TideEventOverride[]) => void;
  onPreview:     (id: string, next: BeachCalibration) => void;
  onHourChange:  (id: string, h: number) => void;
  onToast:       (msg: string) => void;
  // Master proxy — only present when this drawer is for the master beach
  masterProxy?: {
    enabled:    boolean;
    onToggle:   () => void;
    onPropagate: (
      hour:         number,
      hsRatio:      number | null,  // tlvOverride / tlvRaw
      tRatio:       number | null,
      wRatio:       number | null,
      wDirOverride: number | null,
    ) => Promise<{ beach: string; ops: number }[]>;
  };
}

function AdvancedDrawer({
  beach, baseCal, selectedHour, entries, tideOverrides, tideModel, today, tomorrow, syncing,
  onClose, onSync, onSaveHourly, onAutoPropagateAll, onSaveTideOverrides, onPreview, onHourChange, onToast,
  masterProxy,
}: DrawerProps) {
  const entry      = entries[hourKey(selectedHour)];
  const absDefault = toAbs(baseCal);
  const isNightSlot = (NIGHT_HOURS as readonly number[]).includes(selectedHour);

  const initH   = entry?.overrideHs      ?? entry?.calHs      ?? absDefault.height;
  const initT   = entry?.overrideT       ?? entry?.calT       ?? absDefault.period;
  const initW   = entry?.overrideWind    ?? entry?.calWind    ?? absDefault.wind;
  const initDir = entry?.overrideWindDir ?? entry?.rawWindDir ?? 180;

  const [height,  setHeight]  = useState(String(initH));
  const [period,  setPeriod]  = useState(String(initT));
  const [wind,    setWind]    = useState(String(initW));
  const [windDir, setWindDir] = useState(String(initDir));
  const [saving,  setSaving]  = useState(false);

  // Reset field values when the hour changes OR when model data arrives for the first time
  // (entries load async — the boolean flip false→true re-triggers without resetting mid-edit)
  const entryLoaded = !!entries[hourKey(selectedHour)];
  useEffect(() => {
    const e = entries[hourKey(selectedHour)];
    setHeight(String(e?.overrideHs      ?? e?.calHs      ?? absDefault.height));
    setPeriod(String(e?.overrideT       ?? e?.calT       ?? absDefault.period));
    setWind  (String(e?.overrideWind    ?? e?.calWind    ?? absDefault.wind));
    setWindDir(String(e?.overrideWindDir ?? e?.rawWindDir ?? 180));
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedHour, entryLoaded]);

  const h    = parseFloat(height)  || initH;
  const t    = parseFloat(period)  || initT;
  const w    = parseFloat(wind)    || 0;
  const wDir = parseInt(windDir)   || initDir;

  const liveEnergy = calcWaveEnergy(h, t);
  const { pct: ePct, color: eColor } = energyBar(liveEnergy);

  // Escape key closes the drawer
  useEffect(() => {
    const handler = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  function firePreview(nh = h, nt = t, nw = w) {
    onPreview(beach.id, toCal(nh, nt, nw, absDefault.angle));
  }

  const dateForHour = (hour: number) => firestoreDateForHour(hour, today, tomorrow);

  async function handleSaveHour() {
    setSaving(true);
    try {
      // ── 0. Explicit date routing — night slots ALWAYS go to tomorrow ──────────
      const isNight    = (NIGHT_HOURS as readonly number[]).includes(selectedHour);
      const targetDate = isNight ? tomorrow : today;

      // ── 1. Compute biases ────────────────────────────────────────────────────
      // Additive biases — used for intra-TLV hour propagation (same beach, other hours)
      const hsBias = entry?.rawHs != null && entry.rawHs > 0 ? h - entry.rawHs : null;
      const tBias  = entry?.rawT  != null && entry.rawT  > 0 ? t - entry.rawT  : null;
      // Multiplicative ratios — used for master proxy (other beaches, same hour)
      // Formula: targetRawHs × tlvRatio × beachHsMultiplier
      const hsRatio = entry?.rawHs != null && entry.rawHs > 0 && h > 0 ? h / entry.rawHs : null;
      const tRatio  = entry?.rawT  != null && entry.rawT  > 0 && t > 0 ? t / entry.rawT  : null;
      const wRatio  = entry?.rawWind != null && entry.rawWind > 0 && w > 0 ? w / entry.rawWind : null;

      // ── 2. Build the batch patch list ────────────────────────────────────────
      const ov = { overrideHs: h, overrideT: t, overrideWind: w, overrideWindDir: wDir };
      const patches: HourOverridePatch[] = [
        { beachId: beach.id, date: targetDate, hour: selectedHour, override: ov },
      ];
      // Auto-propagate touches ONLY Hs and T — wind fields are NEVER included in
      // the propagation patch so merge:true leaves existing wind overrides intact.
      // Loop order: PRIMARY_HOURS (today) first, then NIGHT_HOURS (tomorrow).
      // Night slots normalised to 24/27 in the log so they sort after 21 visually.
      const propagatedUpdates: Record<string, { overrideHs: number | null; overrideT: number | null }> = {};

      if (hsBias !== null) {
        console.log(`[ILG] propagate: beach=${beach.id} bias=${hsBias.toFixed(3)} tBias=${tBias?.toFixed(3) ?? 'n/a'}`);

        const propagationOrder: number[] = [...PRIMARY_HOURS, ...NIGHT_HOURS];
        for (const hr of propagationOrder) {
          if (hr === selectedHour) continue;

          const key  = hourKey(hr);
          const date = (NIGHT_HOURS as readonly number[]).includes(hr) ? tomorrow : today;
          const e    = entries[key];

          if (!e?.rawHs || e.rawHs <= 0) {
            if (hr === 0 || hr === 3) {
              console.warn(`[ILG] night slot ${String(hr).padStart(2,'0')}:00 has no rawHs in ${date} — sync first`);
            }
            continue;
          }
          if (e.overrideHs != null) continue; // existing manual override takes priority

          const propOv = {
            overrideHs: +Math.min(5.0, Math.max(0.0, e.rawHs + hsBias)).toFixed(2),
            overrideT:  tBias != null && e.rawT ? +(Math.max(0.5, e.rawT + tBias)).toFixed(1) : null,
          };
          propagatedUpdates[key] = propOv;
          patches.push({ beachId: beach.id, date, hour: hr, override: propOv });
        }
      }

      // ── 3. Atomic batch write + bias persist (parallel) ──────────────────────
      console.log(`[ILG] save: beach=${beach.id} hour=${String(selectedHour).padStart(2,'0')} hs=${h} patches=${patches.length}`);
      await Promise.all([
        batchHourOverrides(patches),
        hsRatio !== null ? setBeachBias(beach.id, { hs: hsRatio, t: tRatio, wind: wRatio }) : Promise.resolve(),
      ]);

      // ── 5. Master proxy — propagate additive bias to all other beaches ────────
      let masterPropMsg = '';
      console.log(`[ILG] masterProxy check: enabled=${masterProxy?.enabled ?? 'prop-missing'} beach=${beach.id}`);
      if (masterProxy?.enabled) {
        console.log(`[ILG] master proxy: hsRatio=${hsRatio?.toFixed(3) ?? 'n/a'} tRatio=${tRatio?.toFixed(3) ?? 'n/a'} wRatio=${wRatio?.toFixed(3) ?? 'n/a'} today=${today} tomorrow=${tomorrow}`);
        const report = await masterProxy.onPropagate(
          selectedHour,
          hsRatio,
          tRatio,
          wRatio,
          wDir,
        );
        const totalOps  = report.reduce((s, r) => s + r.ops, 0);
        const nightNote = isNight ? ' (כולל חריץ לילה)' : '';
        masterPropMsg = ` · 🌊 הופץ ל-${report.length} חופים (${totalOps} שעות${nightNote})`;
        console.log(`[ILG] master proxy done: ops=${totalOps}`, report);
      }

      // ── 6. Immediate local state update (both days) ───────────────────────────
      const propagateCount = Object.keys(propagatedUpdates).length;
      onSaveHourly(beach.id, selectedHour, ov);
      if (propagateCount > 0) onAutoPropagateAll(beach.id, propagatedUpdates);

      const propMsg = propagateCount > 0
        ? ` · הוחל ביאס על ${propagateCount} שעות נוספות`
        : '';
      onToast(`✓ נשמר — ${String(selectedHour).padStart(2,'0')}:00 · גל ${h}מ׳ · T ${t}ש׳${propMsg}${masterPropMsg}`);
      onClose();
    } finally { setSaving(false); }
  }


  async function handleReset() {
    setSaving(true);
    try {
      const ov = { overrideHs: null, overrideT: null, overrideWind: null, overrideWindDir: null };
      await setHourOverride(beach.id, dateForHour(selectedHour), selectedHour, ov);
      onSaveHourly(beach.id, selectedHour, ov);
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
        {/* ── Sticky navigation header ─────────────────────────────────────── */}
        <div className="sticky top-0 bg-white z-10 border-b border-gray-100" dir="rtl">
          {/* Drag handle */}
          <div className="pt-3 pb-2 flex justify-center">
            <div className="w-10 h-1 bg-gray-200 rounded-full" />
          </div>
          {/* Beach name + back + sync */}
          <div className="flex items-center gap-2 px-4 pb-3">
            <button
              onClick={onClose}
              className="shrink-0 flex items-center gap-1 text-sm font-bold text-gray-500
                         hover:text-black transition px-2 py-1.5 rounded-lg hover:bg-gray-100"
              title="Esc"
            >
              ← חזרה
            </button>
            <h3 className="flex-1 font-black text-base text-center truncate">{beach.name}</h3>
            <button
              onClick={() => onSync(beach.id)}
              disabled={syncing}
              className="shrink-0 text-xs px-3 py-1.5 border border-gray-200 rounded-lg font-medium
                         hover:border-black hover:bg-gray-50 disabled:opacity-40 transition flex items-center gap-1"
            >
              {syncing
                ? <span className="inline-block w-3 h-3 border-2 border-gray-400 border-t-black rounded-full animate-spin" />
                : '↻'}
              סנכרן
            </button>
            <button
              onClick={onClose}
              className="shrink-0 w-8 h-8 flex items-center justify-center rounded-full bg-gray-100
                         hover:bg-gray-200 text-gray-500 text-lg transition"
              title="סגור (Esc)"
            >×</button>
          </div>
        </div>

        <div className="px-5 pb-10 space-y-5 pt-4">
          {/* Sub-header: date + data points count */}
          <div className="flex items-center gap-2 flex-wrap">
            <span className="text-xs font-bold bg-gray-900 text-white px-2 py-0.5 rounded-md tabular-nums">
              {today}
            </span>
            <span className="text-xs text-gray-400">
              {hasEntries ? `${Object.keys(entries).length}/8 נקודות` : 'אין נתונים — לחץ סנכרן'}
            </span>
          </div>

          {/* Master proxy toggle — visible only for the master beach */}
          {masterProxy && (
            <button
              onClick={masterProxy.onToggle}
              className={`w-full flex items-center justify-between px-3 py-2 rounded-xl border text-sm font-bold transition ${
                masterProxy.enabled
                  ? 'bg-indigo-50 border-indigo-300 text-indigo-700'
                  : 'bg-gray-50 border-gray-200 text-gray-500'
              }`}
            >
              <span className="flex items-center gap-2">
                <span className={`inline-block w-9 h-5 rounded-full relative transition-colors ${masterProxy.enabled ? 'bg-indigo-500' : 'bg-gray-300'}`}>
                  <span className={`absolute top-0.5 w-4 h-4 bg-white rounded-full shadow transition-all ${masterProxy.enabled ? 'left-4' : 'left-0.5'}`} />
                </span>
                עדכן את כל החופים
              </span>
              <span className="text-xs font-normal opacity-60">
                {masterProxy.enabled ? 'פעיל — שמירה תפיץ לכל החופים' : 'כבוי'}
              </span>
            </button>
          )}

          {/* 8-point hour picker */}
          {(
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
                    {(entry.overrideHs ?? entry.calHs ?? 0).toFixed(2)}
                  </div>

                  <div className="text-gray-500 font-semibold text-right">T (ש׳)</div>
                  <div className="text-gray-400 tabular-nums">{entry.rawT}</div>
                  <div className="text-gray-500 tabular-nums">{entry.calT}</div>
                  <div className={`font-bold tabular-nums ${entry.overrideT != null ? 'text-amber-600' : 'text-gray-400'}`}>
                    {(entry.overrideT ?? entry.calT ?? 0).toFixed(1)}
                  </div>

                  <div className="text-gray-500 font-semibold text-right">רוח (קש׳)</div>
                  <div className="text-gray-400 tabular-nums">{entry.rawWind}</div>
                  <div className="text-gray-500 tabular-nums">{entry.calWind}</div>
                  <div className={`font-bold tabular-nums ${entry.overrideWind != null ? 'text-amber-600' : 'text-gray-400'}`}>
                    {entry.overrideWind ?? entry.calWind}
                  </div>

                  <div className="text-gray-500 font-semibold text-right">כיוון (°)</div>
                  <div className="text-gray-400 tabular-nums">{entry.rawWindDir}</div>
                  <div className="text-gray-500 tabular-nums">—</div>
                  <div className={`font-bold tabular-nums ${entry.overrideWindDir != null ? 'text-blue-600' : 'text-gray-400'}`}>
                    {entry.overrideWindDir ?? entry.rawWindDir}
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
                <span className="text-xs font-normal text-gray-400 mr-1">kJ</span>
              </span>
            </div>
            <div className="h-3 bg-gray-200 rounded-full overflow-hidden">
              <div className="h-full rounded-full transition-all duration-300"
                   style={{ width: `${ePct}%`, background: eColor }} />
            </div>
            <div className="flex justify-between text-[9px] text-gray-300">
              <span>0</span><span>50</span><span>150</span><span>200 kJ</span>
            </div>
          </div>

          {/* ── Editing context banner ──────────────────────────────────────── */}
          <div className="bg-blue-50 border border-blue-100 rounded-xl px-4 py-2.5 flex items-center gap-2" dir="rtl">
            <span className="text-blue-400 text-base shrink-0">✎</span>
            <div className="min-w-0 text-xs text-blue-700 font-semibold leading-snug">
              <span className="font-black">{beach.name}</span>
              <span className="mx-1.5 text-blue-300">|</span>
              <span>{isNightSlot ? tomorrow : today}</span>
              <span className="mx-1.5 text-blue-300">|</span>
              <span className="tabular-nums">{String(selectedHour).padStart(2, '0')}:00</span>
              {isNightSlot && (
                <span className="mr-1.5 text-[10px] font-medium text-indigo-400">(לילה → מחר)</span>
              )}
              {!entry && (
                <span className="block text-[10px] text-amber-500 font-medium mt-0.5">
                  אין נתוני מודל — ערכי ברירת מחדל מוצגים
                </span>
              )}
              {entry && entry.overrideHs == null && (
                <span className="block text-[10px] text-gray-400 font-normal mt-0.5">
                  ממודל: {entry.rawHs}מ׳ · {entry.rawT}ש׳ · {entry.rawWind}קש׳
                </span>
              )}
              {entry && entry.overrideHs != null && (
                <span className="block text-[10px] text-amber-600 font-medium mt-0.5">
                  ✦ עקיפה ידנית פעילה
                </span>
              )}
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
                onChange={v => { setHeight(v); const n = parseFloat(v); if (!isNaN(n)) firePreview(n, t, w); }}
              />
              <Field
                label="תקופת גל" unit="שניות" step="0.5" min="2" max="25"
                value={period}
                hint={entry ? `גולמי: ${entry.rawT} · כיול: ${entry.calT}` : `פקטור: ×${(t / REF_T).toFixed(2)}`}
                onChange={v => { setPeriod(v); const n = parseFloat(v); if (!isNaN(n)) firePreview(h, n, w); }}
              />
            </div>
          </div>

          {/* Wind */}
          <div className="space-y-1">
            <div className="flex items-center gap-1.5">
              <p className="text-[10px] font-bold text-gray-400 uppercase tracking-widest">רוח וכיוון</p>
              {(entry?.overrideWind != null || entry?.overrideWindDir != null) && (
                <span className="w-2 h-2 rounded-full bg-blue-500 shrink-0" title="ערך ידני פעיל" />
              )}
            </div>
            <div className="space-y-3 pt-1">
              <Field
                label="מהירות רוח" unit="קשרים" step="1" min="0" max="60"
                value={wind}
                hint={entry ? `גולמי: ${entry.rawWind} קש׳ · כיול: ${entry.calWind} קש׳` : '0–60 קשרים'}
                onChange={v => { setWind(v); const n = parseFloat(v); if (!isNaN(n)) firePreview(h, t, n); }}
              />
              <Field
                label="כיוון רוח" unit="°" step="5" min="0" max="360"
                value={windDir}
                hint={entry ? `גולמי: ${entry.rawWindDir}° · ${entry.overrideWindDir != null ? '✦ ידני' : 'ממודל'}` : '0–360°'}
                onChange={v => setWindDir(v)}
              />
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
          <div className="space-y-2 pt-2">
            {masterProxy?.enabled && (
              <p className="text-[11px] text-indigo-600 font-medium text-center">
                שומר עבור {isNightSlot ? tomorrow : today} · מפיץ ל-{Object.keys(BEACH_PROXY_CONFIG).filter(b => b !== MASTER_BEACH_ID).length} חופים
              </p>
            )}
            <button
              onClick={handleSaveHour}
              disabled={saving}
              className="w-full bg-black text-white rounded-xl py-3.5 font-bold text-sm
                         disabled:opacity-40 hover:bg-gray-900 active:scale-[0.98] transition"
            >
              {saving ? '…שומר' : `שמור שעה ${String(selectedHour).padStart(2,'0')}:00${isNightSlot ? ' (מחר)' : ''}`}
            </button>
            <button
              onClick={handleReset}
              disabled={saving}
              className="w-full py-3 border border-gray-200 rounded-xl text-sm text-gray-400
                         hover:border-red-300 hover:text-red-500 disabled:opacity-40 transition"
            >
              בטל עקיפה לשעה זו
            </button>
          </div>
        </div>
      </div>
    </>
  );
}

// ── Beach Calibration Modal ───────────────────────────────────────────────────

function CalibrationModal({
  beach, cal, tlvHs, beachHs, onSave, onClose,
}: {
  beach:   { id: string; name: string };
  cal:     import('@/lib/api/beachCalibration').BeachCalibration;
  tlvHs:   number;
  beachHs: number;
  onSave:  (cfg: { hsMultiplier: number; windMultiplier: number; windDirOffset: number }) => Promise<void>;
  onClose: () => void;
}) {
  const hardcoded = BEACH_PROXY_CONFIG[beach.id] ?? { hsMultiplier: 1.0, windMultiplier: 1.0, windDirOffset: 0 };
  const [hs,      setHs]      = useState(String(cal.proxy_hs_multiplier   ?? hardcoded.hsMultiplier));
  const [wind,    setWind]    = useState(String(cal.proxy_wind_multiplier ?? hardcoded.windMultiplier));
  const [dir,     setDir]     = useState(String(cal.proxy_wind_dir_offset ?? hardcoded.windDirOffset));
  const [saving,  setSaving]  = useState(false);

  const isCustomDNA = cal.proxy_hs_multiplier != null;
  const suggestedRatio = tlvHs > 0 ? +(beachHs / tlvHs).toFixed(3) : null;

  async function handleSave() {
    setSaving(true);
    try {
      await onSave({
        hsMultiplier:   parseFloat(hs)   || 1.0,
        windMultiplier: parseFloat(wind) || 1.0,
        windDirOffset:  parseFloat(dir)  || 0,
      });
      onClose();
    } finally { setSaving(false); }
  }

  return (
    <>
      <div className="fixed inset-0 bg-black/60 z-50 backdrop-blur-sm" onClick={onClose} />
      <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
        <div className="bg-white rounded-2xl shadow-2xl w-full max-w-sm p-6 space-y-4" dir="rtl">
          {/* Header */}
          <div className="flex items-center justify-between">
            <div>
              <h3 className="font-black text-lg">{beach.name}</h3>
              <p className="text-xs text-gray-400 mt-0.5">DNA — מקדמי הפצה ייחודיים</p>
            </div>
            {isCustomDNA && (
              <span className="text-[10px] bg-purple-100 text-purple-600 px-2 py-0.5 rounded-full font-bold">
                ✦ DNA מותאם
              </span>
            )}
          </div>

          {/* Multiplier inputs */}
          <div className="space-y-3">
            {[
              { label: 'מכפיל גובה גלים',           val: hs,   set: setHs,   step: '0.01', hint: `ברירת מחדל: ${hardcoded.hsMultiplier}`,   info: null },
              { label: 'מכפיל עוצמת רוח',            val: wind, set: setWind, step: '0.01', hint: `ברירת מחדל: ${hardcoded.windMultiplier}`, info: null },
              { label: 'תיקון כיוון רוח (מעלות)',     val: dir,  set: setDir,  step: '1',    hint: `ברירת מחדל: ${hardcoded.windDirOffset}°`, info: 'הוספה או החסרה של מעלות כדי לדייק את זווית הרוח ביחס לקו החוף.' },
            ].map(({ label, val, set, step, hint, info }) => (
              <label key={label} className="block">
                <div className="flex items-center justify-between mb-1">
                  <span className="text-xs font-bold text-gray-600">{label}</span>
                  <span className="text-[10px] text-gray-400">{hint}</span>
                </div>
                <input
                  type="number" step={step} value={val}
                  onChange={e => set(e.target.value)}
                  className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm font-mono
                             focus:outline-none focus:border-black transition"
                  dir="ltr"
                />
                {info && <p className="text-[10px] text-gray-400 mt-1">{info}</p>}
              </label>
            ))}
          </div>

          {/* Match to Current View */}
          {tlvHs > 0 && beachHs > 0 && (
            <div className="border border-dashed border-purple-200 rounded-xl p-3 space-y-2 bg-purple-50">
              <p className="text-xs text-gray-600">
                <span className="font-bold">TLV כעת:</span> {tlvHs.toFixed(2)}מ׳
                <span className="mx-2 text-gray-400">→</span>
                <span className="font-bold">{beach.name}:</span> {beachHs.toFixed(2)}מ׳
                <span className="mx-2 text-gray-400">→</span>
                <span className="font-black text-purple-600">{suggestedRatio}×</span>
              </p>
              <button
                onClick={() => suggestedRatio != null && setHs(String(suggestedRatio))}
                className="w-full py-1.5 text-xs font-bold border border-purple-300 text-purple-600
                           rounded-lg hover:bg-purple-100 transition"
              >
                חשב יחס לפי תל אביב ({suggestedRatio}×)
              </button>
            </div>
          )}

          {/* Actions */}
          <div className="flex gap-2 pt-1">
            <button
              onClick={handleSave} disabled={saving}
              className="flex-1 bg-black text-white py-2.5 rounded-xl font-black text-sm
                         hover:bg-gray-900 disabled:opacity-40 transition"
            >
              {saving ? '…' : 'שמור שינויים'}
            </button>
            <button
              onClick={onClose}
              className="px-4 py-2.5 rounded-xl border border-gray-200 text-sm font-medium
                         hover:bg-gray-50 transition"
            >
              ביטול
            </button>
          </div>
        </div>
      </div>
    </>
  );
}

// ── Beach Card ────────────────────────────────────────────────────────────────

function BeachCard({
  beach, cal, tide, selectedHour, hourlyState, previewing,
  onOpenDrawer, onHourSelect, onCalibrate,
}: {
  beach:        { id: string; name: string };
  cal:          BeachCalibration;
  tide:         TideStatus | null;
  selectedHour: number;
  hourlyState:  BeachHourlyState;
  previewing:   boolean;
  onOpenDrawer: (id: string) => void;
  onHourSelect: (id: string, h: number) => void;
  onCalibrate:  (id: string) => void;
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
  const hasCustomDNA = cal.proxy_hs_multiplier != null;

  const statusLabel = hasHourlyOv ? 'עקיפה שעתית' : calibrated ? 'מכוון' : 'ברירת מחדל';
  const statusColor = hasHourlyOv
    ? 'bg-amber-50 text-amber-600'
    : calibrated ? 'bg-blue-50 text-blue-600' : 'bg-gray-100 text-gray-400';

  return (
    <div className="bg-white border border-gray-200 rounded-2xl p-4 space-y-3.5 shadow-sm" dir="rtl">
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0">
          <h3 className="font-black text-base truncate">{beach.name}</h3>
          <div className="flex flex-wrap items-center gap-1 mt-0.5">
            <span className={`inline-block text-[10px] px-2 py-0.5 rounded-full font-medium ${statusColor}`}>
              {statusLabel}
            </span>
            {cal.current_beach_bias !== undefined && Math.abs(cal.current_beach_bias - 1) >= 0.01 && (
              <span className={`inline-block text-[9px] px-1.5 py-0.5 rounded-full font-medium ${
                cal.current_beach_bias > 1 ? 'bg-orange-50 text-orange-500' : 'bg-emerald-50 text-emerald-600'
              }`}>
                {cal.current_beach_bias > 1
                  ? `מודל מתחת ב-${Math.round((cal.current_beach_bias - 1) * 100)}%`
                  : `מודל מעל ב-${Math.round((1 - cal.current_beach_bias) * 100)}%`}
              </span>
            )}
            {hasCustomDNA && (
              <span className="inline-block text-[9px] px-1.5 py-0.5 rounded-full font-bold bg-purple-100 text-purple-600">
                ✦ DNA מותאם ×{cal.proxy_hs_multiplier?.toFixed(2)}
              </span>
            )}
          </div>
        </div>
        <div className="flex items-center gap-1.5 shrink-0">
          <button
            onClick={() => onCalibrate(beach.id)}
            title="כיול DNA"
            className="text-base px-2 py-1.5 border border-gray-200 rounded-lg hover:border-purple-400
                       hover:bg-purple-50 active:scale-95 transition"
          >
            ⚙️
          </button>
          <button
            onClick={() => onOpenDrawer(beach.id)}
            className="text-xs px-3 py-1.5 border border-gray-200 rounded-lg font-medium
                       hover:border-black hover:bg-gray-50 active:scale-95 transition"
          >
            ניהול מתקדם
          </button>
        </div>
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
            <span className="text-xs font-normal text-gray-400 mr-1">kJ</span>
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
          <span>0</span><span>50</span><span>150</span><span>200 kJ</span>
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

// ── Beach Row (dashboard list item — no hour picker) ─────────────────────────

function BeachRow({
  beach, cal, hourlyState, onOpenDrawer, onCalibrate,
}: {
  beach:        { id: string; name: string };
  cal:          BeachCalibration;
  hourlyState:  BeachHourlyState;
  onOpenDrawer: (id: string) => void;
  onCalibrate:  (id: string) => void;
}) {
  const { entries } = hourlyState;
  const hasAnyOv    = DISPLAY_HOURS.some(h => entries[hourKey(h)]?.overrideHs != null);
  const calibrated  = cal.height_factor !== 1 || cal.period_factor !== 1 ||
                      cal.wind_bias_knots !== 0 || cal.swell_angle_offset !== 0;
  const hasCustomDNA = cal.proxy_hs_multiplier != null;

  const statusLabel = hasAnyOv ? 'עקיפה שעתית' : calibrated ? 'מכוון' : 'ברירת מחדל';
  const statusColor = hasAnyOv
    ? 'bg-amber-50 text-amber-600 border border-amber-200'
    : calibrated
      ? 'bg-blue-50 text-blue-600 border border-blue-200'
      : 'bg-gray-50 text-gray-400 border border-gray-200';

  return (
    <div className="flex items-center gap-3 px-4 py-3.5 border-b border-gray-100 last:border-0" dir="rtl">
      {/* Name + badges */}
      <div className="flex-1 min-w-0">
        <p className="font-black text-sm text-gray-900 truncate">{beach.name}</p>
        <div className="flex flex-wrap items-center gap-1.5 mt-1">
          <span className={`text-[10px] px-2 py-0.5 rounded-full font-medium ${statusColor}`}>
            {statusLabel}
          </span>
          {hasCustomDNA && (
            <span className="text-[10px] px-1.5 py-0.5 rounded-full font-bold bg-purple-100 text-purple-600 border border-purple-200">
              ✦ DNA ×{cal.proxy_hs_multiplier?.toFixed(2)}
            </span>
          )}
          {cal.current_beach_bias !== undefined && Math.abs(cal.current_beach_bias - 1) >= 0.01 && (
            <span className={`text-[9px] px-1.5 py-0.5 rounded-full font-medium ${
              cal.current_beach_bias > 1
                ? 'bg-orange-50 text-orange-500'
                : 'bg-emerald-50 text-emerald-600'
            }`}>
              {cal.current_beach_bias > 1
                ? `מודל מתחת ב-${Math.round((cal.current_beach_bias - 1) * 100)}%`
                : `מודל מעל ב-${Math.round((1 - cal.current_beach_bias) * 100)}%`}
            </span>
          )}
        </div>
      </div>

      {/* DNA gear */}
      <button
        onClick={() => onCalibrate(beach.id)}
        title="כיול DNA"
        className="shrink-0 w-9 h-9 flex items-center justify-center border border-gray-200
                   rounded-xl hover:border-purple-400 hover:bg-purple-50 active:scale-95 transition text-base"
      >⚙️</button>

      {/* Open drawer */}
      <button
        onClick={() => onOpenDrawer(beach.id)}
        className="shrink-0 flex items-center gap-1 px-3.5 py-2 bg-gray-900 text-white
                   text-xs font-bold rounded-xl hover:bg-black active:scale-95 transition whitespace-nowrap"
      >
        🛠️ ניהול תחזית
      </button>
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

  const [previews,           setPreviews]           = useState<Record<string, BeachCalibration>>({});
  const [openId,             setOpenId]             = useState<string | null>(null);
  const [calibratingBeachId, setCalibratingBeachId] = useState<string | null>(null);
  const [toastMsg,           setToastMsg]           = useState<string | null>(null);
  const [masterPropagate,    setMasterPropagate]    = useState(false);
  const toastTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const liveSubsRef   = useRef<(() => void)[]>([]);

  const [selectedDate, setSelectedDate] = useState(() => getIsraelDate());
  const selectedDateNext = nextCalendarDay(selectedDate);
  // Convenience aliases used by AdvancedDrawer props and subscriptions
  const today    = selectedDate;
  const tomorrow = selectedDateNext;

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

  // Clear stale hourly data whenever the selected date changes so cards don't
  // show yesterday's entries when the user switches to a different day.
  useEffect(() => {
    setHourlyStates(() => Object.fromEntries(BEACHES.map(b => [b.id, emptyState()])));
    setOpenId(null);   // close drawer so the subscription re-fires for the new date
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedDate]);

  // ── Toast helper ──────────────────────────────────────────────────────────
  function showToast(msg: string) {
    if (toastTimerRef.current) clearTimeout(toastTimerRef.current);
    setToastMsg(msg);
    toastTimerRef.current = setTimeout(() => setToastMsg(null), 2500);
  }

  // ── Real-time Firestore listener when drawer is open ──────────────────────
  useEffect(() => {
    liveSubsRef.current.forEach(f => f());
    liveSubsRef.current = [];
    if (!openId) return;

    let todaySnap:    Record<string, HourlyEntry> = {};
    let tomorrowSnap: Record<string, HourlyEntry> = {};

    const push = () => {
      const merged = mergeEntries(todaySnap, tomorrowSnap);
      setHourlyStates(prev => ({
        ...prev,
        [openId]: { ...prev[openId], entries: merged },
      }));
    };

    const unsub1 = subscribeToHourlyTimeSeries(openId, today, data => {
      todaySnap = data; push();
    });
    const unsub2 = subscribeToHourlyTimeSeries(openId, tomorrow, data => {
      tomorrowSnap = data; push();
    });
    liveSubsRef.current = [unsub1, unsub2];
    return () => { liveSubsRef.current.forEach(f => f()); liveSubsRef.current = []; };
  }, [openId, today, tomorrow]);

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
      // Clean up any null/0 wind sentinels that may have been written by earlier merge:true patches
      await deleteNullWindOverrides(beachId, [today, tomorrow]).catch(() => {});
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

  async function handlePropagateMaster(
    hour:         number,
    hsRatio:      number | null,
    tRatio:       number | null,
    wRatio:       number | null,
    wDirOverride: number | null,
  ) {
    const key = String(hour).padStart(2, '0');
    console.log(`[ILG] handlePropagateMaster: hour=${key} today=${today} tomorrow=${tomorrow} hsRatio=${hsRatio?.toFixed(3)} tRatio=${tRatio?.toFixed(3)} wRatio=${wRatio?.toFixed(3)}`);
    let report: { beach: string; ops: number }[];
    try {
      report = await propagateMasterOverride(hour, hsRatio, tRatio, wRatio, wDirOverride, today, tomorrow, calMap ?? {});
    } catch (err) {
      console.error('[ILG] propagateMasterOverride threw:', err);
      showToast(`❌ שגיאת הפצה: ${String(err)}`);
      return [];
    }
    // Mark propagated beaches as stale so they reload fresh data on next drawer open
    if (report.length > 0) {
      setHourlyStates(prev => {
        const next = { ...prev };
        for (const { beach } of report) {
          next[beach] = emptyState();
        }
        return next;
      });
    } else {
      console.warn('[ILG] propagateMasterOverride returned 0 beaches — check Firestore docs exist for target beaches');
    }
    showToast(`🌊 הופץ ל-${report.length} חופים`);
    return report;
  }

  function handleHourSelect(beachId: string, hour: number) {
    setSelectedHours(prev => ({ ...prev, [beachId]: hour }));
    loadHourlyForBeach(beachId);
  }

  function handlePreview(id: string, next: BeachCalibration) {
    setPreviews(p => ({ ...p, [id]: next }));
  }

  function handleSaveHourly(
    beachId: string,
    hour: number,
    ov: { overrideHs: number | null; overrideT: number | null; overrideWind: number | null; overrideWindDir: number | null },
  ) {
    const key       = hourKey(hour);
    const updatedAt = new Date().toISOString();
    setHourlyStates(prev => {
      const bs = prev[beachId];
      if (!bs) return prev;
      // Create a shell entry if model data hasn't been synced yet so the
      // override still surfaces in the UI immediately after save.
      const existing = bs.entries[key] ?? {
        hour, rawHs: 0, rawT: 0, rawWind: 0, rawWindDir: 180,
        calHs: 0, calT: 0, calWind: 0, energy: 0,
        overrideHs: null, overrideT: null, overrideWind: null,
        syncedAt: '', updatedAt,
      };
      return {
        ...prev,
        [beachId]: {
          ...bs,
          entries: { ...bs.entries, [key]: { ...existing, ...ov, updatedAt } },
        },
      };
    });
  }

  function handleAutoPropagateAll(
    beachId: string,
    updates: Record<string, { overrideHs: number | null; overrideT: number | null }>,
  ) {
    const updatedAt = new Date().toISOString();
    setHourlyStates(prev => {
      const bs = prev[beachId];
      if (!bs) return prev;
      const entries = { ...bs.entries };
      for (const [key, ov] of Object.entries(updates)) {
        // Only update entries that already have model data — never create shells
        // with rawWind:0 / calWind:0 which would show wrong wind in the UI.
        if (!entries[key]) continue;
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
      <div className="bg-white border border-gray-200 rounded-2xl overflow-hidden shadow-sm">
        {BEACHES.map(b => (
          <div key={b.id} className="flex items-center gap-3 px-4 py-3.5 border-b border-gray-100 last:border-0">
            <div className="flex-1 space-y-1.5">
              <div className="h-4 w-32 bg-gray-100 rounded-full animate-pulse" />
              <div className="h-3 w-20 bg-gray-50 rounded-full animate-pulse" />
            </div>
            <div className="w-9 h-9 bg-gray-100 rounded-xl animate-pulse shrink-0" />
            <div className="w-24 h-9 bg-gray-100 rounded-xl animate-pulse shrink-0" />
          </div>
        ))}
      </div>
    );
  }

  const todayStr = getIsraelDate();  // real today — used only for chip labels

  return (
    <>
      {/* ── Date selector ────────────────────────────────────────────────────── */}
      <div
        className="sticky top-0 z-30 bg-white border-b border-gray-100 -mx-4 px-4 pt-3 pb-3 mb-5"
        dir="rtl"
      >
        <p className="text-[11px] font-bold text-gray-400 uppercase tracking-widest mb-1.5">תאריך לעריכה</p>
        <div className="flex items-center gap-2">
          <div className="relative flex-1">
            <select
              value={selectedDate}
              onChange={e => setSelectedDate(e.target.value)}
              className="w-full appearance-none bg-gray-50 border-2 border-gray-200 rounded-xl
                         px-4 py-3 pr-10 text-base font-bold text-gray-900
                         focus:outline-none focus:border-black transition cursor-pointer"
              dir="rtl"
            >
              {Array.from({ length: 7 }, (_, i) => {
                const d = addDays(todayStr, i);
                return (
                  <option key={d} value={d}>
                    {formatDayLabel(d, todayStr)}
                  </option>
                );
              })}
            </select>
            {/* Custom dropdown arrow */}
            <span className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-gray-400 text-sm">
              ▼
            </span>
          </div>
          {selectedDate !== todayStr && (
            <button
              onClick={() => setSelectedDate(todayStr)}
              className="shrink-0 px-4 py-3 text-sm font-bold text-blue-600 bg-blue-50
                         hover:bg-blue-100 rounded-xl transition whitespace-nowrap"
            >
              ← היום
            </button>
          )}
        </div>
        {selectedDate !== todayStr && (
          <p className="mt-2 text-[11px] text-amber-600 font-medium">
            ✎ עורך תחזית ל-{selectedDate} · 00:00–03:00 יכתבו ל-{tomorrow}
          </p>
        )}
      </div>

      {/* ── Master Proxy toggle — always visible in main view ──────────────── */}
      <div className="mb-4" dir="rtl">
        <button
          onClick={() => setMasterPropagate(v => !v)}
          className={`w-full flex items-center justify-between px-4 py-3 rounded-2xl border text-sm font-bold transition ${
            masterPropagate
              ? 'bg-indigo-50 border-indigo-300 text-indigo-700'
              : 'bg-gray-50 border-gray-200 text-gray-500'
          }`}
        >
          <span className="flex items-center gap-2.5">
            <span className={`inline-block w-9 h-5 rounded-full relative transition-colors shrink-0 ${
              masterPropagate ? 'bg-indigo-500' : 'bg-gray-300'
            }`}>
              <span className={`absolute top-0.5 w-4 h-4 bg-white rounded-full shadow transition-all ${
                masterPropagate ? 'left-4' : 'left-0.5'
              }`} />
            </span>
            עדכן את כל החופים (Master Proxy)
          </span>
          <span className="text-xs font-normal opacity-60 shrink-0">
            {masterPropagate ? 'פעיל — שמירת ת"א תפיץ לכל החופים' : 'כבוי'}
          </span>
        </button>
      </div>

      {/* ── Beach list ───────────────────────────────────────────────────────── */}
      <div className="bg-white border border-gray-200 rounded-2xl overflow-hidden shadow-sm">
        {BEACHES.map(beach => {
          const cal = previews[beach.id] ?? calMap[beach.id] ?? { ...CAL_DEFAULTS };
          const hs  = hourlyStates[beach.id] ?? emptyState();
          return (
            <BeachRow
              key={beach.id}
              beach={beach}
              cal={cal}
              hourlyState={hs}
              onOpenDrawer={id => { loadHourlyForBeach(id); setOpenId(id); }}
              onCalibrate={id => { loadHourlyForBeach(id); setCalibratingBeachId(id); }}
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
          onSaveHourly={handleSaveHourly}
          onAutoPropagateAll={handleAutoPropagateAll}
          onSaveTideOverrides={handleSaveTideOverrides}
          onPreview={handlePreview}
          onHourChange={handleHourSelect}
          onToast={showToast}
          masterProxy={openBeach.id === MASTER_BEACH_ID ? {
            enabled:     masterPropagate,
            onToggle:    () => setMasterPropagate(v => !v),
            onPropagate: handlePropagateMaster,
          } : undefined}
        />
      )}

      {/* Beach DNA Calibration Modal */}
      {calibratingBeachId && calMap && (() => {
        const beach   = BEACHES.find(b => b.id === calibratingBeachId)!;
        const cal     = calMap[calibratingBeachId] ?? { ...CAL_DEFAULTS };
        const tlvEnt  = hourlyStates['tlv']?.entries;
        const thisEnt = hourlyStates[calibratingBeachId]?.entries;
        const defHour = selectedHours[calibratingBeachId] ?? getIsraelHour();
        const key     = hourKey(defHour);
        const tlvHs   = tlvEnt?.[key]?.overrideHs  ?? tlvEnt?.[key]?.calHs  ?? 0;
        const beachHs = thisEnt?.[key]?.overrideHs ?? thisEnt?.[key]?.calHs ?? 0;
        return (
          <CalibrationModal
            beach={beach}
            cal={cal}
            tlvHs={tlvHs}
            beachHs={beachHs}
            onSave={async cfg => {
              await setBeachProxyConfig(calibratingBeachId, cfg);
              await mutate();
              showToast(`✦ DNA נשמר — ${beach.name} ×${cfg.hsMultiplier}`);
            }}
            onClose={() => setCalibratingBeachId(null)}
          />
        );
      })()}

      {/* Toast notification */}
      {toastMsg && (
        <div className="fixed bottom-28 left-1/2 -translate-x-1/2 bg-gray-900 text-white text-sm font-bold px-5 py-3 rounded-2xl shadow-2xl z-[200] whitespace-nowrap pointer-events-none">
          {toastMsg}
        </div>
      )}
    </>
  );
}
