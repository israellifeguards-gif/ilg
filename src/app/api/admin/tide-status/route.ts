import { NextResponse } from 'next/server';

// Harmonic constituents — same as surf.ts (Israeli Mediterranean coast)
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

export async function GET() {
  const now    = Date.now();
  const STEP   = 10 * 60_000; // 10 min

  // Current tide height + direction
  const hNow   = tideH(now);
  const rising = tideH(now + STEP) > hNow;

  // Next extreme (within 8h)
  let hoursToNext = 6.0;
  let nextType: 'גאות' | 'שפל' = rising ? 'גאות' : 'שפל';
  for (let ms = STEP; ms < 8 * 3_600_000; ms += STEP) {
    const hP = tideH(now + ms - STEP);
    const hC = tideH(now + ms);
    const hN = tideH(now + ms + STEP);
    if (rising  && hC >= hP && hC >= hN) { hoursToNext = ms / 3_600_000; nextType = 'גאות'; break; }
    if (!rising && hC <= hP && hC <= hN) { hoursToNext = ms / 3_600_000; nextType = 'שפל';  break; }
  }

  // Midnight Israel time (for sparkline x-axis)
  const TZ = 'Asia/Jerusalem';
  const ilParts = new Intl.DateTimeFormat('en-US', {
    timeZone: TZ, hour: '2-digit', minute: '2-digit', hour12: false,
  }).formatToParts(new Date());
  const ilHour = parseInt(ilParts.find(p => p.type === 'hour')!.value)  % 24;
  const ilMin  = parseInt(ilParts.find(p => p.type === 'minute')!.value);
  const currentILHour = ilHour + ilMin / 60;
  const midnightMs    = now - currentILHour * 3_600_000;

  // Sparkline: every 30 min over 24h
  const sparkPoints: { hour: number; height: number }[] = [];
  for (let h = 0; h <= 24; h += 0.5) {
    sparkPoints.push({ hour: h, height: +tideH(midnightMs + h * 3_600_000).toFixed(3) });
  }

  // Next extreme time string
  const nextMs   = now + hoursToNext * 3_600_000;
  const nextTime = new Intl.DateTimeFormat('he-IL', {
    timeZone: TZ, hour: '2-digit', minute: '2-digit', hour12: false,
  }).format(new Date(nextMs));

  return NextResponse.json({
    currentHeight: +hNow.toFixed(3),
    rising,
    hoursToNext:   +hoursToNext.toFixed(1),
    nextType,
    nextTime,
    sparkPoints,
    nowHour: +currentILHour.toFixed(2),
  });
}
