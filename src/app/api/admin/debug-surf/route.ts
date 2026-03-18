import { NextResponse } from 'next/server';
import { debugTideData } from '@/lib/api/surf';

// Dump raw API values vs final displayed values for one beach.
// Usage: GET /api/admin/debug-surf?beach=tlv

export async function GET(req: Request) {
  const { searchParams } = new URL(req.url);
  const beachId = searchParams.get('beach') ?? 'tlv';
  try {
    const report = await debugTideData(beachId);
    return NextResponse.json(report, { status: 200 });
  } catch (e) {
    return NextResponse.json({ error: String(e) }, { status: 500 });
  }
}
