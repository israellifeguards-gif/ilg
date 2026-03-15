import { render, screen } from '@testing-library/react';
import LandingPage from './page';

jest.mock('next/navigation', () => ({ useRouter: () => ({ push: jest.fn() }) }));

describe('LandingPage', () => {
  test('renders main headline', () => {
    render(<LandingPage />);
    expect(screen.getByText(/הבית החדש של המצילים בישראל/)).toBeInTheDocument();
  });

  test('renders ILG brand name', () => {
    render(<LandingPage />);
    expect(screen.getByText('ILG')).toBeInTheDocument();
  });

  test('renders sub-headline', () => {
    render(<LandingPage />);
    expect(screen.getByText(/מקום לאנשי המים/)).toBeInTheDocument();
  });

  test('renders CTA button linking to /register', () => {
    render(<LandingPage />);
    const cta = screen.getByText('הצטרפות לקהילה');
    expect(cta.closest('a')).toHaveAttribute('href', '/register');
  });

  test('renders all 4 feature cards', () => {
    render(<LandingPage />);
    expect(screen.getByText('לוח בקרה')).toBeInTheDocument();
    expect(screen.getByText('לוח משרות')).toBeInTheDocument();
    expect(screen.getByText('SOS')).toBeInTheDocument();
    expect(screen.getByText('קהילה מאומתת')).toBeInTheDocument();
  });

  test('renders feature descriptions', () => {
    render(<LandingPage />);
    expect(screen.getByText('מזג אוויר ים בזמן אמת')).toBeInTheDocument();
  });

  test('renders logo image', () => {
    render(<LandingPage />);
    expect(screen.getByAltText('ILG Logo')).toBeInTheDocument();
  });
});
