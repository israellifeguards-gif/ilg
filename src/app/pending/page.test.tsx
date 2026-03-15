import { render, screen } from '@testing-library/react';
import PendingPage from './page';

describe('PendingPage', () => {
  test('renders welcome headline', () => {
    render(<PendingPage />);
    expect(screen.getByText('ברוך הבא ל-ILG!')).toBeInTheDocument();
  });

  test('tells user to check email', () => {
    render(<PendingPage />);
    expect(screen.getByText(/שלחנו לך מייל אימות/)).toBeInTheDocument();
  });

  test('renders all 3 steps', () => {
    render(<PendingPage />);
    expect(screen.getByText('1.')).toBeInTheDocument();
    expect(screen.getByText('2.')).toBeInTheDocument();
    expect(screen.getByText('3.')).toBeInTheDocument();
  });

  test('mentions certificate review', () => {
    render(<PendingPage />);
    expect(screen.getByText(/תעודת ההצלה שלך נמצאת בבדיקה/)).toBeInTheDocument();
  });

  test('mentions spam folder tip', () => {
    render(<PendingPage />);
    expect(screen.getByText(/ספאם/)).toBeInTheDocument();
  });
});
