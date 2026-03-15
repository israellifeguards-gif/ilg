import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import LoginPage from './page';

const mockPush = jest.fn();
jest.mock('next/navigation', () => ({ useRouter: () => ({ push: mockPush }) }));
jest.mock('@/lib/firebase/config', () => ({ auth: {} }));

const mockSignIn = jest.fn();
jest.mock('firebase/auth', () => ({
  signInWithEmailAndPassword: (...args: unknown[]) => mockSignIn(...args),
}));

describe('LoginPage', () => {
  beforeEach(() => jest.clearAllMocks());

  test('renders email and password fields', () => {
    render(<LoginPage />);
    expect(screen.getByPlaceholderText('israel@example.com')).toBeInTheDocument();
    expect(screen.getByPlaceholderText('••••••')).toBeInTheDocument();
  });

  test('renders login button', () => {
    render(<LoginPage />);
    expect(screen.getByRole('button', { name: 'כניסה' })).toBeInTheDocument();
  });

  test('renders link to register page', () => {
    render(<LoginPage />);
    expect(screen.getByText('הצטרפות לקהילה')).toBeInTheDocument();
  });

  test('shows error when fields are empty', () => {
    render(<LoginPage />);
    fireEvent.click(screen.getByRole('button', { name: 'כניסה' }));
    expect(screen.getByText('יש למלא מייל וסיסמה')).toBeInTheDocument();
  });

  test('calls signInWithEmailAndPassword with correct credentials', async () => {
    mockSignIn.mockResolvedValueOnce({ user: { uid: 'uid-1' } });
    render(<LoginPage />);
    fireEvent.change(screen.getByPlaceholderText('israel@example.com'), {
      target: { value: 'test@example.com' },
    });
    fireEvent.change(screen.getByPlaceholderText('••••••'), {
      target: { value: 'password123' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'כניסה' }));
    await waitFor(() => expect(mockSignIn).toHaveBeenCalledWith({}, 'test@example.com', 'password123'));
  });

  test('navigates to /dashboard on successful login', async () => {
    mockSignIn.mockResolvedValueOnce({ user: { uid: 'uid-1' } });
    render(<LoginPage />);
    fireEvent.change(screen.getByPlaceholderText('israel@example.com'), {
      target: { value: 'test@example.com' },
    });
    fireEvent.change(screen.getByPlaceholderText('••••••'), {
      target: { value: 'password123' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'כניסה' }));
    await waitFor(() => expect(mockPush).toHaveBeenCalledWith('/dashboard'));
  });

  test('shows error for wrong password', async () => {
    const error = Object.assign(new Error(), { code: 'auth/invalid-credential' });
    mockSignIn.mockRejectedValueOnce(error);
    render(<LoginPage />);
    fireEvent.change(screen.getByPlaceholderText('israel@example.com'), {
      target: { value: 'test@example.com' },
    });
    fireEvent.change(screen.getByPlaceholderText('••••••'), {
      target: { value: 'wrongpass' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'כניסה' }));
    await waitFor(() =>
      expect(screen.getByText('מייל או סיסמה שגויים.')).toBeInTheDocument()
    );
  });

  test('shows generic error for unknown error', async () => {
    const error = Object.assign(new Error(), { code: 'auth/network-request-failed' });
    mockSignIn.mockRejectedValueOnce(error);
    render(<LoginPage />);
    fireEvent.change(screen.getByPlaceholderText('israel@example.com'), {
      target: { value: 'test@example.com' },
    });
    fireEvent.change(screen.getByPlaceholderText('••••••'), {
      target: { value: 'password' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'כניסה' }));
    await waitFor(() =>
      expect(screen.getByText('אירעה שגיאה. נסה שוב.')).toBeInTheDocument()
    );
  });

  test('login triggered by Enter key on password field', async () => {
    mockSignIn.mockResolvedValueOnce({ user: { uid: 'uid-1' } });
    render(<LoginPage />);
    fireEvent.change(screen.getByPlaceholderText('israel@example.com'), {
      target: { value: 'test@example.com' },
    });
    fireEvent.change(screen.getByPlaceholderText('••••••'), {
      target: { value: 'password123' },
    });
    fireEvent.keyDown(screen.getByPlaceholderText('••••••'), { key: 'Enter' });
    await waitFor(() => expect(mockSignIn).toHaveBeenCalled());
  });
});
