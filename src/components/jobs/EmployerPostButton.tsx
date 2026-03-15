'use client';

import Link from 'next/link';
import { useEffect, useState } from 'react';
import { onAuthStateChanged } from 'firebase/auth';
import { auth } from '@/lib/firebase/config';
import { getUser } from '@/lib/firebase/firestore';

export function EmployerPostButton() {
  const [isEmployer, setIsEmployer] = useState(false);

  useEffect(() => {
    const unsub = onAuthStateChanged(auth, async (firebaseUser) => {
      if (!firebaseUser) { setIsEmployer(false); return; }
      const user = await getUser(firebaseUser.uid);
      setIsEmployer(!!user && (user.role === 'Employer' || user.role === 'Admin') && user.is_verified);
    });
    return () => unsub();
  }, []);

  if (!isEmployer) return null;

  return (
    <Link
      href="/employer"
      className="w-full flex items-center justify-center gap-2 py-4 text-lg font-black text-white transition-colors hover:bg-red-700"
      style={{ backgroundColor: '#FF0000' }}
    >
      <span className="text-xl">📋</span>
      פרסם מודעה
    </Link>
  );
}
