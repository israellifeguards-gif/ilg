import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { RegisterForm } from './RegisterForm';

const mockPush = jest.fn();

jest.mock('next/navigation', () => ({ useRouter: () => ({ push: mockPush }) }));
jest.mock('@/lib/firebase/config', () => ({ auth: {} }));
jest.mock('@/lib/firebase/storage', () => ({
  uploadCertificate: jest.fn(() => Promise.resolve('https://cloudinary.com/cert.jpg')),
}));
jest.mock('@/lib/firebase/firestore', () => ({
  createUser: jest.fn(() => Promise.resolve()),
}));

const mockCreateUser = jest.fn();
const mockSendVerification = jest.fn(() => Promise.resolve());

jest.mock('firebase/auth', () => ({
  createUserWithEmailAndPassword: (...args: unknown[]) => mockCreateUser(...args),
  sendEmailVerification: (...args: unknown[]) => mockSendVerification(...args),
}));

// Mock fetch for IP lookup
global.fetch = jest.fn(() =>
  Promise.resolve({ json: () => Promise.resolve({ ip: '1.2.3.4' }) } as Response)
);

function fillStep1() {
  fireEvent.change(screen.getByPlaceholderText('ישראל ישראלי'), {
    target: { value: 'Test User' },
  });
  fireEvent.change(screen.getByPlaceholderText('israel@example.com'), {
    target: { value: 'test@example.com' },
  });
  fireEvent.change(screen.getByPlaceholderText('לפחות 6 תווים'), {
    target: { value: 'password123' },
  });
  fireEvent.change(screen.getByPlaceholderText('050-123-4567'), {
    target: { value: '0501234567' },
  });
  fireEvent.click(screen.getByText('מציל/ה'));
}

describe('RegisterForm', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockPush.mockClear();
  });

  test('renders step 1 by default', () => {
    render(<RegisterForm />);
    expect(screen.getByText('פרטים אישיים')).toBeInTheDocument();
  });

  test('step 1 shows error when fields are empty', () => {
    render(<RegisterForm />);
    fireEvent.click(screen.getByText('המשך'));
    expect(screen.getByText('יש למלא את כל השדות')).toBeInTheDocument();
  });

  test('step 1 shows error for short password', () => {
    render(<RegisterForm />);
    fireEvent.change(screen.getByPlaceholderText('ישראל ישראלי'), { target: { value: 'Test' } });
    fireEvent.change(screen.getByPlaceholderText('israel@example.com'), { target: { value: 'a@b.com' } });
    fireEvent.change(screen.getByPlaceholderText('לפחות 6 תווים'), { target: { value: '123' } });
    fireEvent.change(screen.getByPlaceholderText('050-123-4567'), { target: { value: '050' } });
    fireEvent.click(screen.getByText('מציל/ה'));
    fireEvent.click(screen.getByText('המשך'));
    expect(screen.getByText('הסיסמה חייבת להכיל לפחות 6 תווים')).toBeInTheDocument();
  });

  test('role selection highlights selected role', () => {
    render(<RegisterForm />);
    fireEvent.click(screen.getByText('מציל/ה'));
    expect(screen.getByText('מציל/ה')).toHaveClass('bg-[#FF0000]');
  });

  test('advances to step 2 with valid step 1 data', () => {
    render(<RegisterForm />);
    fillStep1();
    fireEvent.click(screen.getByText('המשך'));
    expect(screen.getByText('העלאת תעודה')).toBeInTheDocument();
  });

  test('step 2 back button returns to step 1', () => {
    render(<RegisterForm />);
    fillStep1();
    fireEvent.click(screen.getByText('המשך'));
    fireEvent.click(screen.getByText('חזור'));
    expect(screen.getByText('פרטים אישיים')).toBeInTheDocument();
  });

  test('step 2 shows error when no file uploaded', () => {
    render(<RegisterForm />);
    fillStep1();
    fireEvent.click(screen.getByText('המשך'));
    fireEvent.click(screen.getByText('המשך'));
    expect(screen.getByText('יש להעלות תמונה של התעודה')).toBeInTheDocument();
  });

  test('advances to step 3 after file upload', async () => {
    render(<RegisterForm />);
    fillStep1();
    fireEvent.click(screen.getByText('המשך'));

    const file = new File(['img'], 'cert.jpg', { type: 'image/jpeg' });
    const input = document.querySelector('input[type="file"]') as HTMLInputElement;
    fireEvent.change(input, { target: { files: [file] } });
    fireEvent.click(screen.getByText('המשך'));

    await waitFor(() => expect(screen.getByText('תנאי שימוש')).toBeInTheDocument());
  });

  test('step 3 submit button is disabled without consent', async () => {
    render(<RegisterForm />);
    fillStep1();
    fireEvent.click(screen.getByText('המשך'));

    const file = new File(['img'], 'cert.jpg', { type: 'image/jpeg' });
    const input = document.querySelector('input[type="file"]') as HTMLInputElement;
    fireEvent.change(input, { target: { files: [file] } });
    fireEvent.click(screen.getByText('המשך'));

    await waitFor(() => screen.getByText('תנאי שימוש'));
    expect(screen.getByText('הצטרפות')).toBeDisabled();
  });

  test('submit button enabled after checking consent', async () => {
    render(<RegisterForm />);
    fillStep1();
    fireEvent.click(screen.getByText('המשך'));

    const file = new File(['img'], 'cert.jpg', { type: 'image/jpeg' });
    const input = document.querySelector('input[type="file"]') as HTMLInputElement;
    fireEvent.change(input, { target: { files: [file] } });
    fireEvent.click(screen.getByText('המשך'));

    await waitFor(() => screen.getByText('תנאי שימוש'));
    fireEvent.click(screen.getByRole('checkbox'));
    expect(screen.getByText('הצטרפות')).not.toBeDisabled();
  });

  test('successful registration redirects to /pending', async () => {
    mockCreateUser.mockResolvedValueOnce({ user: { uid: 'uid-1' } });

    render(<RegisterForm />);
    fillStep1();
    fireEvent.click(screen.getByText('המשך'));

    const file = new File(['img'], 'cert.jpg', { type: 'image/jpeg' });
    const input = document.querySelector('input[type="file"]') as HTMLInputElement;
    fireEvent.change(input, { target: { files: [file] } });
    fireEvent.click(screen.getByText('המשך'));

    await waitFor(() => screen.getByText('תנאי שימוש'));
    fireEvent.click(screen.getByRole('checkbox'));
    fireEvent.click(screen.getByText('הצטרפות'));

    await waitFor(() => expect(mockPush).toHaveBeenCalledWith('/pending'));
  });

  test('shows error for email already in use', async () => {
    const error = Object.assign(new Error(), { code: 'auth/email-already-in-use' });
    mockCreateUser.mockRejectedValueOnce(error);

    render(<RegisterForm />);
    fillStep1();
    fireEvent.click(screen.getByText('המשך'));

    const file = new File(['img'], 'cert.jpg', { type: 'image/jpeg' });
    const input = document.querySelector('input[type="file"]') as HTMLInputElement;
    fireEvent.change(input, { target: { files: [file] } });
    fireEvent.click(screen.getByText('המשך'));

    await waitFor(() => screen.getByText('תנאי שימוש'));
    fireEvent.click(screen.getByRole('checkbox'));
    fireEvent.click(screen.getByText('הצטרפות'));

    await waitFor(() =>
      expect(screen.getByText('כתובת המייל כבר רשומה במערכת.')).toBeInTheDocument()
    );
  });

  test('shows error for weak password', async () => {
    const error = Object.assign(new Error(), { code: 'auth/weak-password' });
    mockCreateUser.mockRejectedValueOnce(error);

    render(<RegisterForm />);
    fillStep1();
    fireEvent.click(screen.getByText('המשך'));

    const file = new File(['img'], 'cert.jpg', { type: 'image/jpeg' });
    const input = document.querySelector('input[type="file"]') as HTMLInputElement;
    fireEvent.change(input, { target: { files: [file] } });
    fireEvent.click(screen.getByText('המשך'));

    await waitFor(() => screen.getByText('תנאי שימוש'));
    fireEvent.click(screen.getByRole('checkbox'));
    fireEvent.click(screen.getByText('הצטרפות'));

    await waitFor(() =>
      expect(screen.getByText('הסיסמה חייבת להכיל לפחות 6 תווים.')).toBeInTheDocument()
    );
  });

  test('shows generic error for unknown error', async () => {
    const error = Object.assign(new Error(), { code: 'auth/unknown' });
    mockCreateUser.mockRejectedValueOnce(error);

    render(<RegisterForm />);
    fillStep1();
    fireEvent.click(screen.getByText('המשך'));

    const file = new File(['img'], 'cert.jpg', { type: 'image/jpeg' });
    const input = document.querySelector('input[type="file"]') as HTMLInputElement;
    fireEvent.change(input, { target: { files: [file] } });
    fireEvent.click(screen.getByText('המשך'));

    await waitFor(() => screen.getByText('תנאי שימוש'));
    fireEvent.click(screen.getByRole('checkbox'));
    fireEvent.click(screen.getByText('הצטרפות'));

    await waitFor(() =>
      expect(screen.getByText('אירעה שגיאה. נסה שוב.')).toBeInTheDocument()
    );
  });
});
