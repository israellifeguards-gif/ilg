import {
  createUser,
  getUser,
  updateUser,
  getPendingUsers,
  createJob,
  deleteJob,
  setGlobalAlert,
  subscribeToGlobalAlert,
} from './firestore';

const mockSetDoc = jest.fn(() => Promise.resolve());
const mockGetDoc = jest.fn();
const mockUpdateDoc = jest.fn(() => Promise.resolve());
const mockGetDocs = jest.fn();
const mockDeleteDoc = jest.fn(() => Promise.resolve());
const mockOnSnapshot = jest.fn(() => jest.fn());
const mockDocRef = { id: 'mock-id' };

jest.mock('./config', () => ({ db: {} }));

jest.mock('firebase/firestore', () => ({
  doc: jest.fn(() => mockDocRef),
  setDoc: (...args: unknown[]) => mockSetDoc(...args),
  getDoc: (...args: unknown[]) => mockGetDoc(...args),
  updateDoc: (...args: unknown[]) => mockUpdateDoc(...args),
  collection: jest.fn(() => ({})),
  query: jest.fn(() => ({})),
  where: jest.fn(() => ({})),
  getDocs: (...args: unknown[]) => mockGetDocs(...args),
  orderBy: jest.fn(() => ({})),
  deleteDoc: (...args: unknown[]) => mockDeleteDoc(...args),
  onSnapshot: (...args: unknown[]) => mockOnSnapshot(...args),
}));

const mockUser = {
  uid: 'uid-1',
  displayName: 'Test User',
  phone: '0501234567',
  role: 'Lifeguard' as const,
  certification_url: 'https://example.com/cert.jpg',
  is_verified: false,
  sos_active: false,
  radius_pref: 0,
  consent_timestamp: '2024-01-01T00:00:00.000Z',
  ip_address: '1.2.3.4',
  created_at: '2024-01-01T00:00:00.000Z',
};

describe('createUser', () => {
  test('calls setDoc with uid and data', async () => {
    await createUser('uid-1', mockUser);
    expect(mockSetDoc).toHaveBeenCalledWith(
      mockDocRef,
      expect.objectContaining({ uid: 'uid-1', displayName: 'Test User' })
    );
  });
});

describe('getUser', () => {
  test('returns user when document exists', async () => {
    mockGetDoc.mockResolvedValueOnce({ exists: () => true, data: () => mockUser });
    const user = await getUser('uid-1');
    expect(user).toEqual(mockUser);
  });

  test('returns null when document does not exist', async () => {
    mockGetDoc.mockResolvedValueOnce({ exists: () => false });
    const user = await getUser('uid-1');
    expect(user).toBeNull();
  });
});

describe('updateUser', () => {
  test('calls updateDoc with partial data', async () => {
    await updateUser('uid-1', { is_verified: true });
    expect(mockUpdateDoc).toHaveBeenCalledWith(
      mockDocRef,
      expect.objectContaining({ is_verified: true })
    );
  });
});

describe('getPendingUsers', () => {
  test('returns unverified users', async () => {
    mockGetDocs.mockResolvedValueOnce({
      docs: [{ data: () => mockUser }, { data: () => ({ ...mockUser, uid: 'uid-2' }) }],
    });
    const users = await getPendingUsers();
    expect(users).toHaveLength(2);
  });

  test('returns empty array when no pending users', async () => {
    mockGetDocs.mockResolvedValueOnce({ docs: [] });
    const users = await getPendingUsers();
    expect(users).toHaveLength(0);
  });
});

describe('createJob', () => {
  test('returns generated job id', async () => {
    const job = {
      job_type: 'SOS' as const,
      title: 'Test Job',
      description: 'desc',
      location: { lat: 32, lng: 34, label: 'TLV' },
      contact: { phone: '050' },
      employer_uid: 'emp-1',
      created_at: '2024-01-01',
    };
    const id = await createJob(job);
    expect(id).toBe('mock-id');
    expect(mockSetDoc).toHaveBeenCalled();
  });
});

describe('deleteJob', () => {
  test('calls deleteDoc with job id', async () => {
    await deleteJob('job-1');
    expect(mockDeleteDoc).toHaveBeenCalledWith(mockDocRef);
  });
});

describe('setGlobalAlert', () => {
  test('saves alert to Firestore', async () => {
    await setGlobalAlert('Test alert', true);
    expect(mockSetDoc).toHaveBeenCalledWith(
      mockDocRef,
      expect.objectContaining({ message: 'Test alert', active: true })
    );
  });

  test('includes updated_at timestamp', async () => {
    await setGlobalAlert('Test', false);
    expect(mockSetDoc).toHaveBeenCalledWith(
      mockDocRef,
      expect.objectContaining({ active: false, updated_at: expect.any(String) })
    );
  });
});

describe('subscribeToGlobalAlert', () => {
  test('calls onSnapshot and returns unsubscribe function', () => {
    const cb = jest.fn();
    const unsub = subscribeToGlobalAlert(cb);
    expect(mockOnSnapshot).toHaveBeenCalled();
    expect(typeof unsub).toBe('function');
  });
});
