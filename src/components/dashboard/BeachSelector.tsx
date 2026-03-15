'use client';

import { useRouter } from 'next/navigation';
import { useEffect, useRef, useState } from 'react';
import { BEACHES } from '@/lib/beaches';

const COOKIE_KEY = 'ilg_favorite_beach';
const YEAR = 60 * 60 * 24 * 365;

function getFavoriteCookie(): string | null {
  if (typeof document === 'undefined') return null;
  const match = document.cookie.match(new RegExp(`(?:^|; )${COOKIE_KEY}=([^;]*)`));
  return match ? decodeURIComponent(match[1]) : null;
}

function setFavoriteCookie(value: string) {
  document.cookie = `${COOKIE_KEY}=${encodeURIComponent(value)}; path=/; max-age=${YEAR}; SameSite=Lax`;
}

function removeFavoriteCookie() {
  document.cookie = `${COOKIE_KEY}=; path=/; max-age=0`;
}

interface Props {
  selected: string;
  hasExplicitCity: boolean;
  isDark?: boolean;
}

export function BeachSelector({ selected, hasExplicitCity, isDark = true }: Props) {
  const router = useRouter();
  const [favorite, setFavorite] = useState<string | null>(null);
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  const c = isDark
    ? { btn: '#1e3a5f', btnTxt: '#ffffff', btnBorder: '#2d4f7a', dropBg: '#0f2035', dropBorder: '#1e3a5f', item: '#cbd5e1', selBg: '#1e3a5f', selTxt: '#38bdf8', divider: '#1e293b', starInactive: '#64748b' }
    : { btn: '#2a2a2a', btnTxt: '#ffffff', btnBorder: '#000000', dropBg: '#ffffff', dropBorder: '#000000', item: '#0f172a', selBg: '#000000', selTxt: '#ffffff', divider: '#000000', starInactive: '#9ca3af' };

  useEffect(() => {
    const saved = getFavoriteCookie();
    setFavorite(saved);
    // No redirect needed — server already reads the cookie and renders the right city
  }, []);

  useEffect(() => {
    function handleClick(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    }
    document.addEventListener('mousedown', handleClick);
    return () => document.removeEventListener('mousedown', handleClick);
  }, []);

  function toggleFavorite() {
    if (favorite === selected) {
      removeFavoriteCookie();
      setFavorite(null);
    } else {
      setFavoriteCookie(selected);
      setFavorite(selected);
    }
  }

  const selectedBeach = BEACHES.find(b => b.id === selected);

  return (
    <div className="flex items-center gap-2">
      <div ref={ref} className="relative">
        <button
          onClick={() => setOpen(v => !v)}
          className="flex items-center gap-2 px-4 py-2 text-base font-bold rounded"
          style={{ minWidth: 200, backgroundColor: c.btn, color: c.btnTxt, border: `1px solid ${c.btnBorder}` }}
        >
          <span className="flex-1 text-right">{selectedBeach?.name ?? 'בחר חוף'}</span>
          <span style={{ color: isDark ? '#94a3b8' : '#6b7280', fontSize: 10 }}>{open ? '▲' : '▼'}</span>
        </button>

        {open && (
          <div
            className="absolute right-0 top-full mt-1 z-50 rounded overflow-hidden"
            style={{ minWidth: 200, backgroundColor: c.dropBg, border: `1px solid ${c.dropBorder}`, boxShadow: '0 8px 24px rgba(0,0,0,0.4)' }}
          >
            {BEACHES.map(b => (
              <button
                key={b.id}
                onClick={() => { router.push(`/dashboard?city=${b.id}`); setOpen(false); }}
                className="w-full text-right px-4 py-3 text-sm font-bold transition-colors"
                style={{
                  backgroundColor: b.id === selected ? c.selBg : 'transparent',
                  color: b.id === selected ? c.selTxt : c.item,
                  borderBottom: `1px solid ${c.divider}`,
                }}
              >
                {b.name}
              </button>
            ))}
          </div>
        )}
      </div>

      <button
        onClick={toggleFavorite}
        title={favorite === selected ? 'הסר מועדף' : 'שמור כעיר מועדפת'}
        className="text-3xl transition-colors"
        style={{ color: favorite === selected ? '#f59e0b' : c.starInactive }}
      >
        {favorite === selected ? '★' : '☆'}
      </button>
    </div>
  );
}
