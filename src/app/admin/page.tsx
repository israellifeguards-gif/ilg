'use client';

import { useState, useEffect, useCallback } from 'react';
import { getPendingUsers, getJobs, setGlobalAlert, deleteJob, updateUser, deleteUser } from '@/lib/firebase/firestore';
import { UserQueue } from '@/components/admin/UserQueue';
import { BeachCalibrationPanel } from '@/components/admin/BeachCalibrationPanel';
import type { ILGUser, Job } from '@/types';

// Simple admin guard — replace with proper auth check in production
const ADMIN_PASSWORD = 'ilg-admin-2024';
const ADMIN_KEY   = 'ilg_admin_mode';
const ADMIN_EVENT = 'ilg-admin-mode-change';

function setAdminMode(active: boolean) {
  if (active) sessionStorage.setItem(ADMIN_KEY, '1');
  else sessionStorage.removeItem(ADMIN_KEY);
  window.dispatchEvent(new CustomEvent(ADMIN_EVENT));
}

export default function AdminPage() {
  const [authed, setAuthedState] = useState(false);
  const [password, setPassword] = useState('');

  // Restore session on mount (survives navigation within same tab)
  useEffect(() => {
    if (sessionStorage.getItem(ADMIN_KEY) === '1') setAuthedState(true);
  }, []);

  function setAuthed(v: boolean) {
    setAuthedState(v);
    setAdminMode(v);
  }
  const [users, setUsers] = useState<ILGUser[]>([]);
  const [jobs, setJobs] = useState<Job[]>([]);
  const [alertMsg, setAlertMsg] = useState('');
  const [alertActive, setAlertActive] = useState(false);
  const [alertSaved, setAlertSaved] = useState(false);
  const [showAdminPicker, setShowAdminPicker] = useState(false);
  const [showDeletePicker, setShowDeletePicker] = useState(false);
  const [selectedUid, setSelectedUid] = useState<string | null>(null);

  const loadData = useCallback(async () => {
    const [u, j] = await Promise.all([getPendingUsers(), getJobs()]);
    setUsers(u);
    setJobs(j);
  }, []);

  useEffect(() => {
    if (authed) loadData();
  }, [authed, loadData]);

  async function saveAlert() {
    await setGlobalAlert(alertMsg, alertActive);
    setAlertSaved(true);
    setTimeout(() => setAlertSaved(false), 2000);
  }

  async function handleDeleteJob(id: string) {
    await deleteJob(id);
    setJobs((prev) => prev.filter((j) => j.id !== id));
  }

  if (!authed) {
    return (
      <div className="min-h-screen flex items-center justify-center px-4">
        <div className="w-full max-w-sm space-y-4">
          <h1 className="text-2xl font-black text-center">כניסת מנהל</h1>
          <input
            type="password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && password === ADMIN_PASSWORD && setAuthed(true)}
            className="w-full border border-gray-300 px-4 py-3 focus:outline-none focus:border-black"
            placeholder="סיסמת מנהל"
            dir="ltr"
          />
          <button
            onClick={() => {
              if (password === ADMIN_PASSWORD) setAuthed(true);
            }}
            className="w-full bg-black text-white py-3 font-black hover:bg-gray-900 transition-colors"
          >
            כניסה
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="max-w-3xl mx-auto px-4 py-8 space-y-10">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-black">פאנל ניהול ILG</h1>
        <button
          onClick={() => setAuthed(false)}
          className="text-xs text-gray-500 hover:text-black underline"
        >
          צא ממצב מנהל
        </button>
      </div>

      {/* Global Alert */}
      <section className="border border-gray-200 p-5 space-y-3">
        <h2 className="font-black text-base flex items-center gap-2">🚨 התראה גלובלית</h2>
        <textarea
          value={alertMsg}
          onChange={(e) => setAlertMsg(e.target.value)}
          className="w-full border border-gray-300 px-3 py-2 text-sm focus:outline-none focus:border-black resize-none"
          rows={2}
          placeholder='למשל: "דגל שחור בחופי הצפון עד הערב"'
        />
        <div className="flex items-center gap-4">
          <label className="flex items-center gap-2 cursor-pointer">
            <input
              type="checkbox"
              checked={alertActive}
              onChange={(e) => setAlertActive(e.target.checked)}
              className="w-4 h-4 accent-[#FF0000]"
            />
            <span className="text-sm font-medium">הצג באתר</span>
          </label>
          <button
            onClick={saveAlert}
            className="bg-[#FF0000] text-white px-5 py-2 text-sm font-black hover:bg-red-700 transition-colors"
          >
            {alertSaved ? '✓ נשמר' : 'שמור'}
          </button>
        </div>
      </section>

      {/* Pending Users */}
      <section className="space-y-3">
        <div className="flex items-center justify-between">
          <h2 className="font-black text-base flex items-center gap-2">
            ⏳ ממתינים לאימות
            <span className="bg-[#FF0000] text-white text-xs px-2 py-0.5 font-black">
              {users.length}
            </span>
          </h2>
          <div className="flex gap-2 items-center">
            {!selectedUid && (
              <span className="text-xs text-gray-400">בחר משתמש מהרשימה</span>
            )}
            <button
              disabled={!selectedUid}
              onClick={async () => {
                if (!selectedUid) return;
                await updateUser(selectedUid, { role: 'Admin', is_verified: true });
                setSelectedUid(null);
                loadData();
              }}
              className="px-4 py-2 bg-purple-600 text-white text-xs font-bold hover:bg-purple-700 transition-colors disabled:opacity-30 disabled:cursor-not-allowed"
            >
              ★ הפוך לאדמין
            </button>
            <button
              disabled={!selectedUid}
              onClick={async () => {
                if (!selectedUid) return;
                await deleteUser(selectedUid);
                setSelectedUid(null);
                loadData();
              }}
              className="px-4 py-2 bg-red-600 text-white text-xs font-bold hover:bg-red-700 transition-colors disabled:opacity-30 disabled:cursor-not-allowed"
            >
              🗑 מחק משתמש
            </button>
          </div>
        </div>
        <div className="border border-gray-200 p-4">
          <UserQueue users={users} onUpdate={loadData} selectedUid={selectedUid} onSelect={setSelectedUid} />
        </div>
      </section>

      {/* Job Management */}
      <section className="space-y-3">
        <h2 className="font-black text-base flex items-center gap-2">
          💼 ניהול משרות
          <span className="bg-gray-200 text-black text-xs px-2 py-0.5 font-black">
            {jobs.length}
          </span>
        </h2>
        {jobs.length === 0 ? (
          <p className="text-gray-400 text-sm text-center py-4">אין משרות פעילות</p>
        ) : (
          <ul className="divide-y divide-gray-100 border border-gray-200">
            {jobs.map((job) => (
              <li key={job.id} className="px-4 py-3 flex items-center gap-3">
                {job.job_type === 'SOS' && (
                  <span className="bg-[#FF0000] text-white text-xs font-black px-1.5 py-0.5 flex-shrink-0">
                    SOS
                  </span>
                )}
                <div className="flex-1 min-w-0">
                  <p className="font-semibold text-sm truncate">{job.title}</p>
                  <p className="text-xs text-gray-400">{job.location.label}</p>
                </div>
                <button
                  onClick={() => handleDeleteJob(job.id)}
                  className="text-xs text-[#FF0000] font-bold hover:underline flex-shrink-0"
                >
                  מחק
                </button>
              </li>
            ))}
          </ul>
        )}
      </section>

      {/* Beach Calibration */}
      <section className="space-y-3">
        <h2 className="font-black text-base flex items-center gap-2">
          🌊 כיול חופים
          <span className="text-xs font-normal text-gray-400">height · period · wind · swell angle</span>
        </h2>
        <div className="border border-gray-200 p-4">
          <BeachCalibrationPanel />
        </div>
        <div className="text-xs text-gray-500 space-y-1">
          <p><strong>Hs ×</strong> — מכפיל גובה הגל (1.0 = ללא תיקון, 1.25 = הגדל ב-25%)</p>
          <p><strong>T ×</strong> — מכפיל תקופת הגל (1.0 = ללא תיקון)</p>
          <p><strong>Wind kn</strong> — הוספה/הפחתה לעוצמת הרוח בנוטס (0 = ללא תיקון)</p>
          <p><strong>Angle °</strong> — הזחה לזווית החוף האפקטיבית (285° + offset). נגטיב = פנייה דרומה</p>
          <p><strong>P kW/m</strong> — עוצמת הגל בתצוגה מקדימה: P = 0.4903 × Hs² × T</p>
        </div>
      </section>
    </div>
  );
}
