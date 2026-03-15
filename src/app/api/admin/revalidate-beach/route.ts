import { NextResponse } from 'next/server';
import { updateTag } from 'next/cache';
import { BEACHES } from '@/lib/beaches';

// Invalidate cached surf data for one beach or all beaches.
// Usage:
//   Single beach: GET /api/admin/revalidate-beach?beach=tlv
//   All beaches:  GET /api/admin/revalidate-beach?beach=all

export async function GET(req: Request) {
  const { searchParams } = new URL(req.url);
  const beachId = searchParams.get('beach');

  if (!beachId) {
    return NextResponse.json({ error: 'missing ?beach= param' }, { status: 400 });
  }

  if (beachId === 'all') {
    updateTag('surf:all');
    return NextResponse.json({ ok: true, invalidated: 'all beaches' });
  }

  const beach = BEACHES.find(b => b.id === beachId);
  if (!beach) {
    return NextResponse.json({ error: `unknown beach: ${beachId}` }, { status: 404 });
  }

  updateTag(`surf:${beach.lat},${beach.lng}`);
  return NextResponse.json({ ok: true, invalidated: beachId, lat: beach.lat, lng: beach.lng });
}
