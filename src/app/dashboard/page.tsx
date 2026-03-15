// force-dynamic is required for cookies() — but individual fetch() calls
// with revalidate inside fetchSurfForecast still use the Data Cache.
// We separate Firestore reads (always fresh) from API fetches (cached).
export const dynamic = 'force-dynamic';

import { SurfForecast } from '@/components/dashboard/SurfForecast';
import { fetchSurfForecast } from '@/lib/api/surf';
import { BEACHES } from '@/lib/beaches';
import { cookies } from 'next/headers';

export default async function DashboardPage({
  searchParams,
}: {
  searchParams: Promise<{ city?: string }>;
}) {
  const params = await searchParams;
  const hasExplicitCity = !!params.city;
  const cookieStore = await cookies();
  const favoriteCookie = cookieStore.get('ilg_favorite_beach')?.value;
  const beach = BEACHES.find((b) => b.id === params.city)
    ?? BEACHES.find((b) => b.id === favoriteCookie)
    ?? BEACHES.find((b) => b.id === 'tlv')
    ?? BEACHES[0];
  const surf = await fetchSurfForecast(beach.lat, beach.lng, beach.id);

  return (
    <div className="w-full">
      <div className="py-0">

      {surf ? (
        <SurfForecast key={surf.fetchedAt} data={surf} beachName={beach.name} selectedBeachId={beach.id} hasExplicitCity={hasExplicitCity} />
      ) : (
        <p className="text-sm text-gray-400 py-8 text-center">לא ניתן לטעון תחזית גלים כרגע</p>
      )}
      </div>
    </div>
  );
}
