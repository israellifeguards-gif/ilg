'use client';

import { useState } from 'react';

const ROLE_OPTIONS = [
  { value: 'SeaLifeguard',       label: 'מציל/ה ים' },
  { value: 'PoolLifeguard',      label: 'מציל/ה בריכה' },
  { value: 'AssistantLifeguard', label: 'עוזר/ת מציל' },
  { value: 'PoolOperator',       label: 'מפעיל/ת בריכה' },
];

const MOCK_JOBS = [
  { id: '1', job_type: 'Regular', title: 'דרוש מציל לחוף תל אביב', location: 'תל אביב, חוף הילטון', required_role: 'SeaLifeguard', description: 'משרה מלאה לקיץ 2025, 6 ימים בשבוע.' },
  { id: '2', job_type: 'SOS',     title: 'דרוש מציל בריכה דחוף',  location: 'רמת גן',              required_role: 'PoolLifeguard', description: 'החלפה דחופה להיום בלבד.' },
];

const ROLE_LABEL: Record<string, string> = {
  SeaLifeguard: 'מציל/ה ים', PoolLifeguard: 'מציל/ה בריכה',
  AssistantLifeguard: 'עוזר/ת מציל', PoolOperator: 'מפעיל/ת בריכה',
};

export default function EmployerPreview() {
  const [posting, setPosting]       = useState(false);
  const [jobType, setJobType]       = useState<'Regular' | 'SOS'>('Regular');
  const [selectedRole, setRole]     = useState<string | null>(null);
  const [jobs, setJobs]             = useState(MOCK_JOBS);

  return (
    <div className="w-full max-w-xl mx-auto px-4 py-6" dir="rtl">

      {/* Header */}
      <div className="mb-6">
        <p className="text-xs text-gray-400 mb-1">תצוגה מקדימה בלבד</p>
        <h1 className="text-2xl font-black">שלום, דני כהן</h1>
        <p className="text-sm text-gray-500 mt-1">לוח הניהול שלך</p>
      </div>

      {/* Post button */}
      {!posting && (
        <button
          onClick={() => setPosting(true)}
          className="w-full bg-black text-white py-4 font-black text-base mb-8 hover:bg-gray-900 transition-colors"
        >
          + פרסם משרה חדשה
        </button>
      )}

      {/* Form */}
      {posting && (
        <div className="mb-8 border border-gray-200 p-5 space-y-5">
          <h2 className="text-lg font-black">פרסום משרה חדשה</h2>

          {/* Job type */}
          <div>
            <label className="block text-sm font-black mb-2">סוג משרה</label>
            <div className="flex gap-3">
              {(['Regular', 'SOS'] as const).map(t => (
                <button key={t} onClick={() => setJobType(t)}
                  className="flex-1 py-3 font-black text-sm transition-colors"
                  style={{ backgroundColor: jobType === t ? (t === 'SOS' ? '#FF0000' : '#000') : '#f1f5f9', color: jobType === t ? '#fff' : '#374151' }}>
                  {t === 'SOS' ? '🆘 SOS – דחוף' : 'משרה רגילה'}
                </button>
              ))}
            </div>
          </div>

          {/* Role selector */}
          <div>
            <label className="block text-sm font-black mb-2">איזה מקצוען אתה מחפש? <span className="text-red-500">*</span></label>
            <div className="grid grid-cols-2 gap-2">
              {ROLE_OPTIONS.map(r => (
                <button key={r.value} onClick={() => setRole(r.value)}
                  className="py-3 px-4 text-sm font-bold transition-colors text-right"
                  style={{
                    backgroundColor: selectedRole === r.value ? '#000' : '#f1f5f9',
                    color: selectedRole === r.value ? '#fff' : '#374151',
                    border: selectedRole === r.value ? '2px solid #000' : '2px solid transparent',
                  }}>
                  {r.label}
                </button>
              ))}
            </div>
          </div>

          {/* Title */}
          <div>
            <label className="block text-sm font-black mb-1">כותרת המשרה <span className="text-red-500">*</span></label>
            <input type="text" className="w-full border border-gray-300 px-4 py-3 text-base focus:outline-none focus:border-black" placeholder="לדוג׳: דרוש מציל לחוף תל אביב" />
          </div>

          {/* Description */}
          <div>
            <label className="block text-sm font-black mb-1">תיאור המשרה <span className="text-red-500">*</span></label>
            <textarea rows={4} className="w-full border border-gray-300 px-4 py-3 text-base focus:outline-none focus:border-black resize-none" placeholder="תאר את המשרה, שעות, תנאים..." />
          </div>

          {/* Location */}
          <div>
            <label className="block text-sm font-black mb-1">מיקום <span className="text-red-500">*</span></label>
            <input type="text" className="w-full border border-gray-300 px-4 py-3 text-base focus:outline-none focus:border-black" placeholder="לדוג׳: תל אביב, חוף הילטון" />
          </div>

          {/* Contact */}
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-sm font-black mb-1">טלפון <span className="text-red-500">*</span></label>
              <input type="tel" className="w-full border border-gray-300 px-4 py-3 text-base focus:outline-none focus:border-black" placeholder="050-0000000" />
            </div>
            <div>
              <label className="block text-sm font-black mb-1">וואטסאפ</label>
              <input type="tel" className="w-full border border-gray-300 px-4 py-3 text-base focus:outline-none focus:border-black" placeholder="050-0000000" />
            </div>
          </div>

          <div className="flex gap-3 pt-2">
            <button onClick={() => setPosting(false)} className="flex-1 border-2 border-black py-3 font-bold hover:bg-gray-100 transition-colors">ביטול</button>
            <button className="flex-1 bg-black text-white py-3 font-black hover:bg-gray-900 transition-colors">פרסם משרה</button>
          </div>
        </div>
      )}

      {/* Jobs list */}
      <div>
        <h2 className="text-base font-black mb-3 uppercase tracking-wider">המשרות שלי ({jobs.length})</h2>
        <div className="space-y-3">
          {jobs.map(job => (
            <div key={job.id} className="border p-4 space-y-1" style={{ borderColor: job.job_type === 'SOS' ? '#FF0000' : '#e5e7eb' }}>
              <div className="flex items-start justify-between gap-2">
                <div className="flex-1">
                  <div className="flex items-center gap-2 flex-wrap">
                    {job.job_type === 'SOS' && <span className="text-xs font-black text-white bg-[#FF0000] px-2 py-0.5">SOS</span>}
                    <span className="font-black text-base">{job.title}</span>
                  </div>
                  <p className="text-sm text-gray-500 mt-0.5">{job.location}</p>
                  <p className="text-xs text-gray-400 mt-0.5">{ROLE_LABEL[job.required_role]}</p>
                </div>
                <button onClick={() => setJobs(prev => prev.filter(j => j.id !== job.id))} className="text-xs text-red-500 font-bold hover:text-red-700 shrink-0">מחק</button>
              </div>
              <p className="text-sm text-gray-600 leading-relaxed">{job.description}</p>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
