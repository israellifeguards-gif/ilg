import imageCompression from 'browser-image-compression';

const COMPRESSION_OPTIONS = {
  maxSizeMB: 0.5,
  maxWidthOrHeight: 1200,
  useWebWorker: true,
};

/**
 * Compresses the image client-side, then uploads to Cloudinary.
 * Returns the secure URL to store in Firestore.
 */
export async function uploadCertificate(uid: string, file: File): Promise<string> {
  const cloudName = process.env.NEXT_PUBLIC_CLOUDINARY_CLOUD_NAME;
  const uploadPreset = process.env.NEXT_PUBLIC_CLOUDINARY_UPLOAD_PRESET;

  if (!cloudName || !uploadPreset) {
    throw new Error('Cloudinary config missing. Check .env.local');
  }

  const compressed = await imageCompression(file, COMPRESSION_OPTIONS);

  const formData = new FormData();
  formData.append('file', compressed);
  formData.append('upload_preset', uploadPreset);
  formData.append('folder', 'ilg-certs');
  formData.append('public_id', `${uid}_${Date.now()}`);

  const res = await fetch(
    `https://api.cloudinary.com/v1_1/${cloudName}/image/upload`,
    { method: 'POST', body: formData }
  );

  if (!res.ok) {
    throw new Error('Upload failed. Check your Cloudinary preset settings.');
  }

  const data = await res.json();
  return data.secure_url as string;
}
