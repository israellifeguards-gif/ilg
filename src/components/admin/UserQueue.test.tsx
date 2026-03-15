import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { UserQueue } from './UserQueue';
import type { ILGUser } from '@/types';

const mockUpdateUser = jest.fn(() => Promise.resolve());
jest.mock('@/lib/firebase/firestore', () => ({ updateUser: (...args: unknown[]) => mockUpdateUser(...args) }));
jest.mock('@/lib/firebase/config', () => ({ db: {} }));

const mockUser: ILGUser = {
  uid: 'uid-1',
  displayName: 'דן כהן',
  phone: '0501234567',
  role: 'Lifeguard',
  certification_url: 'https://example.com/cert.jpg',
  is_verified: false,
  sos_active: false,
  radius_pref: 0,
  consent_timestamp: '2024-01-01T00:00:00.000Z',
  ip_address: '1.2.3.4',
  created_at: '2024-01-01T00:00:00.000Z',
};

describe('UserQueue', () => {
  beforeEach(() => jest.clearAllMocks());

  test('renders empty state when no users', () => {
    render(<UserQueue users={[]} onUpdate={jest.fn()} />);
    expect(screen.getByText(/אין משתמשים ממתינים/)).toBeInTheDocument();
  });

  test('renders user display name', () => {
    render(<UserQueue users={[mockUser]} onUpdate={jest.fn()} />);
    expect(screen.getByText('דן כהן')).toBeInTheDocument();
  });

  test('renders user phone', () => {
    render(<UserQueue users={[mockUser]} onUpdate={jest.fn()} />);
    expect(screen.getByText('0501234567')).toBeInTheDocument();
  });

  test('renders role label in Hebrew', () => {
    render(<UserQueue users={[mockUser]} onUpdate={jest.fn()} />);
    expect(screen.getByText('מציל/ה')).toBeInTheDocument();
  });

  test('renders Employer role label', () => {
    render(<UserQueue users={[{ ...mockUser, role: 'Employer' }]} onUpdate={jest.fn()} />);
    expect(screen.getByText('מעסיק/ה')).toBeInTheDocument();
  });

  test('renders certificate thumbnail when url provided', () => {
    render(<UserQueue users={[mockUser]} onUpdate={jest.fn()} />);
    const img = screen.getByAltText('תעודה') as HTMLImageElement;
    expect(img.src).toContain('cert.jpg');
  });

  test('renders no image placeholder when no cert url', () => {
    render(<UserQueue users={[{ ...mockUser, certification_url: null }]} onUpdate={jest.fn()} />);
    expect(screen.getByText('אין')).toBeInTheDocument();
  });

  test('approve button calls updateUser with is_verified: true', async () => {
    const onUpdate = jest.fn();
    render(<UserQueue users={[mockUser]} onUpdate={onUpdate} />);
    fireEvent.click(screen.getByText(/אשר/));
    await waitFor(() =>
      expect(mockUpdateUser).toHaveBeenCalledWith('uid-1', { is_verified: true })
    );
  });

  test('approve calls onUpdate callback', async () => {
    const onUpdate = jest.fn();
    render(<UserQueue users={[mockUser]} onUpdate={onUpdate} />);
    fireEvent.click(screen.getByText(/אשר/));
    await waitFor(() => expect(onUpdate).toHaveBeenCalled());
  });

  test('reject button calls updateUser with is_verified: false', async () => {
    const onUpdate = jest.fn();
    render(<UserQueue users={[mockUser]} onUpdate={onUpdate} />);
    fireEvent.click(screen.getByText(/דחה/));
    await waitFor(() =>
      expect(mockUpdateUser).toHaveBeenCalledWith('uid-1', {
        is_verified: false,
        certification_url: null,
      })
    );
  });

  test('renders multiple users', () => {
    const users = [
      mockUser,
      { ...mockUser, uid: 'uid-2', displayName: 'שרה לוי' },
    ];
    render(<UserQueue users={users} onUpdate={jest.fn()} />);
    expect(screen.getByText('דן כהן')).toBeInTheDocument();
    expect(screen.getByText('שרה לוי')).toBeInTheDocument();
  });
});
