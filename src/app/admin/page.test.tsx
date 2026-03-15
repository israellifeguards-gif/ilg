import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import AdminPage from './page';

const mockGetPendingUsers = jest.fn(() => Promise.resolve([]));
const mockGetJobs = jest.fn(() => Promise.resolve([]));
const mockSetGlobalAlert = jest.fn(() => Promise.resolve());
const mockDeleteJob = jest.fn(() => Promise.resolve());

jest.mock('@/lib/firebase/config', () => ({ db: {} }));
jest.mock('@/lib/firebase/firestore', () => ({
  getPendingUsers: () => mockGetPendingUsers(),
  getJobs: () => mockGetJobs(),
  setGlobalAlert: (...args: unknown[]) => mockSetGlobalAlert(...args),
  deleteJob: (...args: unknown[]) => mockDeleteJob(...args),
}));
jest.mock('@/components/admin/UserQueue', () => ({
  UserQueue: ({ users }: { users: unknown[] }) => (
    <div data-testid="user-queue">Users: {users.length}</div>
  ),
}));

const PASSWORD = 'ilg-admin-2024';

async function loginAdmin() {
  render(<AdminPage />);
  fireEvent.change(screen.getByPlaceholderText('סיסמת מנהל'), {
    target: { value: PASSWORD },
  });
  fireEvent.click(screen.getByRole('button', { name: 'כניסה' }));
  await waitFor(() => screen.getByText('פאנל ניהול ILG'));
}

describe('AdminPage — login gate', () => {
  test('renders login form initially', () => {
    render(<AdminPage />);
    expect(screen.getByText('כניסת מנהל')).toBeInTheDocument();
  });

  test('wrong password does not grant access', () => {
    render(<AdminPage />);
    fireEvent.change(screen.getByPlaceholderText('סיסמת מנהל'), {
      target: { value: 'wrong' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'כניסה' }));
    expect(screen.queryByText('פאנל ניהול ILG')).not.toBeInTheDocument();
  });

  test('correct password grants access', async () => {
    await loginAdmin();
    expect(screen.getByText('פאנל ניהול ILG')).toBeInTheDocument();
  });

  test('Enter key triggers login', async () => {
    render(<AdminPage />);
    fireEvent.change(screen.getByPlaceholderText('סיסמת מנהל'), {
      target: { value: PASSWORD },
    });
    fireEvent.keyDown(screen.getByPlaceholderText('סיסמת מנהל'), { key: 'Enter' });
    await waitFor(() => screen.getByText('פאנל ניהול ILG'));
  });
});

describe('AdminPage — dashboard', () => {
  beforeEach(() => {
    mockGetPendingUsers.mockResolvedValue([]);
    mockGetJobs.mockResolvedValue([]);
  });

  test('renders global alert section', async () => {
    await loginAdmin();
    expect(screen.getByText(/התראה גלובלית/)).toBeInTheDocument();
  });

  test('renders pending users section', async () => {
    await loginAdmin();
    expect(screen.getByText(/ממתינים לאימות/)).toBeInTheDocument();
  });

  test('renders jobs management section', async () => {
    await loginAdmin();
    expect(screen.getByText(/ניהול משרות/)).toBeInTheDocument();
  });

  test('saves global alert when Save button clicked', async () => {
    await loginAdmin();
    fireEvent.change(screen.getByPlaceholderText(/דגל שחור/), {
      target: { value: 'בדיקה' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'שמור' }));
    await waitFor(() =>
      expect(mockSetGlobalAlert).toHaveBeenCalledWith('בדיקה', false)
    );
  });

  test('shows saved confirmation after saving alert', async () => {
    await loginAdmin();
    fireEvent.click(screen.getByRole('button', { name: 'שמור' }));
    await waitFor(() => expect(screen.getByText('✓ נשמר')).toBeInTheDocument());
  });

  test('renders job list when jobs exist', async () => {
    mockGetJobs.mockResolvedValue([
      {
        id: 'j1',
        job_type: 'Regular',
        title: 'מציל קיץ',
        location: { label: 'תל אביב' },
        created_at: new Date().toISOString(),
      },
    ]);
    await loginAdmin();
    await waitFor(() => expect(screen.getByText('מציל קיץ')).toBeInTheDocument());
  });

  test('delete job button removes job from list', async () => {
    mockGetJobs.mockResolvedValue([
      {
        id: 'j1',
        job_type: 'Regular',
        title: 'מציל קיץ',
        location: { label: 'תל אביב' },
        created_at: new Date().toISOString(),
      },
    ]);
    await loginAdmin();
    await waitFor(() => screen.getByText('מציל קיץ'));
    fireEvent.click(screen.getByText('מחק'));
    await waitFor(() => expect(mockDeleteJob).toHaveBeenCalledWith('j1'));
  });

  test('logout button returns to login screen', async () => {
    await loginAdmin();
    fireEvent.click(screen.getByText('התנתק'));
    expect(screen.getByText('כניסת מנהל')).toBeInTheDocument();
  });

  test('shows empty state when no jobs', async () => {
    await loginAdmin();
    await waitFor(() => expect(screen.getByText(/אין משרות פעילות/)).toBeInTheDocument());
  });
});
