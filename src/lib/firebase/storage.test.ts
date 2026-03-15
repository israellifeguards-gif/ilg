import { uploadCertificate } from './storage';

jest.mock('browser-image-compression', () =>
  jest.fn(async (file: File) => file)
);

const originalEnv = process.env;

beforeEach(() => {
  jest.resetModules();
  process.env = {
    ...originalEnv,
    NEXT_PUBLIC_CLOUDINARY_CLOUD_NAME: 'test-cloud',
    NEXT_PUBLIC_CLOUDINARY_UPLOAD_PRESET: 'test-preset',
  };
});

afterEach(() => {
  process.env = originalEnv;
  jest.restoreAllMocks();
});

describe('uploadCertificate', () => {
  const mockFile = new File(['test'], 'cert.jpg', { type: 'image/jpeg' });

  test('returns secure_url on successful upload', async () => {
    global.fetch = jest.fn(() =>
      Promise.resolve({
        ok: true,
        json: () => Promise.resolve({ secure_url: 'https://cloudinary.com/cert.jpg' }),
      } as Response)
    );

    const url = await uploadCertificate('uid-1', mockFile);
    expect(url).toBe('https://cloudinary.com/cert.jpg');
  });

  test('calls Cloudinary API with correct cloud name', async () => {
    global.fetch = jest.fn(() =>
      Promise.resolve({
        ok: true,
        json: () => Promise.resolve({ secure_url: 'https://cloudinary.com/cert.jpg' }),
      } as Response)
    );

    await uploadCertificate('uid-1', mockFile);
    expect(global.fetch).toHaveBeenCalledWith(
      expect.stringContaining('test-cloud'),
      expect.objectContaining({ method: 'POST' })
    );
  });

  test('throws when Cloudinary env vars are missing', async () => {
    process.env.NEXT_PUBLIC_CLOUDINARY_CLOUD_NAME = undefined as unknown as string;
    process.env.NEXT_PUBLIC_CLOUDINARY_UPLOAD_PRESET = undefined as unknown as string;

    await expect(uploadCertificate('uid-1', mockFile)).rejects.toThrow(
      'Cloudinary config missing'
    );
  });

  test('throws on failed upload response', async () => {
    global.fetch = jest.fn(() =>
      Promise.resolve({ ok: false } as Response)
    );

    await expect(uploadCertificate('uid-1', mockFile)).rejects.toThrow(
      'Upload failed'
    );
  });

  test('sends FormData with uid and timestamp in public_id', async () => {
    let capturedBody: FormData | undefined;
    global.fetch = jest.fn((_, opts: RequestInit) => {
      capturedBody = opts.body as FormData;
      return Promise.resolve({
        ok: true,
        json: () => Promise.resolve({ secure_url: 'https://cloudinary.com/x.jpg' }),
      } as Response);
    });

    await uploadCertificate('user-42', mockFile);
    expect(capturedBody?.get('upload_preset')).toBe('test-preset');
    expect(capturedBody?.get('folder')).toBe('ilg-certs');
    expect((capturedBody?.get('public_id') as string)).toContain('user-42');
  });
});
