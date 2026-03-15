import { NextResponse } from 'next/server';
import { revalidatePath } from 'next/cache';
import { setTideOffsetRaw } from '@/lib/api/surf';

// Usage:
//   Global:     GET /api/admin/calibrate-tide?offset=1.35
//   Per-beach:  GET /api/admin/calibrate-tide?offset=1.35&beach=tlv
// offset = actual_time − predicted_time in decimal hours

export async function GET(req: Request) {
  const { searchParams } = new URL(req.url);
  const offsetParam = searchParams.get('offset');
  const beachId     = searchParams.get('beach') ?? undefined;
  const offset = offsetParam !== null ? parseFloat(offsetParam) : NaN;

  if (isNaN(offset) || offset < -6 || offset > 6) {
    return NextResponse.json({ error: `offset=${offset} out of ±6h range` }, { status: 400 });
  }

  try {
    await setTideOffsetRaw(offset, beachId);
    revalidatePath('/dashboard');
    return NextResponse.json({
      ok: true,
      beach: beachId ?? 'global',
      offsetHours: offset,
      message: `Tide offset for ${beachId ?? 'global'} set to ${offset}h (${Math.round(offset * 60)} min).`,
    });
  } catch (e) {
    return NextResponse.json({ error: String(e) }, { status: 500 });
  }
}
