import {
  doc,
  setDoc,
  getDoc,
  updateDoc,
  collection,
  query,
  where,
  getDocs,
  orderBy,
  deleteDoc,
  onSnapshot,
  Unsubscribe,
} from 'firebase/firestore';
import { db } from './config';
import type { ILGUser, Job, Course, GlobalAlert, AdminUpdate } from '@/types';

// ── Users ────────────────────────────────────────────────────────────────────

export async function createUser(uid: string, data: Omit<ILGUser, 'uid'>): Promise<void> {
  await setDoc(doc(db, 'users', uid), { uid, ...data });
}

export async function getUser(uid: string): Promise<ILGUser | null> {
  const snap = await getDoc(doc(db, 'users', uid));
  return snap.exists() ? (snap.data() as ILGUser) : null;
}

export async function updateUser(uid: string, data: Partial<ILGUser>): Promise<void> {
  await updateDoc(doc(db, 'users', uid), data);
}

export async function deleteUser(uid: string): Promise<void> {
  await deleteDoc(doc(db, 'users', uid));
}

export async function getPendingUsers(): Promise<ILGUser[]> {
  const q = query(collection(db, 'users'), where('is_verified', '==', false));
  const snap = await getDocs(q);
  return snap.docs.map((d) => d.data() as ILGUser);
}

// ── Jobs ─────────────────────────────────────────────────────────────────────

export async function createJob(job: Omit<Job, 'id'>): Promise<string> {
  const ref = doc(collection(db, 'jobs'));
  await setDoc(ref, { id: ref.id, ...job });
  return ref.id;
}

export async function getJobs(): Promise<Job[]> {
  const q = query(collection(db, 'jobs'), orderBy('created_at', 'desc'));
  const snap = await getDocs(q);
  return snap.docs.map((d) => d.data() as Job);
}

export async function deleteJob(jobId: string): Promise<void> {
  await deleteDoc(doc(db, 'jobs', jobId));
}

export async function updateJob(jobId: string, data: Partial<Omit<Job, 'id' | 'employer_uid' | 'created_at'>>): Promise<void> {
  await updateDoc(doc(db, 'jobs', jobId), data);
}

// ── Courses ───────────────────────────────────────────────────────────────────

export async function createCourse(course: Omit<Course, 'id'>): Promise<string> {
  const ref = doc(collection(db, 'courses'));
  await setDoc(ref, { id: ref.id, ...course });
  return ref.id;
}

export async function getCourses(): Promise<Course[]> {
  const q = query(collection(db, 'courses'), orderBy('created_at', 'desc'));
  const snap = await getDocs(q);
  return snap.docs.map((d) => d.data() as Course);
}

export async function deleteCourse(courseId: string): Promise<void> {
  await deleteDoc(doc(db, 'courses', courseId));
}

export async function updateCourse(courseId: string, data: Partial<Omit<Course, 'id' | 'publisher_uid' | 'created_at'>>): Promise<void> {
  await updateDoc(doc(db, 'courses', courseId), data);
}

// ── Global Alert ──────────────────────────────────────────────────────────────

export function subscribeToGlobalAlert(cb: (alert: GlobalAlert | null) => void): Unsubscribe {
  return onSnapshot(doc(db, 'config', 'global_alert'), (snap) => {
    cb(snap.exists() ? (snap.data() as GlobalAlert) : null);
  });
}

export async function setGlobalAlert(message: string, active: boolean): Promise<void> {
  await setDoc(doc(db, 'config', 'global_alert'), {
    message,
    active,
    updated_at: new Date().toISOString(),
  });
}

// ── Admin Updates ─────────────────────────────────────────────────────────────

export async function createAdminUpdate(data: { title: string; content: string }): Promise<string> {
  const ref = doc(collection(db, 'admin_updates'));
  await setDoc(ref, { id: ref.id, ...data, created_at: new Date().toISOString() });
  return ref.id;
}

export async function getAdminUpdates(): Promise<AdminUpdate[]> {
  const q = query(collection(db, 'admin_updates'), orderBy('created_at', 'desc'));
  const snap = await getDocs(q);
  return snap.docs.map((d) => d.data() as AdminUpdate);
}

export async function deleteAdminUpdate(id: string): Promise<void> {
  await deleteDoc(doc(db, 'admin_updates', id));
}
