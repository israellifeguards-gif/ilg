'use client';

import Link from 'next/link';
import { useEffect, useState, useRef } from 'react';
import { onAuthStateChanged, signOut } from 'firebase/auth';
import { auth } from '@/lib/firebase/config';
import { useRouter } from 'next/navigation';
import { getUser } from '@/lib/firebase/firestore';
import { DraggableLogo } from './DraggableLogo';

const navItems = [
  { href: '/dashboard', label: 'תחזית' },
  { href: '/news', label: 'חדשות' },
  { href: '/courses', label: 'קורסים' },
  { href: '/jobs', label: 'משרות' },
  { href: '/jobs?type=sos', label: 'SOS', isSOS: true },
  { href: '/login', label: 'כניסה', isLogin: true },
];

const ADMIN_KEY   = 'ilg_admin_mode';
const ADMIN_EVENT = 'ilg-admin-mode-change';

export function MobileNav() {
  const [loggedIn, setLoggedIn] = useState(false);
  const [isAdmin, setIsAdmin] = useState(false);
  const [isAdminMode, setIsAdminMode] = useState(false);
  const [showLogout, setShowLogout] = useState(false);
  const [hasNewUpdate, setHasNewUpdate] = useState(false);
  const popupRef = useRef<HTMLDivElement>(null);
  const router = useRouter();

  useEffect(() => {
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

  // Close popup when clicking outside
  useEffect(() => {
    function handleClick(e: MouseEvent) {
      if (popupRef.current && !popupRef.current.contains(e.target as Node)) {
        setShowLogout(false);
      }
    }
    document.addEventListener('mousedown', handleClick);
    return () => document.removeEventListener('mousedown', handleClick);
  }, []);

  useEffect(() => {
    setIsAdminMode(sessionStorage.getItem(ADMIN_KEY) === '1');
    const sync = () => setIsAdminMode(sessionStorage.getItem(ADMIN_KEY) === '1');
    window.addEventListener(ADMIN_EVENT, sync);
    return () => window.removeEventListener(ADMIN_EVENT, sync);
  }, []);

  async function handleLogout() {
    await signOut(auth);
    sessionStorage.removeItem(ADMIN_KEY);
    window.dispatchEvent(new CustomEvent(ADMIN_EVENT));
    setShowLogout(false);
    router.push('/login');
  }

  function handleExitAdmin() {
    sessionStorage.removeItem(ADMIN_KEY);
    window.dispatchEvent(new CustomEvent(ADMIN_EVENT));
    setShowLogout(false);
  }

  return (
    <>
      <DraggableLogo />

      {/* Floating עדכונים chat bubble — mobile only */}
      <Link
        href="/updates"
        onClick={() => setHasNewUpdate(false)}
        className="md:hidden fixed z-50"
        style={{ bottom: 'calc(env(safe-area-inset-bottom, 0px) + 100px)', right: '20px' }}
      >
        <div
          className="relative flex items-center justify-center rounded-full shadow-2xl transition-transform active:scale-90"
          style={{
            width: 52,
            height: 52,
            backgroundColor: '#000000',
          }}
        >
          {/* Chat bubble icon */}
          <svg width="26" height="26" viewBox="0 0 24 24" fill="none">
            <path
              d="M20 2H4C2.9 2 2 2.9 2 4V22L6 18H20C21.1 18 22 17.1 22 16V4C22 2.9 21.1 2 20 2Z"
              fill="white"
            />
            <circle cx="8" cy="11" r="1.2" fill="black" />
            <circle cx="12" cy="11" r="1.2" fill="black" />
            <circle cx="16" cy="11" r="1.2" fill="black" />
          </svg>

          {/* Red dot badge */}
          {hasNewUpdate && (
            <span
              className="absolute top-0.5 right-0.5 w-3.5 h-3.5 rounded-full border-2 border-white"
              style={{ backgroundColor: '#FF0000' }}
            />
          )}
        </div>

      </Link>

      {/* Bottom nav */}
      <nav className="md:hidden fixed left-4 right-4 bg-black border border-gray-800 z-40 rounded-2xl" style={{ bottom: 'calc(env(safe-area-inset-bottom, 0px) + 24px)' }}>
        <div className="flex items-center justify-around px-2 py-2">
          {navItems.map((item) => {
            if (item.isLogin) {
              return (
                <div key={item.href} className="relative" ref={popupRef}>
                  {/* Logout popup */}
                  {loggedIn && showLogout && (
                    <div
                      className="absolute bottom-12 left-1/2 -translate-x-1/2 bg-white rounded-xl shadow-2xl overflow-hidden z-50"
                      style={{ minWidth: 165 }}
                    >
                      {isAdminMode && (
                        <>
                          <Link
                            href="/admin"
                            onClick={() => setShowLogout(false)}
                            className="w-full px-5 py-3 text-sm font-black text-pink-500 hover:bg-pink-50 transition-colors text-center block"
                          >
                            פאנל ניהול
                          </Link>
                          <button
                            onClick={handleExitAdmin}
                            className="w-full px-5 py-3 text-sm font-black text-gray-400 hover:bg-gray-50 transition-colors text-center block"
                          >
                            צא ממצב מנהל
                          </button>
                        </>
                      )}
                      {isAdmin && !isAdminMode && (
                        <Link
                          href="/admin"
                          onClick={() => setShowLogout(false)}
                          className="w-full px-5 py-3 text-sm font-black text-purple-600 hover:bg-purple-50 transition-colors text-center block"
                        >
                          ממתינים לאימות
                        </Link>
                      )}
                      <button
                        onClick={handleLogout}
                        className="w-full px-5 py-3 text-sm font-black text-red-600 hover:bg-red-50 transition-colors text-center"
                      >
                        להתנתק
                      </button>
                    </div>
                  )}

                  {loggedIn ? (
                    <button
                      onClick={() => setShowLogout(v => !v)}
                      className={`rounded-lg px-3 py-2 font-black text-sm text-white transition-colors ${
                        isAdminMode
                          ? 'bg-pink-500 hover:bg-pink-600'
                          : 'bg-green-600 hover:bg-green-700'
                      }`}
                    >
                      {isAdminMode ? 'מנהל' : 'מחובר'}
                    </button>
                  ) : (
                    <Link
                      href="/login"
                      className="text-black bg-blue-500 rounded-lg px-3 py-2 font-black text-sm hover:bg-blue-400 transition-colors"
                    >
                      כניסה
                    </Link>
                  )}
                </div>
              );
            }

            return (
              <Link
                key={item.href}
                href={item.href}
                className={`flex flex-col items-center py-1 px-2 text-sm font-medium transition-colors ${
                  item.isSOS
                    ? 'text-white bg-[#FF0000] rounded-lg px-3 py-2 font-black hover:bg-red-700'
                    : 'text-white hover:text-[#FF0000]'
                }`}
              >
                <span>{item.label}</span>
              </Link>
            );
          })}
        </div>
      </nav>
    </>
  );
}
