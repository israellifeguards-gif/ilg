import { NextResponse } from 'next/server';
import { fetchNews } from '@/lib/api/news';

export const dynamic = 'force-dynamic';

export async function GET() {
  try {
    const items = await fetchNews();
    return NextResponse.json(items);
  } catch {
    return NextResponse.json([], { status: 200 });
  }
}
