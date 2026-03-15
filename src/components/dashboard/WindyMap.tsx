'use client';

export function WindyMap() {
  return (
    <div className="w-full h-64 md:h-96 border border-gray-200 overflow-hidden">
      <iframe
        src="https://embed.windy.com/embed2.html?type=map&location=coordinates&metricRain=default&metricTemp=%C2%B0C&metricWind=km%2Fh&zoom=7&overlay=waves&product=ecmwf&level=surface&lat=32.08&lon=34.77&detailLat=32.08&detailLon=34.77&detail=true"
        className="w-full h-full"
        frameBorder="0"
        title="Windy Wave Map Israel"
        allowFullScreen
      />
    </div>
  );
}
