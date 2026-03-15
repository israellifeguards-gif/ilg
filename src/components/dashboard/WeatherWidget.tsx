import type { WeatherData } from '@/types';

interface Props {
  data: WeatherData;
}

const UVLabel = (uv: number) => {
  if (uv <= 2) return { label: 'נמוך', color: 'text-green-600' };
  if (uv <= 5) return { label: 'בינוני', color: 'text-yellow-500' };
  if (uv <= 7) return { label: 'גבוה', color: 'text-orange-500' };
  return { label: 'קיצוני', color: 'text-[#FF0000]' };
};

export function WeatherWidget({ data }: Props) {
  const uv = UVLabel(data.uv_index);

  return (
    <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
      {/* Sea Height */}
      <div className="border border-gray-200 p-4 flex flex-col items-center gap-1 text-center">
        <span className="text-3xl">🌊</span>
        <span className="text-2xl font-black">{data.sea_height.toFixed(1)}m</span>
        <span className="text-xs text-gray-500 font-medium">גובה גלים</span>
      </div>

      {/* Wind */}
      <div className="border border-gray-200 p-4 flex flex-col items-center gap-1 text-center">
        <span className="text-3xl">💨</span>
        <span className="text-2xl font-black">{data.wind_speed} km/h</span>
        <span className="text-xs text-gray-500 font-medium">רוח {data.wind_direction}</span>
      </div>

      {/* Water Temp */}
      <div className="border border-gray-200 p-4 flex flex-col items-center gap-1 text-center">
        <span className="text-3xl">🌡️</span>
        <span className="text-2xl font-black">{data.water_temp}°C</span>
        <span className="text-xs text-gray-500 font-medium">טמפ׳ מים</span>
      </div>

      {/* UV */}
      <div className="border border-gray-200 p-4 flex flex-col items-center gap-1 text-center">
        <span className="text-3xl">☀️</span>
        <span className={`text-2xl font-black ${uv.color}`}>{data.uv_index}</span>
        <span className="text-xs text-gray-500 font-medium">UV – {uv.label}</span>
      </div>
    </div>
  );
}
