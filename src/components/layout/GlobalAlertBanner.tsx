'use client';

import { useEffect, useState } from 'react';
import { subscribeToGlobalAlert } from '@/lib/firebase/firestore';
import type { GlobalAlert } from '@/types';

export function GlobalAlertBanner() {
  const [alert, setAlert] = useState<GlobalAlert | null>(null);

  useEffect(() => {
    const unsub = subscribeToGlobalAlert(setAlert);
    return unsub;
  }, []);

  if (!alert?.active || !alert.message) return null;

  return (
    <div className="w-full bg-[#FF0000] text-white text-center py-2 px-4 text-sm font-bold z-50 sticky top-0">
      🚨 {alert.message}
    </div>
  );
}
