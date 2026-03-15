import { render, screen } from '@testing-library/react';
import DashboardPage from './page';

describe('DashboardPage', () => {
  test('renders page heading', () => {
    render(<DashboardPage />);
    expect(screen.getByText('לוח בקרה')).toBeInTheDocument();
  });

  test('renders weather section heading', () => {
    render(<DashboardPage />);
    expect(screen.getByText('תנאי ים – עדכון אחרון', { exact: false })).toBeInTheDocument();
  });

  test('renders news section heading', () => {
    render(<DashboardPage />);
    expect(screen.getByText(/חדשות וביטחון ים/)).toBeInTheDocument();
  });

  test('renders WeatherWidget with mock data', () => {
    render(<DashboardPage />);
    expect(screen.getByText('1.4m')).toBeInTheDocument();
    expect(screen.getByText('22 km/h')).toBeInTheDocument();
    expect(screen.getByText('23°C')).toBeInTheDocument();
  });

  test('renders mock news items', () => {
    render(<DashboardPage />);
    expect(screen.getByText(/דגל שחור/)).toBeInTheDocument();
  });

  test('renders mock data disclaimer', () => {
    render(<DashboardPage />);
    expect(screen.getByText(/נתוני דמו/)).toBeInTheDocument();
  });
});
