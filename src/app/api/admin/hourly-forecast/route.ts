import { NextResponse } from 'next/server';
import { BEACHES } from '@/lib/beaches';
import { fetchBeachCalibration } from '@/lib/api/beachCalibration';

export const dynamic = 'force-dynamic';

// ── Harmonic tide (same 8 constituents as surf.ts + tide-status) ──────────────
const _TC: [number, number, number, number][] = [
  [28.984104, 0.113,  72, 188.86],
  [30.000000, 0.062, 110,   0.00],
  [28.439730, 0.022,  50, 304.18],
  [30.082137, 0.017, 115, 203.46],
  [15.041069, 0.030, 220,  11.73],
  [13.943035, 0.025, 200, 177.13],
  [14.958931, 0.010, 220, 168.27],
  [13.398661, 0.005, 180, 214.18],
];
const D2R = Math.PI / 180;
function tideH(ms: number): number {
  const t = ms / 3_600_000;
  let h = 0;
  for (const [speed, H, G, v0] of _TC) h += H * Math.cos((speed * t + v0 - G) * D2R);
  return h;
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function calcEnergy(hs: number, t: number): number {
  if (!isFinite(hs) || !isFinite(t) || hs <= 0 || t <= 0) return 0;
  return +(0.4903 * hs * hs * t).toFixed(1);
}

function adjustWind(kts: number, dir = 180): number {
  if (!isFinite(kts) || kts < 0) return 0;
  return Math.round(kts * (dir >= 90 && dir <= 130 ? 1.1 : 1.5));
}

// ── Tide extremes for a 24-h window starting at midnightMs ───────────────────

export interface TideEvent {
  time:   string;       // Israel local "HH:MM"
  type:   'High' | 'Low';
  height: number;
}

function getTideExtremes(midnightMs: number): TideEvent[] {
  const TZ   = 'Asia/Jerusalem';
  const STEP = 10 * 60_000;
  const events: TideEvent[] = [];
  let rising = tideH(midnightMs + STEP) > tideH(midnightMs);

  for (let ms = STEP; ms <= 25 * 3_600_000; ms += STEP) {
    const h         = tideH(midnightMs + ms);
    const nowRising = tideH(midnightMs + ms + STEP) > h;
    if (nowRising !== rising) {
      events.push({
        time: new Intl.DateTimeFormat('he-IL', {
          timeZone: TZ, hour: '2-digit', minute: '2-digit', hour12: false,
        }).format(new Date(midnightMs + ms)),
        type:   rising ? 'High' : 'Low',
        height: +h.toFixed(3),
      });
      rising = nowRising;
    }
  }
  return events;
}

// ── Response types (imported by panel component) ──────────────────────────────

export interface HourlyForecastPoint {
  hour:       number;   // 0–23
  time:       string;   // "HH:00"
  rawHs:      number;   // Open-Meteo wave_height / 2 (face height, before cal)
  rawT:       number;   // Open-Meteo wave_period
  rawWind:    number;   // wind after direction-aware bias, before cal
  rawWindDir: number;
  calHs:      number;   // rawHs × height_factor
  calT:       number;   // rawT  × period_factor
  calWind:    number;   // rawWind + wind_bias_knots
  energy:     number;   // kW/m from calibrated values
}

// ── Route ─────────────────────────────────────────────────────────────────────

export async function GET(req: Request) {
  const { searchParams } = new URL(req.url);
  const beachId = searchParams.get('beach');
  if (!beachId) return NextResponse.json({ error: 'beach param required' }, { status: 400 });

  const beach = BEACHES.find(b => b.id === beachId);
  if (!beach)  return NextResponse.json({ error: `unknown beach: ${beachId}` }, { status: 404 });

  const TZ  = 'Asia/Jerusalem';
  const now = new Date();
  const ilP = new Intl.DateTimeFormat('en-CA', {
    timeZone: TZ, year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', hour12: false,
  }).formatToParts(now);
  const g = (t: string) => ilP.find(p => p.type === t)?.value ?? '0';

  const ilHour     = parseInt(g('hour')) % 24;
  const ilMin      = parseInt(g('minute'));
  const midnightMs = Date.now() - (ilHour + ilMin / 60) * 3_600_000;
  const date       = searchParams.get('date') ?? `${g('year')}-${g('month')}-${g('day')}`;

  try {
    const [marineRes, weatherRes, calibration] = await Promise.all([
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
      fetchBeachCalibration(beachId),
    ]);

    const marine  = await marineRes.json();
    const weather = await weatherRes.json();

    const times:       string[] = marine.hourly?.time             ?? [];
    const waveHeights: number[] = marine.hourly?.wave_height      ?? [];
    const wavePeriods: number[] = marine.hourly?.wave_period      ?? [];
    const windSpeeds:  number[] = weather.hourly?.wind_speed_10m  ?? [];
    const windDirs:    number[] = weather.hourly?.wind_direction_10m ?? [];

    const points: HourlyForecastPoint[] = [];

    for (let i = 0; i < times.length; i++) {
      const [d, timeStr] = times[i].split('T');
      if (d !== date) continue;

      const hour       = parseInt(timeStr);
      const rawHs      = +((waveHeights[i] ?? 0) / 2).toFixed(2);
      const rawT       = +(wavePeriods[i] ?? 0).toFixed(1);
      const rawWindDir = windDirs[i] ?? 180;
      const rawWind    = adjustWind(windSpeeds[i] ?? 0, rawWindDir);

      const calHs  = +(rawHs * calibration.height_factor).toFixed(2);
      const calT   = +(rawT  * calibration.period_factor).toFixed(1);
      const calWind = Math.max(0, Math.round(rawWind + calibration.wind_bias_knots));

      points.push({
        hour,
        time:       `${String(hour).padStart(2, '0')}:00`,
        rawHs, rawT, rawWind, rawWindDir,
        calHs, calT, calWind,
        energy: calcEnergy(calHs, calT),
      });
    }

    return NextResponse.json({ points, tideExtremes: getTideExtremes(midnightMs), date });
  } catch (e) {
    return NextResponse.json({ error: String(e) }, { status: 500 });
  }
}
