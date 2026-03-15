import { render, screen } from '@testing-library/react';
import JobsPage from './page';

const mockGeolocation = {
  getCurrentPosition: jest.fn((success) =>
    success({ coords: { latitude: 32.08, longitude: 34.78 } })
  ),
};
Object.defineProperty(global.navigator, 'geolocation', {
  value: mockGeolocation,
  configurable: true,
});

describe('JobsPage', () => {
  test('renders page heading', () => {
    render(<JobsPage />);
    expect(screen.getByText('לוח משרות')).toBeInTheDocument();
  });

  test('renders page sub-heading', () => {
    render(<JobsPage />);
    expect(screen.getByText(/משרות מצילים ברחבי ישראל/)).toBeInTheDocument();
  });

  test('renders mock SOS job', () => {
    render(<JobsPage />);
    expect(screen.getByText('מציל דחוף – חוף הכרמל')).toBeInTheDocument();
  });

  test('renders mock Regular jobs', () => {
    render(<JobsPage />);
    expect(screen.getByText('מציל לעונת הקיץ – תל אביב')).toBeInTheDocument();
    expect(screen.getByText('מציל לאירועים – אילת')).toBeInTheDocument();
  });

  test('renders job filter buttons', () => {
    render(<JobsPage />);
    expect(screen.getByRole('button', { name: 'הכל' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'SOS' })).toBeInTheDocument();
  });
});
