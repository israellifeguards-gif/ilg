import { render, screen } from '@testing-library/react';
import { JobCard } from './JobCard';
import type { Job } from '@/types';

const baseJob: Job = {
  id: '1',
  job_type: 'Regular',
  title: 'מציל קיץ תל אביב',
  description: 'חוף גורדון, 5 ימים בשבוע',
  location: { lat: 32.08, lng: 34.78, label: 'תל אביב – חוף גורדון' },
  contact: { phone: '+972501234567', whatsapp: '+972501234567' },
  employer_uid: 'emp-1',
  created_at: '2024-06-01T00:00:00.000Z',
};

const sosJob: Job = { ...baseJob, id: '2', job_type: 'SOS', title: 'מציל דחוף' };

describe('JobCard', () => {
  test('renders job title', () => {
    render(<JobCard job={baseJob} />);
    expect(screen.getByText('מציל קיץ תל אביב')).toBeInTheDocument();
  });

  test('renders job description', () => {
    render(<JobCard job={baseJob} />);
    expect(screen.getByText('חוף גורדון, 5 ימים בשבוע')).toBeInTheDocument();
  });

  test('renders location label', () => {
    render(<JobCard job={baseJob} />);
    expect(screen.getByText('תל אביב – חוף גורדון')).toBeInTheDocument();
  });

  test('does NOT render SOS badge for Regular job', () => {
    render(<JobCard job={baseJob} />);
    expect(screen.queryByText('SOS')).not.toBeInTheDocument();
  });

  test('renders SOS badge for SOS job', () => {
    render(<JobCard job={sosJob} />);
    expect(screen.getByText('SOS')).toBeInTheDocument();
  });

  test('renders phone call link', () => {
    render(<JobCard job={baseJob} />);
    const phoneLink = screen.getByText(/התקשר/);
    expect(phoneLink.closest('a')).toHaveAttribute('href', 'tel:+972501234567');
  });

  test('renders WhatsApp link when provided', () => {
    render(<JobCard job={baseJob} />);
    const waLink = screen.getByText(/WhatsApp/);
    expect(waLink.closest('a')).toHaveAttribute('href', expect.stringContaining('wa.me'));
  });

  test('does not render WhatsApp link when not provided', () => {
    const jobNoWA: Job = { ...baseJob, contact: { phone: '+972501234567' } };
    render(<JobCard job={jobNoWA} />);
    expect(screen.queryByText(/WhatsApp/)).not.toBeInTheDocument();
  });

  test('renders distance when provided', () => {
    render(<JobCard job={baseJob} distanceKm={5.7} />);
    expect(screen.getByText(/6 ק״מ/)).toBeInTheDocument();
  });

  test('renders "< 1 ק״מ" for distance < 1', () => {
    render(<JobCard job={baseJob} distanceKm={0.4} />);
    expect(screen.getByText(/< 1 ק״מ/)).toBeInTheDocument();
  });

  test('does not render distance section when not provided', () => {
    render(<JobCard job={baseJob} />);
    expect(screen.queryByText(/ק״מ/)).not.toBeInTheDocument();
  });
});
