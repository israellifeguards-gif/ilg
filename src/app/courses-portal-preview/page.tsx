'use client';

import { useState } from 'react';

const MOCK_COURSES = [
  { id: '1', course_type: 'Course',   title: 'קורס הצלה ימית רמה א׳', location: 'תל אביב, חוף הילטון', date: '2025-07-01', price: '₪800',  description: 'קורס מקיף להכשרת מצילים ימיים, כולל תרגולים מעשיים ותיאוריה.' },
  { id: '2', course_type: 'Training', title: 'השתלמות החייאה מתקדמת',  location: 'חיפה, בריכה עירונית', date: '2025-06-15', price: '₪350', description: 'השתלמות מרוכזת ליום אחד לחידוש ידע בהחייאה ועזרה ראשונה.' },
];

export default function CoursesPortalPreview() {
  const [posting, setPosting]   = useState(false);
  const [courseType, setCourseType] = useState<'Course' | 'Training'>('Course');
  const [courses, setCourses]   = useState(MOCK_COURSES);

  return (
    <div className="w-full max-w-xl mx-auto px-4 py-6" dir="rtl">

      {/* Header */}
      <div className="mb-6">
        <p className="text-xs text-gray-400 mb-1">תצוגה מקדימה בלבד</p>
        <h1 className="text-2xl font-black">שלום, דני כהן</h1>
        <p className="text-sm text-gray-500 mt-1">לוח ניהול קורסים</p>
      </div>

      {/* Post button */}
      {!posting && (
        <button
          onClick={() => setPosting(true)}
          className="w-full bg-black text-white py-4 font-black text-base mb-8 hover:bg-gray-900 transition-colors"
        >
          + פרסם קורס חדש
        </button>
      )}

      {/* Form */}
      {posting && (
        <div className="mb-8 border border-gray-200 p-5 space-y-5">
          <h2 className="text-lg font-black">פרסום קורס חדש</h2>

          {/* Type toggle */}
          <div>
            <label className="block text-sm font-black mb-2">סוג</label>
            <div className="flex gap-3">
              {(['Course', 'Training'] as const).map(t => (
                <button key={t} onClick={() => setCourseType(t)}
                  className="flex-1 py-3 font-black text-sm transition-colors"
                  style={{ backgroundColor: courseType === t ? '#000' : '#f1f5f9', color: courseType === t ? '#fff' : '#374151' }}>
                  {t === 'Course' ? 'קורס' : 'השתלמות'}
                </button>
              ))}
            </div>
          </div>

          {/* Title */}
          <div>
            <label className="block text-sm font-black mb-1">כותרת <span className="text-red-500">*</span></label>
            <input type="text" className="w-full border border-gray-300 px-4 py-3 text-base focus:outline-none focus:border-black" placeholder="לדוג׳: קורס הצלה ימית רמה א׳" />
          </div>

          {/* Description */}
          <div>
            <label className="block text-sm font-black mb-1">תיאור <span className="text-red-500">*</span></label>
            <textarea rows={4} className="w-full border border-gray-300 px-4 py-3 text-base focus:outline-none focus:border-black resize-none" placeholder="תאר את הקורס, תכנים, דרישות קדם..." />
          </div>

          {/* Location */}
          <div>
            <label className="block text-sm font-black mb-1">מיקום <span className="text-red-500">*</span></label>
            <input type="text" className="w-full border border-gray-300 px-4 py-3 text-base focus:outline-none focus:border-black" placeholder="לדוג׳: תל אביב, בריכת גורדון" />
          </div>

          {/* Date + Price */}
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-sm font-black mb-1">תאריך התחלה <span className="text-red-500">*</span></label>
              <input type="date" className="w-full border border-gray-300 px-4 py-3 text-base focus:outline-none focus:border-black" />
            </div>
            <div>
              <label className="block text-sm font-black mb-1">מחיר</label>
              <input type="text" className="w-full border border-gray-300 px-4 py-3 text-base focus:outline-none focus:border-black" placeholder="לדוג׳: ₪800" />
            </div>
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
            <button className="flex-1 bg-black text-white py-3 font-black hover:bg-gray-900 transition-colors">פרסם קורס</button>
          </div>
        </div>
      )}

      {/* Courses list */}
      <div>
        <h2 className="text-base font-black mb-3 uppercase tracking-wider">הקורסים שלי ({courses.length})</h2>
        <div className="space-y-3">
          {courses.map(course => (
            <div key={course.id} className="border border-gray-200 p-4 space-y-1">
              <div className="flex items-start justify-between gap-2">
                <div className="flex-1">
                  <div className="flex items-center gap-2 flex-wrap">
                    <span className="text-xs font-black text-white bg-black px-2 py-0.5">
                      {course.course_type === 'Course' ? 'קורס' : 'השתלמות'}
                    </span>
                    <span className="font-black text-base">{course.title}</span>
                  </div>
                  <p className="text-sm text-gray-500 mt-0.5">{course.location}</p>
                  <p className="text-xs text-gray-400 mt-0.5">
                    {new Date(course.date).toLocaleDateString('he-IL')}
                    {course.price && ` · ${course.price}`}
                  </p>
                </div>
                <button onClick={() => setCourses(prev => prev.filter(c => c.id !== course.id))} className="text-xs text-red-500 font-bold hover:text-red-700 shrink-0">מחק</button>
              </div>
              <p className="text-sm text-gray-600 leading-relaxed">{course.description}</p>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
