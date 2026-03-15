'use client';

import { useEffect, useState } from 'react';
import { onAuthStateChanged } from 'firebase/auth';
import { auth } from '@/lib/firebase/config';
import { getUser, getJobs, deleteJob } from '@/lib/firebase/firestore';
import { PostJobForm } from '@/components/employer/PostJobForm';
import type { ILGUser, Job } from '@/types';

const ROLE_LABEL: Record<string, string> = {
  SeaLifeguard:       'מציל/ה ים',
  PoolLifeguard:      'מציל/ה בריכה',
  AssistantLifeguard: 'עוזר/ת מציל',
  PoolOperator:       'מפעיל/ת בריכה',
};

export default function EmployerPage() {
  const [user, setUser]         = useState<ILGUser | null>(null);
  const [jobs, setJobs]         = useState<Job[]>([]);
  const [posting, setPosting]   = useState(false);
  const [editingJob, setEditingJob] = useState<Job | null>(null);
  const [loading, setLoading]   = useState(true);
  const [status, setStatus]     = useState<'idle' | 'not-logged-in' | 'not-employer' | 'not-verified'>('idle');

  useEffect(() => {
    const unsub = onAuthStateChanged(auth, async (firebaseUser) => {
      if (!firebaseUser) { setStatus('not-logged-in'); setLoading(false); return; }
      const ilgUser = await getUser(firebaseUser.uid);
      if (!ilgUser) { setStatus('not-logged-in'); setLoading(false); return; }
      if (ilgUser.role !== 'Employer' && ilgUser.role !== 'Admin') { setStatus('not-employer'); setLoading(false); return; }
      if (!ilgUser.is_verified && ilgUser.role !== 'Admin') { setStatus('not-verified'); setLoading(false); return; }
      setUser(ilgUser);
      await loadJobs(firebaseUser.uid);
      setLoading(false);
    });
    return () => unsub();
  }, []);

  async function loadJobs(uid: string) {
    const all = await getJobs();
    setJobs(all.filter(j => j.employer_uid === uid));
  }

  async function handleDelete(jobId: string) {
    await deleteJob(jobId);
    setJobs(prev => prev.filter(j => j.id !== jobId));
  }

  function handleSuccess() {
    setPosting(false);
    setEditingJob(null);
    if (user) loadJobs(user.uid);
  }

  if (loading) {
    return (
      <div className="flex items-center justify-center min-h-screen">
        <div className="w-8 h-8 border-2 border-black border-t-transparent rounded-full animate-spin" />
      </div>
    );
  }

  if (status === 'not-logged-in') {
    return <div className="text-center py-20 font-bold">יש להתחבר תחילה</div>;
  }
  if (status === 'not-employer') {
    return <div className="text-center py-20 font-bold">עמוד זה מיועד למעסיקים בלבד</div>;
  }
  if (status === 'not-verified') {
    return (
      <div className="text-center py-20 px-6 space-y-2">
        <p className="text-xl font-black">החשבון שלך בבדיקה</p>
        <p className="text-gray-500 text-sm">לאחר אישור תוכל לפרסם משרות</p>
      </div>
    );
  }

  return (
    <div className="w-full max-w-xl mx-auto px-4 py-6" dir="rtl">

      {/* Header */}
      <div className="mb-6">
        <h1 className="text-2xl font-black">שלום, {user?.displayName}</h1>
        <p className="text-sm text-gray-500 mt-1">לוח הניהול שלך</p>
      </div>

      {/* Post new job button */}
      {!posting && (
        <button
          onClick={() => setPosting(true)}
          className="w-full bg-black text-white py-4 font-black text-base mb-8 hover:bg-gray-900 transition-colors"
        >
          + פרסם משרה חדשה
        </button>
      )}

      {/* Post / Edit job form */}
      {(posting || editingJob) && user && (
        <div className="mb-8 border border-gray-200 p-5">
          <h2 className="text-lg font-black mb-5">{editingJob ? 'עריכת משרה' : 'פרסום משרה חדשה'}</h2>
          <PostJobForm
            employerUid={user.uid}
            onSuccess={handleSuccess}
            onCancel={() => { setPosting(false); setEditingJob(null); }}
            editJob={editingJob ?? undefined}
          />
        </div>
      )}

      {/* My jobs */}
      <div>
        <h2 className="text-base font-black mb-3 uppercase tracking-wider">המשרות שלי ({jobs.length})</h2>

        {jobs.length === 0 ? (
          <p className="text-gray-400 text-sm text-center py-10">עדיין לא פרסמת משרות</p>
        ) : (
          <div className="space-y-3">
            {jobs.map(job => (
              <div
                key={job.id}
                className="border p-4 space-y-1"
                style={{ borderColor: job.job_type === 'SOS' ? '#FF0000' : '#e5e7eb' }}
              >
                <div className="flex items-start justify-between gap-2">
                  <div className="flex-1">
                    <div className="flex items-center gap-2 flex-wrap">
                      {job.job_type === 'SOS' && (
                        <span className="text-xs font-black text-white bg-[#FF0000] px-2 py-0.5">SOS</span>
                      )}
                      <span className="font-black text-base">{job.title}</span>
                    </div>
                    <p className="text-sm text-gray-500 mt-0.5">{job.location.label}</p>
                    {job.required_role && (
                      <p className="text-xs text-gray-400 mt-0.5">{ROLE_LABEL[job.required_role]}</p>
                    )}
                  </div>
                  <div className="flex gap-3 shrink-0">
                    <button
                      onClick={() => { setEditingJob(job); setPosting(false); }}
                      className="text-xs text-blue-500 font-bold hover:text-blue-700"
                    >
                      עריכה
                    </button>
                    <button
                      onClick={() => handleDelete(job.id)}
                      className="text-xs text-red-500 font-bold hover:text-red-700"
                    >
                      מחק
                    </button>
                  </div>
                </div>
                <p className="text-sm text-gray-600 leading-relaxed">{job.description}</p>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
