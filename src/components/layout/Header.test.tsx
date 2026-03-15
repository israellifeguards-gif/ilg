import { render, screen } from '@testing-library/react';
import { Header } from './Header';

describe('Header', () => {
  test('renders ILG brand name', () => {
    render(<Header />);
    expect(screen.getByText('ILG')).toBeInTheDocument();
  });

  test('renders dashboard navigation link', () => {
    render(<Header />);
    expect(screen.getByText('לוח בקרה').closest('a')).toHaveAttribute('href', '/dashboard');
  });

  test('renders jobs navigation link', () => {
    render(<Header />);
    expect(screen.getByText('משרות').closest('a')).toHaveAttribute('href', '/jobs');
  });

  test('renders login link', () => {
    render(<Header />);
    expect(screen.getByText('כניסה').closest('a')).toHaveAttribute('href', '/login');
  });

  test('renders register CTA button', () => {
    render(<Header />);
    expect(screen.getByText('הצטרפות').closest('a')).toHaveAttribute('href', '/register');
  });

  test('renders logo image', () => {
    render(<Header />);
    expect(screen.getByAltText('ILG Logo')).toBeInTheDocument();
  });

  test('logo links to home', () => {
    render(<Header />);
    expect(screen.getByAltText('ILG Logo').closest('a')).toHaveAttribute('href', '/');
  });
});
