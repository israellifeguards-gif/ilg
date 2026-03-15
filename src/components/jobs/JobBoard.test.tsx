import { render, screen, fireEvent } from '@testing-library/react';
import { JobBoard } from './JobBoard';
import type { Job } from '@/types';

// Mock geolocation
const mockGeolocation = {
  getCurrentPosition: jest.fn((success) =>
    success({ coords: { latitude: 32.08, longitude: 34.78 } })
  ),
};
Object.defineProperty(global.navigator, 'geolocation', {
  value: mockGeolocation,
  configurable: true,
});

const jobs: Job[] = [
  {
    id: '1',
    job_type: 'SOS',
    title: 'מציל דחוף',
    description: 'SOS',
    location: { lat: 32.08, lng: 34.78, label: 'תל אביב' },
    contact: { phone: '+97250' },
    employer_uid: 'e1',
    created_at: new Date().toISOString(),
  },
  {
    id: '2',
    job_type: 'Regular',
    title: 'מציל קיץ',
    description: 'Regular',
    location: { lat: 32.08, lng: 34.78, label: 'חיפה' },
    contact: { phone: '+97251' },
    employer_uid: 'e2',
    created_at: new Date().toISOString(),
  },
];

describe('JobBoard', () => {
  test('renders all jobs by default', () => {
    render(<JobBoard jobs={jobs} />);
    expect(screen.getByText('מציל דחוף')).toBeInTheDocument();
    expect(screen.getByText('מציל קיץ')).toBeInTheDocument();
  });

  test('renders filter buttons', () => {
    render(<JobBoard jobs={jobs} />);
    expect(screen.getByRole('button', { name: 'הכל' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'SOS' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Regular' })).toBeInTheDocument();
  });

  test('SOS filter shows only SOS jobs', () => {
    render(<JobBoard jobs={jobs} />);
    fireEvent.click(screen.getByRole('button', { name: 'SOS' }));
    expect(screen.getByText('מציל דחוף')).toBeInTheDocument();
    expect(screen.queryByText('מציל קיץ')).not.toBeInTheDocument();
  });

  test('Regular filter shows only Regular jobs', () => {
    render(<JobBoard jobs={jobs} />);
    fireEvent.click(screen.getByRole('button', { name: 'Regular' }));
    expect(screen.getByText('מציל קיץ')).toBeInTheDocument();
    expect(screen.queryByText('מציל דחוף')).not.toBeInTheDocument();
  });

  test('All filter restores all jobs', () => {
    render(<JobBoard jobs={jobs} />);
    fireEvent.click(screen.getByRole('button', { name: 'SOS' }));
    fireEvent.click(screen.getByRole('button', { name: 'הכל' }));
    expect(screen.getByText('מציל דחוף')).toBeInTheDocument();
    expect(screen.getByText('מציל קיץ')).toBeInTheDocument();
  });

  test('renders empty state when no jobs match filter', () => {
    render(<JobBoard jobs={[]} />);
    expect(screen.getByText(/אין משרות פתוחות/)).toBeInTheDocument();
  });

  test('renders radius selector', () => {
    render(<JobBoard jobs={jobs} />);
    expect(screen.getByRole('combobox')).toBeInTheDocument();
  });

  test('SOS jobs appear before Regular jobs', () => {
    render(<JobBoard jobs={[jobs[1], jobs[0]]} />);
    const titles = screen.getAllByText(/מציל/);
    expect(titles[0].textContent).toContain('דחוף');
  });
});
