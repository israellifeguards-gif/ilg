import { render, screen } from '@testing-library/react';
import { WeatherWidget } from './WeatherWidget';
import type { WeatherData } from '@/types';

const baseData: WeatherData = {
  sea_height: 1.4,
  wind_direction: 'NW',
  wind_speed: 22,
  water_temp: 23,
  uv_index: 8,
};

describe('WeatherWidget', () => {
  test('renders sea height', () => {
    render(<WeatherWidget data={baseData} />);
    expect(screen.getByText('1.4m')).toBeInTheDocument();
    expect(screen.getByText('גובה גלים')).toBeInTheDocument();
  });

  test('renders wind speed and direction', () => {
    render(<WeatherWidget data={baseData} />);
    expect(screen.getByText('22 km/h')).toBeInTheDocument();
    expect(screen.getByText(/NW/)).toBeInTheDocument();
  });

  test('renders water temperature', () => {
    render(<WeatherWidget data={baseData} />);
    expect(screen.getByText('23°C')).toBeInTheDocument();
    expect(screen.getByText("טמפ׳ מים")).toBeInTheDocument();
  });

  test('renders UV index value', () => {
    render(<WeatherWidget data={baseData} />);
    expect(screen.getByText('8')).toBeInTheDocument();
  });

  test('UV 8 shows "קיצוני" label', () => {
    render(<WeatherWidget data={baseData} />);
    expect(screen.getByText(/קיצוני/)).toBeInTheDocument();
  });

  test('UV 2 shows "נמוך" label', () => {
    render(<WeatherWidget data={{ ...baseData, uv_index: 2 }} />);
    expect(screen.getByText(/נמוך/)).toBeInTheDocument();
  });

  test('UV 4 shows "בינוני" label', () => {
    render(<WeatherWidget data={{ ...baseData, uv_index: 4 }} />);
    expect(screen.getByText(/בינוני/)).toBeInTheDocument();
  });

  test('UV 6 shows "גבוה" label', () => {
    render(<WeatherWidget data={{ ...baseData, uv_index: 6 }} />);
    expect(screen.getByText(/גבוה/)).toBeInTheDocument();
  });

  test('renders all 4 stat cards', () => {
    const { container } = render(<WeatherWidget data={baseData} />);
    expect(container.querySelectorAll('.border')).toHaveLength(4);
  });
});
