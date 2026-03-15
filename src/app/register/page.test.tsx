import { render, screen } from '@testing-library/react';
import RegisterPage from './page';

jest.mock('next/navigation', () => ({ useRouter: () => ({ push: jest.fn() }) }));
jest.mock('@/lib/firebase/config', () => ({ auth: {} }));
jest.mock('firebase/auth', () => ({
  createUserWithEmailAndPassword: jest.fn(),
  sendEmailVerification: jest.fn(),
}));
jest.mock('@/lib/firebase/firestore', () => ({ createUser: jest.fn() }));
jest.mock('@/lib/firebase/storage', () => ({ uploadCertificate: jest.fn() }));

describe('RegisterPage', () => {
  test('renders the registration form', () => {
    render(<RegisterPage />);
    expect(screen.getByText('פרטים אישיים')).toBeInTheDocument();
  });

  test('renders the progress bar', () => {
    const { container } = render(<RegisterPage />);
    expect(container.querySelectorAll('.bg-\\[\\#FF0000\\]').length).toBeGreaterThanOrEqual(1);
  });
});
