'use client';

import Link from 'next/link';
import { useEffect, useState } from 'react';
import { onAuthStateChanged } from 'firebase/auth';
import { auth } from '@/lib/firebase/config';
import { getUser } from '@/lib/firebase/firestore';

export function CoursesPostButton() {
  const [isCourses, setIsCourses] = useState(false);

  useEffect(() => {
    const unsub = onAuthStateChanged(auth, async (firebaseUser) => {
      if (!firebaseUser) { setIsCourses(false); return; }
      const user = await getUser(firebaseUser.uid);
      setIsCourses(!!user && (user.role === 'Courses' || user.role === 'Admin') && user.is_verified);
    });
    return () => unsub();
  }, []);

  if (!isCourses) return null;

  return (
    <Link
      href="/courses-portal"
      className="w-full flex items-center justify-center gap-2 py-4 text-lg font-black text-white transition-colors hover:bg-red-700"
      style={{ backgroundColor: '#FF0000' }}
    >
      <span className="text-xl">📋</span>
      פרסם קורס
    </Link>
  );
}
