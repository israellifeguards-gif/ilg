import { render, screen } from '@testing-library/react';
import { MobileNav } from './MobileNav';

describe('MobileNav', () => {
  test('renders dashboard link', () => {
    render(<MobileNav />);
    expect(screen.getByText('בקרה').closest('a')).toHaveAttribute('href', '/dashboard');
  });

  test('renders jobs link', () => {
    render(<MobileNav />);
    expect(screen.getByText('משרות').closest('a')).toHaveAttribute('href', '/jobs');
  });

  test('renders register link', () => {
    render(<MobileNav />);
    expect(screen.getByText('הצטרף').closest('a')).toHaveAttribute('href', '/register');
  });

  test('renders admin link', () => {
    render(<MobileNav />);
    expect(screen.getByText('ניהול').closest('a')).toHaveAttribute('href', '/admin');
  });

  test('renders logo linking to home', () => {
    render(<MobileNav />);
    expect(screen.getByAltText('ILG').closest('a')).toHaveAttribute('href', '/');
  });
});
