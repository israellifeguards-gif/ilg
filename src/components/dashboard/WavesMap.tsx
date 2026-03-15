'use client';

interface WavesMapProps {
  lat: number;
  lng: number;
  beachName: string;
}

export function WavesMap({ lat, lng, beachName }: WavesMapProps) {
  const src =
    `https://embed.windy.com/embed2.html?lat=${lat}&lon=${lng}` +
    `&detailLat=${lat}&detailLon=${lng}` +
    `&width=650&height=450&zoom=8&level=surface` +
    `&overlay=waves&product=ecmwf&menu=&message=true&marker=true` +
    `&calendar=now&pressure=&type=map&location=coordinates` +
    `&detail=&metricWind=default&metricTemp=default&radarRange=-1`;

  return (
    <div className="px-4">
      <div className="mb-3">
        <h2 className="text-lg font-black">מפת גלים</h2>
        <p className="text-xs text-gray-500">גלים בזמן אמת – {beachName}</p>
      </div>
      <div className="rounded-2xl overflow-hidden border border-gray-200 shadow-md w-full" style={{ height: 380 }}>
        <iframe
          src={src}
          className="w-full h-full"
          frameBorder="0"
          allowFullScreen
          title="מפת גלים"
        />
      </div>
    </div>
  );
}
