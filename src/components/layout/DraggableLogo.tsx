'use client';

import Image from 'next/image';
import Link from 'next/link';
import { useState, useEffect, useRef } from 'react';
import { usePathname } from 'next/navigation';

const STORAGE_KEY = 'ilg_logo_position';
const SIZE = 112;

export function DraggableLogo() {
  const pathname = usePathname();
  const [pos, setPos] = useState({ x: 16, y: 16 });
  const [ready, setReady] = useState(false);
  const dragging = useRef(false);
  const hasMoved = useRef(false);
  const offset = useRef({ x: 0, y: 0 });
  const startPos = useRef({ x: 0, y: 0 });

  useEffect(() => {
    const stored = localStorage.getItem(STORAGE_KEY);
    if (stored) {
      try { setPos(JSON.parse(stored)); } catch {}
    } else {
      // First visit — save the default position
      localStorage.setItem(STORAGE_KEY, JSON.stringify({ x: 16, y: 16 }));
    }
    setReady(true);
  }, []);

  function clamp(x: number, y: number) {
    return {
      x: Math.max(0, Math.min(window.innerWidth  - SIZE, x)),
      y: Math.max(0, Math.min(window.innerHeight - SIZE, y)),
    };
  }

  function onPointerDown(e: React.PointerEvent<HTMLDivElement>) {
    e.preventDefault();
    dragging.current = true;
    hasMoved.current = false;
    startPos.current = { x: e.clientX, y: e.clientY };
    (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
    offset.current = { x: e.clientX - pos.x, y: e.clientY - pos.y };
  }

  function onPointerMove(e: React.PointerEvent<HTMLDivElement>) {
    if (!dragging.current) return;
    const dx = e.clientX - startPos.current.x;
    const dy = e.clientY - startPos.current.y;
    if (Math.abs(dx) > 8 || Math.abs(dy) > 8) {
      hasMoved.current = true;
      setPos(clamp(e.clientX - offset.current.x, e.clientY - offset.current.y));
    }
  }

  function onPointerUp() {
    if (!dragging.current) return;
    dragging.current = false;
    setPos((p) => {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(p));
      return p;
    });
  }

  if (!ready || pathname === '/') return null;

  return (
    <div
      className="md:hidden fixed z-50 touch-none select-none"
      style={{ left: pos.x, top: pos.y, cursor: dragging.current ? 'grabbing' : 'grab' }}
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={onPointerUp}
    >
      <Link
        href="/"
        onClick={(e) => { if (hasMoved.current) e.preventDefault(); }}
        draggable={false}
      >
        <div className="w-28 h-28 relative">
          <Image src="/assets/logo.png" alt="ILG" fill className="object-contain" draggable={false} />
        </div>
      </Link>
    </div>
  );
}
