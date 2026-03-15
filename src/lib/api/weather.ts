export interface LiveWeatherData {
  temp: number;
  feelsLike: number;
  tempMax: number;
  tempMin: number;
  humidity: number;
  windSpeed: number;
  windDir: string;
  windDeg: number;
  uvIndex: number;
  cloudCover: number;
  pressure: number;
  visibility: number;
  weatherCode: number;
  sunrise: string;
  sunset: string;
  waterTemp: number;
  waveHeight: number;
  fetchedAt: string;
}

const WMO_LABELS: Record<number, { label: string; emoji: string }> = {
  0:  { label: 'שמיים בהירים',      emoji: '☀️' },
  1:  { label: 'בעיקר בהיר',        emoji: '🌤️' },
  2:  { label: 'מעונן חלקית',       emoji: '⛅' },
  3:  { label: 'מעונן',             emoji: '☁️' },
  45: { label: 'ערפל',              emoji: '🌫️' },
  48: { label: 'ערפל כפור',         emoji: '🌫️' },
  51: { label: 'טפטוף קל',          emoji: '🌦️' },
  53: { label: 'טפטוף בינוני',      emoji: '🌦️' },
  55: { label: 'טפטוף כבד',         emoji: '🌧️' },
  61: { label: 'גשם קל',            emoji: '🌧️' },
  63: { label: 'גשם בינוני',        emoji: '🌧️' },
  65: { label: 'גשם כבד',           emoji: '🌧️' },
  80: { label: 'מקלחות קלות',       emoji: '🌦️' },
  81: { label: 'מקלחות בינוניות',   emoji: '🌧️' },
  82: { label: 'מקלחות כבדות',      emoji: '⛈️' },
  95: { label: 'סופת רעמים',        emoji: '⛈️' },
  96: { label: 'סופת ברד',          emoji: '⛈️' },
  99: { label: 'סופת ברד כבדה',     emoji: '⛈️' },
};

export function wmoInfo(code: number): { label: string; emoji: string } {
  return WMO_LABELS[code] ?? { label: 'לא ידוע', emoji: '🌡️' };
}

function degreesToDirection(deg: number): string {
  const dirs = ['N', 'NE', 'E', 'SE', 'S', 'SW', 'W', 'NW'];
  return dirs[Math.round(((deg % 360) + 360) / 45) % 8];
}

function formatTime(iso: string): string {
  const d = new Date(iso);
  return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
}

export async function fetchLiveWeather(
  lat = 32.08,
  lng = 34.77
): Promise<LiveWeatherData | null> {
  try {
    const [weatherRes, marineRes] = await Promise.all([
      fetch(
        `https://api.open-meteo.com/v1/forecast?latitude=${lat}&longitude=${lng}` +
          `&current=temperature_2m,apparent_temperature,relative_humidity_2m,` +
          `wind_speed_10m,wind_direction_10m,uv_index,cloud_cover,surface_pressure,` +
          `visibility,weather_code` +
          `&daily=temperature_2m_max,temperature_2m_min,sunrise,sunset` +
          `&wind_speed_unit=kmh&timezone=Asia%2FJerusalem&forecast_days=1`,
        { next: { revalidate: 1800 } }
      ),
      fetch(
        `https://marine-api.open-meteo.com/v1/marine?latitude=${lat}&longitude=${lng}` +
          `&current=wave_height,sea_surface_temperature`,
        { next: { revalidate: 1800 } }
      ),
    ]);

    const weather = await weatherRes.json();
    const marine = await marineRes.json();

    const cur = weather.current ?? {};
    const daily = weather.daily ?? {};

    return {
      temp:        +(cur.temperature_2m ?? 0).toFixed(1),
      feelsLike:   +(cur.apparent_temperature ?? 0).toFixed(1),
      tempMax:     +(daily.temperature_2m_max?.[0] ?? 0).toFixed(1),
      tempMin:     +(daily.temperature_2m_min?.[0] ?? 0).toFixed(1),
      humidity:    Math.round(cur.relative_humidity_2m ?? 0),
      windSpeed:   Math.round(cur.wind_speed_10m ?? 0),
      windDir:     degreesToDirection(cur.wind_direction_10m ?? 0),
      windDeg:     +(cur.wind_direction_10m ?? 0),
      uvIndex:     +(cur.uv_index ?? 0).toFixed(0),
      cloudCover:  Math.round(cur.cloud_cover ?? 0),
      pressure:    Math.round(cur.surface_pressure ?? 0),
      visibility:  +(((cur.visibility ?? 0) / 1000)).toFixed(1),
      weatherCode: cur.weather_code ?? 0,
      sunrise:     formatTime(daily.sunrise?.[0] ?? ''),
      sunset:      formatTime(daily.sunset?.[0] ?? ''),
      waterTemp:   +(marine.current?.sea_surface_temperature ?? 0).toFixed(1),
      waveHeight:  +(marine.current?.wave_height ?? 0).toFixed(1),
      fetchedAt:   new Date().toISOString(),
    };
  } catch {
    return null;
  }
}
