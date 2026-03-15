'use client';

import { useEffect, useState } from 'react';
import { onAuthStateChanged } from 'firebase/auth';
import { auth } from '@/lib/firebase/config';
import { getUser, getCourses, deleteCourse } from '@/lib/firebase/firestore';
import { PostCourseForm } from '@/components/courses-portal/PostCourseForm';
import type { ILGUser, Course } from '@/types';

export default function CoursesPortalPage() {
  const [user, setUser]       = useState<ILGUser | null>(null);
  const [courses, setCourses] = useState<Course[]>([]);
  const [posting, setPosting] = useState(false);
  const [editingCourse, setEditingCourse] = useState<Course | null>(null);
  const [loading, setLoading] = useState(true);
  const [status, setStatus]   = useState<'idle' | 'not-logged-in' | 'not-courses' | 'not-verified'>('idle');

  useEffect(() => {
    const unsub = onAuthStateChanged(auth, async (firebaseUser) => {
      if (!firebaseUser) { setStatus('not-logged-in'); setLoading(false); return; }
      const ilgUser = await getUser(firebaseUser.uid);
      if (!ilgUser) { setStatus('not-logged-in'); setLoading(false); return; }
      if (ilgUser.role !== 'Courses' && ilgUser.role !== 'Admin') { setStatus('not-courses'); setLoading(false); return; }
      if (!ilgUser.is_verified && ilgUser.role !== 'Admin') { setStatus('not-verified'); setLoading(false); return; }
      setUser(ilgUser);
      await loadCourses(firebaseUser.uid);
      setLoading(false);
    });
    return () => unsub();
  }, []);

  async function loadCourses(uid: string) {
    const all = await getCourses();
    setCourses(all.filter(c => c.publisher_uid === uid));
  }

  async function handleDelete(courseId: string) {
    await deleteCourse(courseId);
    setCourses(prev => prev.filter(c => c.id !== courseId));
  }

  function handleSuccess() {
    setPosting(false);
    setEditingCourse(null);
    if (user) loadCourses(user.uid);
  }

  if (loading) {
    return (
      <div className="flex items-center justify-center min-h-screen">
        <div className="w-8 h-8 border-2 border-black border-t-transparent rounded-full animate-spin" />
      </div>
    );
  }

  if (status === 'not-logged-in') return <div className="text-center py-20 font-bold">יש להתחבר תחילה</div>;
  if (status === 'not-courses')   return <div className="text-center py-20 font-bold">עמוד זה מיועד למפרסמי קורסים בלבד</div>;
  if (status === 'not-verified') {
    return (
      <div className="text-center py-20 px-6 space-y-2">
        <p className="text-xl font-black">החשבון שלך בבדיקה</p>
        <p className="text-gray-500 text-sm">לאחר אישור תוכל לפרסם קורסים</p>
      </div>
    );
  }

  return (
    <div className="w-full max-w-xl mx-auto px-4 py-6" dir="rtl">

      {/* Header */}
      <div className="mb-6">
        <h1 className="text-2xl font-black">שלום, {user?.displayName}</h1>
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

      {/* Post / Edit form */}
      {(posting || editingCourse) && user && (
        <div className="mb-8 border border-gray-200 p-5">
          <h2 className="text-lg font-black mb-5">{editingCourse ? 'עריכת קורס' : 'פרסום קורס חדש'}</h2>
          <PostCourseForm
            publisherUid={user.uid}
            onSuccess={handleSuccess}
            onCancel={() => { setPosting(false); setEditingCourse(null); }}
            editCourse={editingCourse ?? undefined}
          />
        </div>
      )}

      {/* Courses list */}
      <div>
        <h2 className="text-base font-black mb-3 uppercase tracking-wider">הקורסים שלי ({courses.length})</h2>

        {courses.length === 0 ? (
          <p className="text-gray-400 text-sm text-center py-10">עדיין לא פרסמת קורסים</p>
        ) : (
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
                  <div className="flex gap-3 shrink-0">
                    <button
                      onClick={() => { setEditingCourse(course); setPosting(false); }}
                      className="text-xs text-blue-500 font-bold hover:text-blue-700"
                    >
                      עריכה
                    </button>
                    <button
                      onClick={() => handleDelete(course.id)}
                      className="text-xs text-red-500 font-bold hover:text-red-700"
                    >
                      מחק
                    </button>
                  </div>
                </div>
                <p className="text-sm text-gray-600 leading-relaxed">{course.description}</p>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
