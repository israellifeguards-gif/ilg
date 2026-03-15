'use client';

import { useState } from 'react';
import { createCourse, updateCourse } from '@/lib/firebase/firestore';
import type { Course } from '@/types';

interface Props {
  publisherUid: string;
  onSuccess: () => void;
  onCancel: () => void;
  editCourse?: Course;
}

export function PostCourseForm({ publisherUid, onSuccess, onCancel, editCourse }: Props) {
  const [courseType, setCourseType] = useState<Course['course_type']>(editCourse?.course_type ?? 'Course');
  const [title, setTitle]           = useState(editCourse?.title ?? '');
  const [description, setDescription] = useState(editCourse?.description ?? '');
  const [location, setLocation]     = useState(editCourse?.location ?? '');
  const [date, setDate]             = useState(editCourse?.date ?? '');
  const [price, setPrice]           = useState(editCourse?.price ?? '');
  const [phone, setPhone]           = useState(editCourse?.contact.phone ?? '');
  const [whatsapp, setWhatsapp]     = useState(editCourse?.contact.whatsapp ?? '');
  const [loading, setLoading]       = useState(false);
  const [error, setError]           = useState('');

  const isEdit = !!editCourse;

  async function handleSubmit() {
    if (!title || !description || !location || !date || !phone) {
      setError('יש למלא את כל השדות החובה');
      return;
    }
    setLoading(true);
    setError('');
    try {
      const contact = { phone, ...(whatsapp ? { whatsapp } : {}) };
      if (isEdit) {
        const data: Parameters<typeof updateCourse>[1] = {
          course_type: courseType, title, description, location, date, contact,
        };
        if (price) data.price = price;
        await updateCourse(editCourse.id, data);
      } else {
        const courseData: Parameters<typeof createCourse>[0] = {
          course_type: courseType, title, description, location, date, contact,
          publisher_uid: publisherUid,
          created_at: new Date().toISOString(),
        };
        if (price) courseData.price = price;
        await createCourse(courseData);
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

      {/* Type toggle */}
      <div>
        <label className="block text-sm font-black mb-2">סוג</label>
        <div className="flex gap-3">
          {(['Course', 'Training'] as const).map(t => (
            <button
              key={t}
              onClick={() => setCourseType(t)}
              className="flex-1 py-3 font-black text-sm transition-colors"
              style={{
                backgroundColor: courseType === t ? '#000' : '#f1f5f9',
                color: courseType === t ? '#fff' : '#374151',
              }}
            >
              {t === 'Course' ? 'קורס' : 'השתלמות'}
            </button>
          ))}
        </div>
      </div>

      <div>
        <label className="block text-sm font-black mb-1">כותרת <span className="text-red-500">*</span></label>
        <input type="text" value={title} onChange={e => setTitle(e.target.value)}
          className="w-full border border-gray-300 px-4 py-3 text-base focus:outline-none focus:border-black"
          placeholder='לדוג׳: קורס הצלה ימית רמה א׳' />
      </div>

      <div>
        <label className="block text-sm font-black mb-1">תיאור <span className="text-red-500">*</span></label>
        <textarea value={description} onChange={e => setDescription(e.target.value)} rows={4}
          className="w-full border border-gray-300 px-4 py-3 text-base focus:outline-none focus:border-black resize-none"
          placeholder="תאר את הקורס, תכנים, דרישות קדם..." />
      </div>

      <div>
        <label className="block text-sm font-black mb-1">מיקום <span className="text-red-500">*</span></label>
        <input type="text" value={location} onChange={e => setLocation(e.target.value)}
          className="w-full border border-gray-300 px-4 py-3 text-base focus:outline-none focus:border-black"
          placeholder="לדוג׳: תל אביב, בריכת גורדון" />
      </div>

      <div className="grid grid-cols-2 gap-3">
        <div>
          <label className="block text-sm font-black mb-1">תאריך התחלה <span className="text-red-500">*</span></label>
          <input type="date" value={date} onChange={e => setDate(e.target.value)}
            className="w-full border border-gray-300 px-4 py-3 text-base focus:outline-none focus:border-black" />
        </div>
        <div>
          <label className="block text-sm font-black mb-1">מחיר</label>
          <input type="text" value={price} onChange={e => setPrice(e.target.value)}
            className="w-full border border-gray-300 px-4 py-3 text-base focus:outline-none focus:border-black"
            placeholder='לדוג׳: ₪800' />
        </div>
      </div>

      <div className="grid grid-cols-2 gap-3">
        <div>
          <label className="block text-sm font-black mb-1">טלפון <span className="text-red-500">*</span></label>
          <input type="tel" value={phone} onChange={e => setPhone(e.target.value)}
            className="w-full border border-gray-300 px-4 py-3 text-base focus:outline-none focus:border-black"
            placeholder="050-0000000" />
        </div>
        <div>
          <label className="block text-sm font-black mb-1">וואטסאפ</label>
          <input type="tel" value={whatsapp} onChange={e => setWhatsapp(e.target.value)}
            className="w-full border border-gray-300 px-4 py-3 text-base focus:outline-none focus:border-black"
            placeholder="050-0000000" />
        </div>
      </div>

      {error && <p className="text-red-500 text-sm text-center font-bold">{error}</p>}

      <div className="flex gap-3 pt-2">
        <button onClick={onCancel} className="flex-1 border-2 border-black py-3 font-bold hover:bg-gray-100 transition-colors">ביטול</button>
        <button onClick={handleSubmit} disabled={loading} className="flex-1 bg-black text-white py-3 font-black hover:bg-gray-900 transition-colors disabled:opacity-40">
          {loading ? 'שומר...' : isEdit ? 'שמור שינויים' : 'פרסם קורס'}
        </button>
      </div>
    </div>
  );
}
