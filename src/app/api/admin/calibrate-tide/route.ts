import { NextResponse } from 'next/server';
import { revalidatePath } from 'next/cache';
import { setTideOffsetRaw } from '@/lib/api/surf';

// ONE-TIME calibration endpoint — call once, then delete this file.
// Usage: GET /api/admin/calibrate-tide?offset=1.35
// Predicted: 13:59  |  Actual ISRAMAR: 15:20  |  Delta: 81 min = 1.35h

export async function GET(req: Request) {
  const { searchParams } = new URL(req.url);
  const offsetParam = searchParams.get('offset');
  const offset = offsetParam !== null ? parseFloat(offsetParam) : 1.35;

  if (isNaN(offset) || offset < -6 || offset > 6) {
    return NextResponse.json({ error: `offset=${offset} out of ±6h range` }, { status: 400 });
  }

  try {
    await setTideOffsetRaw(offset);
    revalidatePath('/dashboard');
    return NextResponse.json({
      ok: true,
      offsetHours: offset,
      message: `Tide offset set to ${offset}h (${Math.round(offset * 60)} min). Dashboard cache cleared — next load will be fresh.`,
    });
  } catch (e) {
    return NextResponse.json({ error: String(e) }, { status: 500 });
  }
}
