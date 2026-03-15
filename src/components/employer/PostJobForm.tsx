'use client';

import { useState } from 'react';
import { createJob, updateJob } from '@/lib/firebase/firestore';
import type { Job, JobType, RequiredRole } from '@/types';

const ROLE_OPTIONS: { value: RequiredRole; label: string }[] = [
  { value: 'SeaLifeguard',       label: 'מציל/ה ים' },
  { value: 'PoolLifeguard',      label: 'מציל/ה בריכה' },
  { value: 'AssistantLifeguard', label: 'עוזר/ת מציל' },
  { value: 'PoolOperator',       label: 'מפעיל/ת בריכה' },
];

interface Props {
  employerUid: string;
  onSuccess: () => void;
  onCancel: () => void;
  editJob?: Job;
}

export function PostJobForm({ employerUid, onSuccess, onCancel, editJob }: Props) {
  const [jobType, setJobType]           = useState<JobType>(editJob?.job_type ?? 'Regular');
  const [title, setTitle]               = useState(editJob?.title ?? '');
  const [description, setDescription]   = useState(editJob?.description ?? '');
  const [requiredRole, setRequiredRole] = useState<RequiredRole | null>(editJob?.required_role ?? null);
  const [location, setLocation]         = useState(editJob?.location.label ?? '');
  const [phone, setPhone]               = useState(editJob?.contact.phone ?? '');
  const [whatsapp, setWhatsapp]         = useState(editJob?.contact.whatsapp ?? '');
  const [loading, setLoading]           = useState(false);
  const [error, setError]               = useState('');

  const isEdit = !!editJob;

  async function handleSubmit() {
    if (!title || !description || !requiredRole || !location || !phone) {
      setError('יש למלא את כל השדות החובה');
      return;
    }
    setLoading(true);
    setError('');
    try {
      const contact = { phone, ...(whatsapp ? { whatsapp } : {}) };
      if (isEdit) {
        await updateJob(editJob.id, {
          job_type: jobType,
          title,
          description,
          required_role: requiredRole,
          location: { lat: editJob.location.lat, lng: editJob.location.lng, label: location },
          contact,
        });
      } else {
        await createJob({
          job_type: jobType,
          title,
          description,
          required_role: requiredRole,
          location: { lat: 0, lng: 0, label: location },
          contact,
          employer_uid: employerUid,
          created_at: new Date().toISOString(),
        });
      }
      onSuccess();
    } catch (err) {
      console.error(err);
      setError('אירעה שגיאה. נסה שוב.');
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="space-y-5" dir="rtl">

      {/* Job type toggle */}
      <div>
        <label className="block text-sm font-black mb-2">סוג משרה</label>
        <div className="flex gap-3">
          {(['Regular', 'SOS'] as JobType[]).map(t => (
            <button
              key={t}
              onClick={() => setJobType(t)}
              className="flex-1 py-3 font-black text-sm transition-colors"
              style={{
                backgroundColor: jobType === t ? (t === 'SOS' ? '#FF0000' : '#000') : '#f1f5f9',
                color: jobType === t ? '#fff' : '#374151',
              }}
            >
              {t === 'SOS' ? '🆘 SOS – דחוף' : 'משרה רגילה'}
            </button>
          ))}
        </div>
        {jobType === 'SOS' && (
          <div className="mt-3 flex gap-2 p-3 rounded border border-red-300 bg-red-50">
            <span className="text-red-500 text-lg leading-none mt-0.5">⚠️</span>
            <p className="text-sm font-bold text-red-700">
              מודעות SOS מיועדות לתשלום יומי / חד פעמי בלבד.
              אין לפרסם משרות קבועות תחת קטגוריה זו, מודעות לא רלוונטיות יימחקו.
            </p>
          </div>
        )}
      </div>

      {/* Required role */}
      <div>
        <label className="block text-sm font-black mb-2">איזה מקצוען אתה מחפש? <span className="text-red-500">*</span></label>
        <div className="grid grid-cols-2 gap-2">
          {ROLE_OPTIONS.map(r => (
            <button
              key={r.value}
              onClick={() => setRequiredRole(r.value)}
              className="py-3 px-4 text-sm font-bold transition-colors text-right"
              style={{
                backgroundColor: requiredRole === r.value ? '#000' : '#f1f5f9',
                color: requiredRole === r.value ? '#fff' : '#374151',
                border: requiredRole === r.value ? '2px solid #000' : '2px solid transparent',
              }}
            >
              {r.label}
            </button>
          ))}
        </div>
      </div>

      {/* Title */}
      <div>
        <label className="block text-sm font-black mb-1">כותרת המשרה <span className="text-red-500">*</span></label>
        <input
          type="text"
          value={title}
          onChange={e => setTitle(e.target.value)}
          className="w-full border border-gray-300 px-4 py-3 text-base focus:outline-none focus:border-black"
          placeholder='לדוג׳: דרוש מציל לחוף תל אביב'
        />
      </div>

      {/* Description */}
      <div>
        <label className="block text-sm font-black mb-1">תיאור המשרה <span className="text-red-500">*</span></label>
        <textarea
          value={description}
          onChange={e => setDescription(e.target.value)}
          rows={4}
          className="w-full border border-gray-300 px-4 py-3 text-base focus:outline-none focus:border-black resize-none"
          placeholder="תאר את המשרה, שעות, תנאים..."
        />
      </div>

      {/* Location */}
      <div>
        <label className="block text-sm font-black mb-1">מיקום <span className="text-red-500">*</span></label>
        <input
          type="text"
          value={location}
          onChange={e => setLocation(e.target.value)}
          className="w-full border border-gray-300 px-4 py-3 text-base focus:outline-none focus:border-black"
          placeholder="לדוג׳: תל אביב, חוף הילטון"
        />
      </div>

      {/* Contact */}
      <div className="grid grid-cols-2 gap-3">
        <div>
          <label className="block text-sm font-black mb-1">טלפון <span className="text-red-500">*</span></label>
          <input
            type="tel"
            value={phone}
            onChange={e => setPhone(e.target.value)}
            className="w-full border border-gray-300 px-4 py-3 text-base focus:outline-none focus:border-black"
            placeholder="050-0000000"
          />
        </div>
        <div>
          <label className="block text-sm font-black mb-1">וואטסאפ</label>
          <input
            type="tel"
            value={whatsapp}
            onChange={e => setWhatsapp(e.target.value)}
            className="w-full border border-gray-300 px-4 py-3 text-base focus:outline-none focus:border-black"
            placeholder="050-0000000"
          />
        </div>
      </div>

      {error && <p className="text-red-500 text-sm text-center font-bold">{error}</p>}

      <div className="flex gap-3 pt-2">
        <button onClick={onCancel} className="flex-1 border-2 border-black py-3 font-bold hover:bg-gray-100 transition-colors">ביטול</button>
        <button onClick={handleSubmit} disabled={loading} className="flex-1 bg-black text-white py-3 font-black hover:bg-gray-900 transition-colors disabled:opacity-40">
          {loading ? 'שומר...' : isEdit ? 'שמור שינויים' : 'פרסם משרה'}
        </button>
      </div>
    </div>
  );
}
