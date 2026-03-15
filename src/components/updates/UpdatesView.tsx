'use client';

import { useEffect, useState } from 'react';
import { onAuthStateChanged } from 'firebase/auth';
import { auth } from '@/lib/firebase/config';
import { getUser, createAdminUpdate, deleteAdminUpdate, getAdminUpdates } from '@/lib/firebase/firestore';
import type { AdminUpdate } from '@/types';

const STORAGE_KEY = 'ilg_updates_last_seen';

export function UpdatesView() {
  const [updates, setUpdates] = useState<AdminUpdate[]>([]);
  const [isAdmin, setIsAdmin] = useState(false);
  const [loading, setLoading] = useState(true);
  const [title, setTitle] = useState('');
  const [content, setContent] = useState('');
  const [posting, setPosting] = useState(false);

  useEffect(() => {
    // Mark as seen
    localStorage.setItem(STORAGE_KEY, new Date().toISOString());

    const unsub = onAuthStateChanged(auth, async (u) => {
      if (u) {
        const user = await getUser(u.uid);
        setIsAdmin(user?.role === 'Admin');
      }
    });
    return () => unsub();
  }, []);

  useEffect(() => {
    getAdminUpdates().then(data => {
      setUpdates(data);
      setLoading(false);
    });
  }, []);

  async function handlePost() {
    if (!title.trim() || !content.trim()) return;
    setPosting(true);
    await createAdminUpdate({ title: title.trim(), content: content.trim() });
    const fresh = await getAdminUpdates();
    setUpdates(fresh);
    localStorage.setItem(STORAGE_KEY, new Date().toISOString());
    setTitle('');
    setContent('');
    setPosting(false);
  }

  async function handleDelete(id: string) {
    await deleteAdminUpdate(id);
    setUpdates(prev => prev.filter(u => u.id !== id));
  }

  return (
    <div dir="rtl" className="min-h-screen bg-white">

      {/* Header */}
      <div className="border-b border-gray-200 px-6 py-4 bg-white">
        <h1 className="text-xl font-black text-black">עדכונים</h1>
        <p className="text-xs mt-0.5 text-gray-400">עדכונים בלעדיים מהנהלת ILG</p>
      </div>

      <div style={{ maxWidth: 760, margin: '0 auto' }} className="px-4 py-6 space-y-4">

        {/* Admin post form */}
        {isAdmin && (
          <div className="border border-gray-200 p-5 space-y-3">
            <div className="text-sm font-bold uppercase tracking-widest text-gray-400">פרסום עדכון חדש</div>
            <input
              value={title}
              onChange={e => setTitle(e.target.value)}
              placeholder="כותרת"
              className="w-full px-3 py-2 text-sm font-bold text-black border border-gray-300 outline-none focus:border-black"
            />
            <textarea
              value={content}
              onChange={e => setContent(e.target.value)}
              placeholder="תוכן העדכון..."
              rows={4}
              className="w-full px-3 py-2 text-sm text-black border border-gray-300 outline-none focus:border-black resize-none"
            />
            <button
              onClick={handlePost}
              disabled={posting || !title.trim() || !content.trim()}
              className="px-6 py-2 text-sm font-black text-white transition-opacity disabled:opacity-40"
              style={{ backgroundColor: '#FF0000' }}
            >
              {posting ? 'מפרסם...' : 'פרסם עדכון'}
            </button>
          </div>
        )}

        {/* Updates list */}
        {loading ? (
          <div className="text-center py-12 text-sm text-gray-400">טוען...</div>
        ) : updates.length === 0 ? (
          <div className="text-center py-12 text-sm text-gray-400">אין עדכונים כרגע</div>
        ) : (
          updates.map(u => (
            <div key={u.id} className="border border-gray-200 p-5 space-y-2">
              <div className="flex items-start justify-between gap-3">
                <div className="flex items-center gap-2">
                  <span className="text-xs font-black px-2 py-0.5" style={{ backgroundColor: '#FF0000', color: '#fff' }}>
                    ILG
                  </span>
                  <h2 className="text-base font-black text-black">{u.title}</h2>
                </div>
                {isAdmin && (
                  <button
                    onClick={() => handleDelete(u.id)}
                    className="text-xs font-bold text-red-500 shrink-0"
                  >
                    מחק
                  </button>
                )}
              </div>
              <p className="text-sm leading-relaxed text-gray-600">{u.content}</p>
              <div className="text-xs text-gray-400">
                {new Date(u.created_at).toLocaleDateString('he-IL', { day: 'numeric', month: 'long', year: 'numeric', hour: '2-digit', minute: '2-digit' })}
              </div>
            </div>
          ))
        )}
      </div>
    </div>
  );
}
