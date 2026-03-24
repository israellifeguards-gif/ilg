'use client';

import { useState, useEffect, useCallback } from 'react';
import { getPendingUsers, getJobs, setGlobalAlert, deleteJob, updateUser, deleteUser } from '@/lib/firebase/firestore';
import { UserQueue } from '@/components/admin/UserQueue';
import { BeachCalibrationPanel } from '@/components/admin/BeachCalibrationPanel';
import type { ILGUser, Job } from '@/types';

const ADMIN_PASSWORD = 'ilg-admin-2024';
const ADMIN_KEY      = 'ilg_admin_mode';
const ADMIN_EVENT    = 'ilg-admin-mode-change';

function setAdminMode(active: boolean) {
  if (active) sessionStorage.setItem(ADMIN_KEY, '1');
  else sessionStorage.removeItem(ADMIN_KEY);
  window.dispatchEvent(new CustomEvent(ADMIN_EVENT));
}

type ToolId = 'forecast' | 'alert' | 'queue' | 'jobs';

const TOOLS: { id: ToolId; label: string }[] = [
  { id: 'forecast', label: 'עריכת תחזית וחופים' },
  { id: 'alert',    label: 'התראה גלובלית'       },
  { id: 'queue',    label: 'ממתינים לאימות'      },
  { id: 'jobs',     label: 'ניהול משרות'         },
];

// ── Login ─────────────────────────────────────────────────────────────────────

function LoginScreen({ onLogin }: { onLogin: () => void }) {
  const [pw,    setPw]    = useState('');
  const [error, setError] = useState(false);

  function attempt() {
    if (pw === ADMIN_PASSWORD) { onLogin(); setError(false); }
    else setError(true);
  }

  return (
    <div className="min-h-screen flex items-center justify-center px-4">
      <div className="w-full max-w-sm space-y-4">
        <h1 className="text-2xl font-black text-center">כניסת מנהל</h1>
        <input
          type="password" value={pw} autoFocus dir="ltr"
          onChange={e => { setPw(e.target.value); setError(false); }}
          onKeyDown={e => e.key === 'Enter' && attempt()}
          placeholder="סיסמת מנהל"
          className={`w-full border px-4 py-3 focus:outline-none focus:border-black transition ${
            error ? 'border-red-400 bg-red-50' : 'border-gray-300'
          }`}
        />
        {error && <p className="text-xs text-red-500 text-center">סיסמה שגויה</p>}
        <button onClick={attempt}
          className="w-full bg-black text-white py-3 font-black hover:bg-gray-900 transition">
          כניסה
        </button>
      </div>
    </div>
  );
}

// ── Section components ────────────────────────────────────────────────────────

function AlertSection() {
  const [msg,    setMsg]    = useState('');
  const [active, setActive] = useState(false);
  const [saved,  setSaved]  = useState(false);

  async function save() {
    await setGlobalAlert(msg, active);
    setSaved(true);
    setTimeout(() => setSaved(false), 2000);
  }

  return (
    <div className="max-w-xl mx-auto space-y-4 pt-2" dir="rtl">
      <p className="text-sm text-gray-500">
        הטקסט יוצג בבאנר אדום בראש האפליקציה לכל המשתמשים כל עוד ההתראה פעילה.
      </p>
      <textarea
        value={msg} onChange={e => setMsg(e.target.value)} rows={3}
        placeholder='למשל: "דגל שחור בחופי הצפון עד הערב"'
        className="w-full border border-gray-300 px-3 py-3 text-sm focus:outline-none
                   focus:border-black resize-none rounded-lg transition"
      />
      <div className="flex items-center gap-4">
        <label className="flex items-center gap-2 cursor-pointer select-none">
          <input type="checkbox" checked={active} onChange={e => setActive(e.target.checked)}
            className="w-4 h-4 accent-[#FF0000]" />
          <span className="text-sm font-medium">הצג באתר</span>
        </label>
        <button onClick={save}
          className="bg-[#FF0000] text-white px-6 py-2 text-sm font-black hover:bg-red-700 transition rounded">
          {saved ? '✓ נשמר' : 'שמור'}
        </button>
      </div>
    </div>
  );
}

function UsersSection({
  users, selectedUid, onSelect, onLoad,
}: {
  users: ILGUser[]; selectedUid: string | null;
  onSelect: (uid: string | null) => void; onLoad: () => void;
}) {
  return (
    <div className="max-w-2xl mx-auto space-y-4 pt-2" dir="rtl">
      <div className="flex items-center justify-between flex-wrap gap-2">
        <span className="text-sm text-gray-500">
          {users.length === 0 ? 'אין משתמשים ממתינים' : `${users.length} ממתינים לאישור`}
        </span>
        <div className="flex gap-2">
          <button disabled={!selectedUid}
            onClick={async () => {
              if (!selectedUid) return;
              await updateUser(selectedUid, { role: 'Admin', is_verified: true });
              onSelect(null); onLoad();
            }}
            className="px-4 py-2 bg-purple-600 text-white text-xs font-bold rounded
                       hover:bg-purple-700 transition disabled:opacity-30 disabled:cursor-not-allowed">
            ★ הפוך לאדמין
          </button>
          <button disabled={!selectedUid}
            onClick={async () => {
              if (!selectedUid) return;
              await deleteUser(selectedUid);
              onSelect(null); onLoad();
            }}
            className="px-4 py-2 bg-red-600 text-white text-xs font-bold rounded
                       hover:bg-red-700 transition disabled:opacity-30 disabled:cursor-not-allowed">
            🗑 מחק
          </button>
        </div>
      </div>
      <div className="border border-gray-200 rounded-xl overflow-hidden">
        <UserQueue users={users} onUpdate={onLoad} selectedUid={selectedUid} onSelect={onSelect} />
      </div>
    </div>
  );
}

function JobsSection({ jobs, onDelete }: { jobs: Job[]; onDelete: (id: string) => void }) {
  return (
    <div className="max-w-2xl mx-auto pt-2" dir="rtl">
      {jobs.length === 0 ? (
        <p className="text-gray-400 text-sm text-center py-10">אין משרות פעילות</p>
      ) : (
        <ul className="divide-y divide-gray-100 border border-gray-200 rounded-xl overflow-hidden">
          {jobs.map(job => (
            <li key={job.id} className="px-4 py-3 flex items-center gap-3">
              {job.job_type === 'SOS' && (
                <span className="bg-[#FF0000] text-white text-xs font-black px-1.5 py-0.5 rounded shrink-0">SOS</span>
              )}
              <div className="flex-1 min-w-0">
                <p className="font-semibold text-sm truncate">{job.title}</p>
                <p className="text-xs text-gray-400">{job.location.label}</p>
              </div>
              <button onClick={() => onDelete(job.id)}
                className="text-xs text-red-500 font-bold hover:underline shrink-0">מחק</button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

// ── Main page ─────────────────────────────────────────────────────────────────

export default function AdminPage() {
  const [authed,      setAuthedState] = useState(false);
  const [tool,        setTool]        = useState<ToolId>('forecast');
  const [users,       setUsers]       = useState<ILGUser[]>([]);
  const [jobs,        setJobs]        = useState<Job[]>([]);
  const [selectedUid, setSelectedUid] = useState<string | null>(null);

  useEffect(() => {
    if (sessionStorage.getItem(ADMIN_KEY) === '1') setAuthedState(true);
  }, []);

  function setAuthed(v: boolean) {
    setAuthedState(v);
    setAdminMode(v);
    if (v) setTool('forecast');  // always open forecast on login
  }

  const loadData = useCallback(async () => {
    const [u, j] = await Promise.all([getPendingUsers(), getJobs()]);
    setUsers(u); setJobs(j);
  }, []);

  useEffect(() => { if (authed) loadData(); }, [authed, loadData]);

  if (!authed) return <LoginScreen onLogin={() => setAuthed(true)} />;

  const usersBadge = users.length > 0 ? ` (${users.length})` : '';
  const jobsBadge  = jobs.length  > 0 ? ` (${jobs.length})`  : '';

  const selectedLabel = TOOLS.find(t => t.id === tool)?.label ?? '';

  return (
    <div className="min-h-screen bg-gray-50">

      {/* ── Sticky top bar ───────────────────────────────────────────────── */}
      <div className="sticky top-0 z-40 bg-white border-b border-gray-200 shadow-sm px-4 py-3" dir="rtl">
        <div className="flex items-center gap-3 max-w-3xl mx-auto">

          {/* Selector */}
          <div className="relative flex-1">
            <select
              value={tool}
              onChange={e => setTool(e.target.value as ToolId)}
              dir="rtl"
              className="w-full appearance-none bg-gray-50 border-2 border-gray-200 rounded-xl
                         px-4 py-2.5 pr-10 text-sm font-bold text-gray-900
                         focus:outline-none focus:border-black transition cursor-pointer"
            >
              {TOOLS.map(t => (
                <option key={t.id} value={t.id}>
                  {t.id === 'queue' ? `${t.label}${usersBadge}` :
                   t.id === 'jobs'  ? `${t.label}${jobsBadge}`  : t.label}
                </option>
              ))}
            </select>
            <span className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-gray-400 text-xs">▼</span>
          </div>

          {/* Logout */}
          <button
            onClick={() => setAuthed(false)}
            className="shrink-0 text-xs text-gray-400 hover:text-black transition underline whitespace-nowrap"
          >
            יציאה
          </button>
        </div>

        {/* Active tool label */}
        <p className="text-[11px] text-gray-400 mt-1 font-medium max-w-3xl mx-auto">
          {selectedLabel}
          {tool === 'queue' && usersBadge && (
            <span className="mr-2 bg-red-500 text-white text-[10px] font-black px-1.5 py-0.5 rounded-full">{users.length}</span>
          )}
          {tool === 'jobs' && jobsBadge && (
            <span className="mr-2 bg-gray-700 text-white text-[10px] font-black px-1.5 py-0.5 rounded-full">{jobs.length}</span>
          )}
        </p>
      </div>

      {/* ── Content ──────────────────────────────────────────────────────── */}
      <div className={`py-5 ${tool === 'forecast' || tool === 'dna' ? 'px-4' : 'px-4'}`}>
        {tool === 'forecast' && <BeachCalibrationPanel />}
        {tool === 'alert'    && <AlertSection />}
        {tool === 'queue'    && (
          <UsersSection users={users} selectedUid={selectedUid} onSelect={setSelectedUid} onLoad={loadData} />
        )}
        {tool === 'jobs' && <JobsSection jobs={jobs} onDelete={async id => { await deleteJob(id); setJobs(p => p.filter(j => j.id !== id)); }} />}
      </div>
    </div>
  );
}
