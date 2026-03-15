import { fetchLiveWeather, wmoInfo } from '@/lib/api/weather';

const DIR_LABELS: Record<string, string> = {
  N: 'צפון', NE: 'צפון-מזרח', E: 'מזרח', SE: 'דרום-מזרח',
  S: 'דרום', SW: 'דרום-מערב', W: 'מערב', NW: 'צפון-מערב',
};

function WindArrow({ deg }: { deg: number }) {
  return (
    <span style={{ display: 'inline-block', transform: `rotate(${deg}deg)`, fontSize: 15, color: '#3b82f6' }}>⬆</span>
  );
}

export default async function LiveWeatherWidget({ lat = 32.08, lng = 34.77 }: { lat?: number; lng?: number }) {
  const w = await fetchLiveWeather(lat, lng);
  if (!w) return null;

  const { label, emoji } = wmoInfo(w.weatherCode);

  return (
    <div dir="rtl">

      {/* Compact header row */}
      <div className="flex items-center justify-between mb-3">
        <div className="flex items-end gap-1 leading-none">
          <span className="font-black text-black" style={{ fontSize: 52, lineHeight: 1 }}>{Math.round(w.temp)}°</span>
          <span className="text-base font-bold text-gray-400 mb-1.5">מרגיש {Math.round(w.feelsLike)}°</span>
        </div>
        <div className="text-left">
          <div style={{ fontSize: 42, lineHeight: 1 }}>{emoji}</div>
          <div className="text-base font-bold text-gray-500 mt-1 text-left">{label}</div>
        </div>
      </div>

      <div className="text-base text-gray-400 mb-3 font-medium">
        {w.tempMax}°–{w.tempMin}°
      </div>

      {/* 2-column compact grid */}
      <div className="grid grid-cols-2 gap-x-3 gap-y-3 text-base border-t border-gray-100 pt-3">
        <div className="flex items-center justify-between">
          <span className="text-gray-400 font-bold">רוח</span>
          <span className="font-black text-black"><WindArrow deg={(w.windDeg + 180) % 360} /> {w.windSpeed} קמ&quot;ש</span>
        </div>
        <div className="flex items-center justify-between">
          <span className="text-gray-400 font-bold">כיוון</span>
          <span className="font-black text-black">{DIR_LABELS[w.windDir] ?? w.windDir}</span>
        </div>
        <div className="flex items-center justify-between">
          <span className="text-gray-400 font-bold">לחות</span>
          <span className="font-black text-black">{w.humidity}%</span>
        </div>
        <div className="flex items-center justify-between">
          <span className="text-gray-400 font-bold">UV</span>
          <span className="font-black" style={{ color: '#a855f7' }}>{w.uvIndex}</span>
        </div>
        <div className="flex items-center justify-between">
          <span className="text-gray-400 font-bold">טמפ׳ מים</span>
          <span className="font-black text-black">{w.waterTemp}°C</span>
        </div>
        <div className="flex items-center justify-between">
          <span className="text-gray-400 font-bold">גלים</span>
          <span className="font-black text-black">{w.waveHeight}m</span>
        </div>
        <div className="flex items-center justify-between">
          <span className="text-gray-400 font-bold">זריחה</span>
          <span className="font-black text-black">{w.sunrise}</span>
        </div>
        <div className="flex items-center justify-between">
          <span className="text-gray-400 font-bold">שקיעה</span>
          <span className="font-black text-black">{w.sunset}</span>
        </div>
        <div className="flex items-center justify-between">
          <span className="text-gray-400 font-bold">ראות</span>
          <span className="font-black text-black">{w.visibility} ק&quot;מ</span>
        </div>
        <div className="flex items-center justify-between">
          <span className="text-gray-400 font-bold">לחץ</span>
          <span className="font-black text-black">{w.pressure} hPa</span>
        </div>
      </div>

      <div className="text-xs text-gray-300 text-left mt-3">
        עודכן {new Date(w.fetchedAt).toLocaleTimeString('he-IL', { hour: '2-digit', minute: '2-digit' })}
      </div>
    </div>
  );
}
