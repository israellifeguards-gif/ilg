'use client';

import { useState } from 'react';
import { signInWithEmailAndPassword, setPersistence, browserLocalPersistence, browserSessionPersistence } from 'firebase/auth';
import { auth } from '@/lib/firebase/config';
import { useRouter } from 'next/navigation';
import Link from 'next/link';

export default function LoginPage() {
  const router = useRouter();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [rememberMe, setRememberMe] = useState(true);

  async function handleLogin() {
    if (!email || !password) {
      setError('יש למלא מייל וסיסמה');
      return;
    }
    setLoading(true);
    setError('');
    try {
      await setPersistence(auth, rememberMe ? browserLocalPersistence : browserSessionPersistence);
      await signInWithEmailAndPassword(auth, email, password);
      router.push('/dashboard');
    } catch (err: unknown) {
      const code = (err as { code?: string }).code;
      if (code === 'auth/invalid-credential' || code === 'auth/wrong-password' || code === 'auth/user-not-found') {
        setError('מייל או סיסמה שגויים.');
      } else {
        setError('אירעה שגיאה. נסה שוב.');
      }
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="min-h-screen flex items-start justify-center px-4 pt-8 bg-white">
      <div className="w-full max-w-sm space-y-6">
        <div className="text-center">
          <h1 className="text-3xl font-black">כניסה</h1>
          <p className="text-gray-500 text-sm mt-1">ברוך שובך ל-ILG</p>
        </div>

        <div className="space-y-4">
          <div>
            <label className="block text-sm font-semibold mb-1">כתובת מייל</label>
            <input
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              onKeyDown={(e) => e.key === 'Enter' && handleLogin()}
              className="w-full border border-gray-300 px-4 py-3 text-base focus:outline-none focus:border-black"
              placeholder="israel@example.com"
              dir="ltr"
            />
          </div>

          <div>
            <label className="block text-sm font-semibold mb-1">סיסמה</label>
            <div className="relative">
              <input
                type={showPassword ? 'text' : 'password'}
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                onKeyDown={(e) => e.key === 'Enter' && handleLogin()}
                className="w-full border border-gray-300 px-4 py-3 pl-11 text-base focus:outline-none focus:border-black"
                placeholder="••••••"
                dir="ltr"
              />
              <button
                type="button"
                onClick={() => setShowPassword(v => !v)}
                className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400 hover:text-gray-700"
              >
                {showPassword ? (
                  <svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                    <path d="M17.94 17.94A10.07 10.07 0 0 1 12 20c-7 0-11-8-11-8a18.45 18.45 0 0 1 5.06-5.94"/>
                    <path d="M9.9 4.24A9.12 9.12 0 0 1 12 4c7 0 11 8 11 8a18.5 18.5 0 0 1-2.16 3.19"/>
                    <line x1="1" y1="1" x2="23" y2="23"/>
                  </svg>
                ) : (
                  <svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                    <path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"/>
                    <circle cx="12" cy="12" r="3"/>
                  </svg>
                )}
              </button>
            </div>
          </div>

          <label className="flex items-center gap-2 cursor-pointer select-none">
            <input
              type="checkbox"
              checked={rememberMe}
              onChange={(e) => setRememberMe(e.target.checked)}
              className="w-4 h-4 accent-black cursor-pointer"
            />
            <span className="text-sm text-gray-600">זכור אותי</span>
          </label>

          <button
            onClick={handleLogin}
            disabled={loading}
            className="w-full bg-black text-white py-4 font-black text-base hover:bg-gray-900 transition-colors disabled:opacity-50"
          >
            {loading ? 'נכנס...' : 'כניסה'}
          </button>

          {error && <p className="text-[#FF0000] text-sm text-center">{error}</p>}
        </div>

        <p className="text-center text-sm text-gray-500">
          עדיין לא רשום?{' '}
          <Link href="/register" className="font-bold text-white bg-[#FF0000] px-3 py-1 rounded hover:bg-red-700 transition-colors">
            הצטרפות לקהילה
          </Link>
        </p>
      </div>
    </div>
  );
}
