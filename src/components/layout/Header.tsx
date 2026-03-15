'use client';

import Link from 'next/link';
import Image from 'next/image';
import { useEffect, useState, useRef } from 'react';
import { onAuthStateChanged, signOut } from 'firebase/auth';
import { auth } from '@/lib/firebase/config';
import { getUser } from '@/lib/firebase/firestore';
import { useRouter } from 'next/navigation';

export function Header() {
  const [loggedIn, setLoggedIn] = useState(false);
  const [isAdmin, setIsAdmin] = useState(false);
  const [showMenu, setShowMenu] = useState(false);
  const [hasNewUpdate, setHasNewUpdate] = useState(false);
  const menuRef = useRef<HTMLDivElement>(null);
  const router = useRouter();

  useEffect(() => {
    // Check for new updates
    import('@/lib/firebase/firestore').then(({ getAdminUpdates }) => {
      getAdminUpdates().then(updates => {
        if (updates.length === 0) return;
        const lastSeen = localStorage.getItem('ilg_updates_last_seen');
        if (!lastSeen || new Date(updates[0].created_at) > new Date(lastSeen)) {
          setHasNewUpdate(true);
        }
      });
    });
  }, []);

  useEffect(() => {
    const unsub = onAuthStateChanged(auth, async (firebaseUser) => {
      if (!firebaseUser) { setLoggedIn(false); setIsAdmin(false); return; }
      setLoggedIn(true);
      const user = await getUser(firebaseUser.uid);
      setIsAdmin(!!user && user.role === 'Admin');
    });
    return () => unsub();
  }, []);

  useEffect(() => {
    function handleClick(e: MouseEvent) {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) {
        setShowMenu(false);
      }
    }
    document.addEventListener('mousedown', handleClick);
    return () => document.removeEventListener('mousedown', handleClick);
  }, []);

  async function handleLogout() {
    await signOut(auth);
    setShowMenu(false);
    router.push('/login');
  }

  return (
    <header className="hidden md:flex items-center justify-between px-8 py-2 bg-black sticky top-0 z-40">
      <Link href="/" className="flex items-center gap-3">
        <div className="w-12 h-12 relative">
          <Image src="/assets/logo.png" alt="ILG Logo" fill className="object-contain" priority />
        </div>
        <span className="text-xl font-black tracking-tight" style={{ color: '#e8e8e8' }}>Israel Lifeguards</span>
      </Link>

      <nav className="flex items-center gap-4">
        {[
          { href: '/dashboard', label: 'תחזית' },
          { href: '/news',      label: 'חדשות' },
          { href: '/courses',   label: 'קורסים' },
          { href: '/jobs',      label: 'משרות' },
        ].map((item) => (
          <Link
            key={item.href}
            href={item.href}
            className="px-3 py-2 text-sm font-bold text-gray-300 hover:text-white transition-colors"
          >
            {item.label}
          </Link>
        ))}

        {/* עדכונים with new badge */}
        <Link
          href="/updates"
          onClick={() => setHasNewUpdate(false)}
          className="relative px-3 py-2 text-sm font-bold text-gray-300 hover:text-white transition-colors"
        >
          עדכונים
          {hasNewUpdate && (
            <span className="absolute top-1 right-0 w-2 h-2 rounded-full" style={{ backgroundColor: '#FF0000' }} />
          )}
        </Link>

        <Link
          href="/jobs?type=sos"
          className="px-4 py-2 text-sm font-bold bg-[#FF0000] text-white hover:bg-red-700 transition-colors"
        >
          SOS
        </Link>

        {/* Login / Connected button */}
        <div className="relative" ref={menuRef}>
          {loggedIn ? (
            <>
              <button
                onClick={() => setShowMenu(v => !v)}
                className="px-4 py-2 text-sm font-black bg-green-600 text-white hover:bg-green-700 transition-colors"
              >
                מחובר
              </button>
              {showMenu && (
                <div className="absolute left-0 top-10 bg-white rounded-xl shadow-2xl overflow-hidden z-50" style={{ minWidth: 160 }}>
                  {isAdmin && (
                    <Link
                      href="/admin"
                      onClick={() => setShowMenu(false)}
                      className="w-full px-5 py-3 text-sm font-black text-purple-600 hover:bg-purple-50 transition-colors text-right block"
                    >
                      ממתינים לאימות
                    </Link>
                  )}
                  <button
                    onClick={handleLogout}
                    className="w-full px-5 py-3 text-sm font-black text-red-600 hover:bg-red-50 transition-colors text-right block"
                  >
                    להתנתק
                  </button>
                </div>
              )}
            </>
          ) : (
            <Link
              href="/login"
              className="px-4 py-2 text-sm font-bold bg-blue-500 text-black hover:bg-blue-400 transition-colors"
            >
              כניסה
            </Link>
          )}
        </div>
      </nav>
    </header>
  );
}
