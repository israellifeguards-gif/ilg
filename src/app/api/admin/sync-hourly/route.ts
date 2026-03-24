import { NextResponse } from 'next/server';
import { BEACHES } from '@/lib/beaches';
import { fetchCalibrationDoc } from '@/lib/api/beachCalibration';
import { writeModelBatch } from '@/lib/api/beachTimeSeries';
import { fetchTideEventOverrides } from '@/lib/api/beachHourlyCal';
import type { TideEventOverride } from '@/lib/api/beachHourlyCal';

export const dynamic = 'force-dynamic';

// ── Helpers (mirrored from hourly-forecast) ───────────────────────────────────

function calcEnergy(hs: number, t: number): number {
  if (!isFinite(hs) || !isFinite(t) || hs <= 0 || t <= 0) return 0;
  return +(0.4903 * hs * hs * t).toFixed(1);
}

function adjustWind(kts: number, dir = 180): number {
  if (!isFinite(kts) || kts < 0) return 0;
  return Math.round(kts * (dir >= 90 && dir <= 130 ? 1.1 : 1.5));
}

// ── Tide-aware correction ─────────────────────────────────────────────────────
// Interpolates tidal phase from manual override events and applies ±4%
// wave-height adjustment (High tide = +4%, Low tide = -4%).

function tideMultiplier(overrides: TideEventOverride[], hour: number): number {
  if (!overrides.length) return 1;
  const pts = overrides
    .map(e => {
      const [hh, mm] = e.time.split(':').map(Number);
      return { h: hh + mm / 60, isHigh: e.type === 'High' };
    })
    .sort((a, b) => a.h - b.h);

  const before = [...pts].reverse().find(p => p.h <= hour);
  const after  = pts.find(p => p.h > hour);

  let phase: number; // 0 = Low, 1 = High
  if (!before && !after) return 1;
  if (!before) phase = after!.isHigh ? 0.1 : 0.9;
  else if (!after) phase = before.isHigh ? 0.9 : 0.1;
  else {
    const t = (hour - before.h) / (after.h - before.h);
    phase   = before.isHigh ? 1 - t : t;
  }
  // ±4% correction centred on mid-tide (phase = 0.5)
  return 1 + (phase - 0.5) * 0.08;
}

// ── Route ─────────────────────────────────────────────────────────────────────

export async function POST(req: Request) {
  const { searchParams } = new URL(req.url);
  const beachId = searchParams.get('beach');
  if (!beachId) return NextResponse.json({ error: 'beach param required' }, { status: 400 });

  const beach = BEACHES.find(b => b.id === beachId);
  if (!beach)  return NextResponse.json({ error: `unknown beach: ${beachId}` }, { status: 404 });

  // Resolve target date (Israel timezone)
  const TZ  = 'Asia/Jerusalem';
  const now = new Date();
  const ilP = new Intl.DateTimeFormat('en-CA', {
    timeZone: TZ, year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', hour12: false,
  }).formatToParts(now);
  const g = (t: string) => ilP.find(p => p.type === t)?.value ?? '0';
  const date = searchParams.get('date') ?? `${g('year')}-${g('month')}-${g('day')}`;

  try {
    const [marineRes, weatherRes, calDoc, tideOverrides] = await Promise.all([
      fetch(
        `https://marine-api.open-meteo.com/v1/marine` +
        `?latitude=${beach.lat}&longitude=${beach.lng}` +
        `&hourly=wave_height,wave_period` +
        `&models=ecmwf_wam025&forecast_days=7&timezone=Asia%2FJerusalem`,
        { cache: 'no-store' },
      ),
      fetch(
        `https://api.open-meteo.com/v1/forecast` +
        `?latitude=${beach.lat}&longitude=${beach.lng}` +
        `&hourly=wind_speed_10m,wind_direction_10m` +
        `&models=ecmwf_ifs025&wind_speed_unit=kn&forecast_days=7&timezone=Asia%2FJerusalem`,
        { cache: 'no-store' },
      ),
      fetchCalibrationDoc(beachId),
      fetchTideEventOverrides(beachId, date).catch(() => [] as TideEventOverride[]),
    ]);

    const marine  = await marineRes.json();
    const weather = await weatherRes.json();

    // Learned ratios take priority over static calibration factors for forward-looking sync
    const hsFactor     = calDoc.current_beach_bias ?? calDoc.height_factor ?? 1.0;
    const periodFactor = calDoc.current_t_ratio    ?? calDoc.period_factor ?? 1.0;
    const windRatio    = calDoc.current_wind_ratio ?? 1.0;
    const windBias     = calDoc.wind_bias_knots    ?? 0;

    const times:       string[] = marine.hourly?.time               ?? [];
    const waveHeights: number[] = marine.hourly?.wave_height        ?? [];
    const wavePeriods: number[] = marine.hourly?.wave_period        ?? [];
    const windSpeeds:  number[] = weather.hourly?.wind_speed_10m    ?? [];
    const windDirs:    number[] = weather.hourly?.wind_direction_10m ?? [];

    const entries: Parameters<typeof writeModelBatch>[2] = [];

    for (let i = 0; i < times.length; i++) {
      const [d, timeStr] = times[i].split('T');
      if (d !== date) continue;

      const hour       = parseInt(timeStr);
      const rawHs      = +((waveHeights[i] ?? 0) / 2).toFixed(2);
      const rawT       = +(wavePeriods[i] ?? 0).toFixed(1);
      const rawWindDir = windDirs[i] ?? 180;
      const rawWind    = adjustWind(windSpeeds[i] ?? 0, rawWindDir);

      // Apply bias × tide-aware correction to wave height
      const tideMult = tideMultiplier(tideOverrides, hour);
      const calHs    = +(rawHs * hsFactor * tideMult).toFixed(2);
      const calT     = +(rawT  * periodFactor).toFixed(1);
      const calWind  = Math.max(0, Math.round(rawWind * windRatio + windBias));

      entries.push({
        hour,
        rawHs, rawT, rawWind, rawWindDir,
        calHs, calT, calWind,
        energy: calcEnergy(calHs, calT),
        syncedAt: new Date().toISOString(),
      });
    }

    if (entries.length === 0) {
      return NextResponse.json({ error: `no data for date ${date}` }, { status: 404 });
    }

    await writeModelBatch(beachId, date, entries);

    return NextResponse.json({ synced: entries.length, date, beach: beachId });
  } catch (e) {
    return NextResponse.json({ error: String(e) }, { status: 500 });
  }
}
