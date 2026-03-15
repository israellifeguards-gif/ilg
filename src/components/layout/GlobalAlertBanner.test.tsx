import { render, screen, act } from '@testing-library/react';
import { GlobalAlertBanner } from './GlobalAlertBanner';
import type { GlobalAlert } from '@/types';

jest.mock('@/lib/firebase/config', () => ({ db: {} }));

let snapshotCallback: ((alert: GlobalAlert | null) => void) | null = null;
const mockUnsub = jest.fn();

jest.mock('@/lib/firebase/firestore', () => ({
  subscribeToGlobalAlert: (cb: (alert: GlobalAlert | null) => void) => {
    snapshotCallback = cb;
    return mockUnsub;
  },
}));

describe('GlobalAlertBanner', () => {
  beforeEach(() => {
    snapshotCallback = null;
    mockUnsub.mockClear();
  });

  test('renders nothing when no alert', () => {
    const { container } = render(<GlobalAlertBanner />);
    act(() => { snapshotCallback?.(null); });
    expect(container.firstChild).toBeNull();
  });

  test('renders nothing when alert is inactive', () => {
    const { container } = render(<GlobalAlertBanner />);
    act(() => {
      snapshotCallback?.({ message: 'Test', active: false, updated_at: '' });
    });
    expect(container.firstChild).toBeNull();
  });

  test('renders nothing when alert has empty message', () => {
    const { container } = render(<GlobalAlertBanner />);
    act(() => {
      snapshotCallback?.({ message: '', active: true, updated_at: '' });
    });
    expect(container.firstChild).toBeNull();
  });

  test('renders alert message when active', () => {
    render(<GlobalAlertBanner />);
    act(() => {
      snapshotCallback?.({ message: 'דגל שחור בחופים', active: true, updated_at: '' });
    });
    expect(screen.getByText(/דגל שחור בחופים/)).toBeInTheDocument();
  });

  test('alert banner has red background', () => {
    render(<GlobalAlertBanner />);
    act(() => {
      snapshotCallback?.({ message: 'Alert!', active: true, updated_at: '' });
    });
    const banner = screen.getByText(/Alert!/).closest('div');
    expect(banner?.className).toContain('bg-[#FF0000]');
  });

  test('calls unsubscribe on unmount', () => {
    const { unmount } = render(<GlobalAlertBanner />);
    unmount();
    expect(mockUnsub).toHaveBeenCalled();
  });
});
