'use client';

import { useEffect, useState } from 'react';
import { onAuthStateChanged } from 'firebase/auth';
import { auth } from '@/lib/firebase/config';
import { getCourses } from '@/lib/firebase/firestore';
import { CoursesPostButton } from '@/components/courses/CoursesPostButton';
import { PostCourseForm } from '@/components/courses-portal/PostCourseForm';
import type { Course } from '@/types';

export default function CoursesPage() {
  const [courses, setCourses] = useState<Course[]>([]);
  const [search, setSearch]   = useState('');
  const [loading, setLoading] = useState(true);
  const [currentUid, setCurrentUid] = useState<string | null>(null);
  const [editingCourse, setEditingCourse] = useState<Course | null>(null);

  useEffect(() => {
    const unsub = onAuthStateChanged(auth, (u) => setCurrentUid(u?.uid ?? null));
    return () => unsub();
  }, []);

  function loadCourses() {
    getCourses().then(data => { setCourses(data); setLoading(false); });
  }

  useEffect(() => { loadCourses(); }, []);

  const filtered = courses.filter(c => {
    const q = search.toLowerCase();
    return (
      c.title.toLowerCase().includes(q) ||
      c.description.toLowerCase().includes(q) ||
      c.location.toLowerCase().includes(q)
    );
  });

  return (
    <div className="max-w-2xl mx-auto px-4 py-8" dir="rtl">

      {/* Header */}
      <div className="mb-4">
        <h1 className="text-2xl font-black mb-1">קורסים</h1>
        <p className="text-sm text-gray-500">קורסים והשתלמויות מקצועיות</p>
      </div>

      <CoursesPostButton />

      {/* Search */}
      <div className="relative mb-6">
        <input
          type="text"
          value={search}
          onChange={e => setSearch(e.target.value)}
          placeholder="חיפוש לפי שם, מיקום, תיאור..."
          className="w-full border border-gray-300 px-4 py-3 pr-10 text-base focus:outline-none focus:border-black"
        />
        <span className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400 text-lg">🔍</span>
      </div>

      {/* List */}
      {loading ? (
        <div className="flex justify-center py-16">
          <div className="w-8 h-8 border-2 border-black border-t-transparent rounded-full animate-spin" />
        </div>
      ) : filtered.length === 0 ? (
        <div className="bg-[#0a1628] rounded-lg p-6 text-center">
          <div className="text-4xl mb-3">📋</div>
          <p className="text-white font-bold text-lg mb-1">
            {search ? 'לא נמצאו קורסים' : 'אין קורסים פעילים כרגע'}
          </p>
          <p className="text-gray-400 text-sm">
            {search ? 'נסה מילות חיפוש אחרות' : 'קורסים קרובים יפורסמו כאן בקרוב'}
          </p>
        </div>
      ) : (
        <div className="flex flex-col gap-4">
          {filtered.map(course => {
            const isOwner = !!currentUid && currentUid === course.publisher_uid;
            const isEditing = editingCourse?.id === course.id;

            if (isEditing) {
              return (
                <div key={course.id} className="border border-gray-200 p-4">
                  <div className="flex items-center justify-between mb-4">
                    <span className="font-black text-base">עריכת קורס</span>
                    <button onClick={() => setEditingCourse(null)} className="text-xs text-gray-400 hover:text-black">✕ ביטול</button>
                  </div>
                  <PostCourseForm
                    publisherUid={course.publisher_uid}
                    editCourse={course}
                    onSuccess={() => { setEditingCourse(null); loadCourses(); }}
                    onCancel={() => setEditingCourse(null)}
                  />
                </div>
              );
            }

            return (
              <div key={course.id} className="border border-gray-200 p-4 space-y-2">
                <div className="flex items-start justify-between gap-2">
                  <div className="flex items-center gap-2 flex-wrap flex-1">
                    <span className="text-xs font-black text-white bg-black px-2 py-0.5">
                      {course.course_type === 'Course' ? 'קורס' : 'השתלמות'}
                    </span>
                    <span className="font-black text-lg">{course.title}</span>
                  </div>
                  {isOwner && (
                    <button
                      onClick={() => setEditingCourse(course)}
                      className="text-xs font-bold text-blue-500 hover:text-blue-700 shrink-0"
                    >
                      עריכה
                    </button>
                  )}
                </div>
                <p className="text-sm text-gray-600 leading-relaxed">{course.description}</p>
                <div className="flex flex-wrap gap-3 text-xs text-gray-500 font-medium">
                  <span>📍 {course.location}</span>
                  <span>📅 {new Date(course.date).toLocaleDateString('he-IL')}</span>
                  {course.price && <span>💰 {course.price}</span>}
                  <span>📞 {course.contact.phone}</span>
                </div>
                <div className="flex gap-3 pt-1">
                  <a
                    href={`tel:${course.contact.phone}`}
                    className="flex-1 text-center py-2 text-sm font-black bg-black text-white hover:bg-gray-900 transition-colors"
                  >
                    התקשר
                  </a>
                  {course.contact.whatsapp && (
                    <a
                      href={`https://wa.me/972${course.contact.whatsapp.replace(/^0/, '').replace(/-/g, '')}`}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="flex-1 text-center py-2 text-sm font-black bg-green-500 text-white hover:bg-green-600 transition-colors"
                    >
                      וואטסאפ
                    </a>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
