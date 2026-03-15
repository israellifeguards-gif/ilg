import { initializeApp, getApps, getApp } from 'firebase/app';
import { getAuth } from 'firebase/auth';
import { getFirestore } from 'firebase/firestore';

// Firebase is used for Auth (phone SMS) and Firestore (database) only.
// File storage is handled by Cloudinary — see src/lib/firebase/storage.ts
const firebaseConfig = {
  apiKey: process.env.NEXT_PUBLIC_FIREBASE_API_KEY ?? 'PLACEHOLDER',
  authDomain: process.env.NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN ?? 'PLACEHOLDER',
  projectId: process.env.NEXT_PUBLIC_FIREBASE_PROJECT_ID ?? 'PLACEHOLDER',
  messagingSenderId: process.env.NEXT_PUBLIC_FIREBASE_MESSAGING_SENDER_ID ?? 'PLACEHOLDER',
  appId: process.env.NEXT_PUBLIC_FIREBASE_APP_ID ?? 'PLACEHOLDER',
};

const app = getApps().length ? getApp() : initializeApp(firebaseConfig);

export const auth = getAuth(app);
export const db = getFirestore(app);
export default app;
