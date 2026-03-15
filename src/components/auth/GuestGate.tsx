'use client';

import { useEffect, useState } from 'react';
import { onAuthStateChanged } from 'firebase/auth';
import { auth } from '@/lib/firebase/config';
import { getUser } from '@/lib/firebase/firestore';
import Link from 'next/link';

interface Props {
  children: React.ReactNode;
  title?: string; // section name shown in the locked message
}

export function GuestGate({ children, title = 'אזור זה' }: Props) {
  const [status, setStatus] = useState<'loading' | 'guest' | 'pending' | 'approved'>('loading');

  useEffect(() => {
    const unsub = onAuthStateChanged(auth, async (firebaseUser) => {
      if (!firebaseUser) { setStatus('guest'); return; }
      const user = await getUser(firebaseUser.uid);
      if (!user) { setStatus('guest'); return; }
      setStatus(user.is_verified ? 'approved' : 'pending');
    });
    return () => unsub();
  }, []);

  if (status === 'loading') {
    return (
      <div className="min-h-[60vh] flex items-center justify-center">
        <div className="w-8 h-8 border-4 border-black border-t-transparent rounded-full animate-spin" />
      </div>
    );
  }

  if (status === 'approved') return <>{children}</>;

  return (
    <div className="min-h-[60vh] flex items-center justify-center px-4">
      <div className="max-w-sm w-full text-center space-y-5">

        {/* Lock icon */}
        <div className="flex justify-center">
          <div className="w-16 h-16 rounded-full bg-black flex items-center justify-center">
            <svg width="30" height="30" viewBox="0 0 24 24" fill="none">
              <rect x="5" y="11" width="14" height="10" rx="2" fill="white" />
              <path d="M8 11V7a4 4 0 0 1 8 0v4" stroke="white" strokeWidth="2" strokeLinecap="round" />
            </svg>
          </div>
        </div>

        <div>
          <h2 className="text-2xl font-black">{title}</h2>
          <p className="text-sm font-black text-gray-500 mt-1">
            {status === 'pending' ? 'לרשומים ומאושרים בלבד' : 'לרשומים בלבד'}
          </p>
        </div>

        {status === 'guest' && (
          <>
            <p className="text-gray-600 text-sm">
              כדי לגשת לאזור זה יש להירשם.
            </p>
            <div className="flex flex-col gap-3">
              <Link
                href="/register"
                className="w-full bg-[#FF0000] text-white py-3 font-black text-base rounded hover:bg-red-700 transition-colors text-center"
              >
                הצטרפות לקהילה
              </Link>
              <Link
                href="/login"
                className="w-full bg-blue-500 text-black py-3 font-black text-base rounded hover:bg-blue-400 transition-colors text-center"
              >
                כניסה
              </Link>
            </div>
          </>
        )}

        {status === 'pending' && (
          <p className="text-gray-600 text-sm">
            הבקשה שלך התקבלה ומחכה לאישור מנהל. נעדכן אותך בקרוב.
          </p>
        )}

      </div>
    </div>
  );
}
