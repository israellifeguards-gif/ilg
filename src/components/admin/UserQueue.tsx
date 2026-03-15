'use client';

import { useState } from 'react';
import { updateUser, deleteUser } from '@/lib/firebase/firestore';
import type { ILGUser } from '@/types';

interface Props {
  users: ILGUser[];
  onUpdate: () => void;
  selectedUid: string | null;
  onSelect: (uid: string | null) => void;
}

export function UserQueue({ users, onUpdate, selectedUid, onSelect }: Props) {
  const [lightbox, setLightbox] = useState<string | null>(null);
  const [loadingId, setLoadingId] = useState<string | null>(null);

  async function approve(uid: string) {
    setLoadingId(uid);
    await updateUser(uid, { is_verified: true });
    onUpdate();
    setLoadingId(null);
  }

  async function reject(uid: string) {
    setLoadingId(uid);
    await updateUser(uid, { is_verified: false, certification_url: null });
    onUpdate();
    setLoadingId(null);
  }

  async function handleDelete(uid: string) {
    setLoadingId(uid);
    await deleteUser(uid);
    onUpdate();
    setLoadingId(null);
  }

  async function makeAdmin(uid: string) {
    setLoadingId(uid);
    await updateUser(uid, { role: 'Admin', is_verified: true });
    onUpdate();
    setLoadingId(null);
  }

  if (users.length === 0) {
    return <p className="text-gray-400 text-sm text-center py-6">אין משתמשים ממתינים לאימות</p>;
  }

  return (
    <>
      {/* Lightbox */}
      {lightbox && (
        <div
          className="fixed inset-0 bg-black/80 z-50 flex items-center justify-center p-4"
          onClick={() => setLightbox(null)}
        >
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src={lightbox} alt="תעודה" className="max-w-full max-h-full object-contain" />
        </div>
      )}

      <ul className="divide-y divide-gray-100">
        {users.map((u) => (
          <li
            key={u.uid}
            onClick={() => onSelect(selectedUid === u.uid ? null : u.uid)}
            className="py-4 flex flex-col sm:flex-row sm:items-center gap-4 cursor-pointer transition-colors px-2 rounded"
            style={{ backgroundColor: selectedUid === u.uid ? '#f3e8ff' : undefined, border: selectedUid === u.uid ? '2px solid #9333ea' : '2px solid transparent' }}
          >
            {/* Cert thumbnail */}
            {u.certification_url ? (
              <button
                onClick={() => setLightbox(u.certification_url!)}
                className="flex-shrink-0"
                title="לחץ להגדלה"
              >
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img
                  src={u.certification_url}
                  alt="תעודה"
                  className="w-16 h-16 object-cover border border-gray-200 hover:border-[#FF0000] transition-colors"
                />
              </button>
            ) : (
              <div className="w-16 h-16 bg-gray-100 flex items-center justify-center text-xs text-gray-400 flex-shrink-0">
                אין
              </div>
            )}

            {/* Info */}
            <div className="flex-1 min-w-0">
              <p className="font-bold text-sm">{u.displayName}</p>
              <p className="text-xs text-gray-500">{u.phone}</p>
              <p className="text-xs text-gray-400">{u.role.includes('Lifeguard') ? 'מציל/ה' : 'מעסיק/ה'}</p>
            </div>

            {/* Actions */}
            <div className="flex gap-2 flex-shrink-0 flex-wrap">
              <button
                onClick={() => approve(u.uid)}
                disabled={loadingId === u.uid}
                className="px-4 py-2 bg-black text-white text-xs font-bold hover:bg-gray-900 transition-colors disabled:opacity-50"
              >
                ✓ אשר
              </button>
              <button
                onClick={() => reject(u.uid)}
                disabled={loadingId === u.uid}
                className="px-4 py-2 border-2 border-[#FF0000] text-[#FF0000] text-xs font-bold hover:bg-red-50 transition-colors disabled:opacity-50"
              >
                ✕ דחה
              </button>
              <button
                onClick={() => handleDelete(u.uid)}
                disabled={loadingId === u.uid}
                className="px-4 py-2 bg-red-600 text-white text-xs font-bold hover:bg-red-700 transition-colors disabled:opacity-50"
              >
                🗑 מחק
              </button>
            </div>
          </li>
        ))}
      </ul>
    </>
  );
}
