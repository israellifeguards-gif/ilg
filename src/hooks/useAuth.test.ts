import { renderHook, act } from '@testing-library/react';
import { useAuth } from './useAuth';

jest.mock('@/lib/firebase/config', () => ({ auth: {} }));

const mockGetUser = jest.fn();
jest.mock('@/lib/firebase/firestore', () => ({
  getUser: (...args: unknown[]) => mockGetUser(...args),
}));

let authCallback: ((user: { uid: string } | null) => void) | null = null;

jest.mock('firebase/auth', () => ({
  onAuthStateChanged: (_auth: unknown, cb: (user: { uid: string } | null) => void) => {
    authCallback = cb;
    return jest.fn(); // unsub
  },
}));

describe('useAuth', () => {
  beforeEach(() => {
    authCallback = null;
    mockGetUser.mockReset();
  });

  test('starts with loading: true', () => {
    const { result } = renderHook(() => useAuth());
    expect(result.current.loading).toBe(true);
  });

  test('returns null user when not authenticated', async () => {
    const { result } = renderHook(() => useAuth());
    await act(async () => { authCallback?.(null); });
    expect(result.current.firebaseUser).toBeNull();
    expect(result.current.ilgUser).toBeNull();
    expect(result.current.loading).toBe(false);
  });

  test('fetches ILG user when Firebase user is present', async () => {
    const mockILGUser = { uid: 'uid-1', displayName: 'Test' };
    mockGetUser.mockResolvedValueOnce(mockILGUser);

    const { result } = renderHook(() => useAuth());
    await act(async () => { authCallback?.({ uid: 'uid-1' }); });

    expect(mockGetUser).toHaveBeenCalledWith('uid-1');
    expect(result.current.ilgUser).toEqual(mockILGUser);
    expect(result.current.loading).toBe(false);
  });

  test('sets firebaseUser when authenticated', async () => {
    mockGetUser.mockResolvedValueOnce(null);
    const { result } = renderHook(() => useAuth());
    await act(async () => { authCallback?.({ uid: 'uid-42' }); });
    expect(result.current.firebaseUser).toEqual({ uid: 'uid-42' });
  });
});
