'use client';

import { useState, useEffect } from 'react';
import { onAuthStateChanged } from 'firebase/auth';
import { auth } from '@/lib/firebase/config';
import { getUser } from '@/lib/firebase/firestore';
import { PostJobForm } from '@/components/employer/PostJobForm';
import type { Job } from '@/types';
import Link from 'next/link';

interface Props {
  job: Job;
  distanceKm?: number;
  onUpdated?: () => void;
}

export function JobCard({ job, distanceKm, onUpdated }: Props) {
  const isSOS = job.job_type === 'SOS';
  const [currentUid, setCurrentUid] = useState<string | null>(null);
  const [isApproved, setIsApproved] = useState(false);
  const [editing, setEditing] = useState(false);

  useEffect(() => {
    const unsub = onAuthStateChanged(auth, async (u) => {
      setCurrentUid(u?.uid ?? null);
      if (u) {
        const user = await getUser(u.uid);
        setIsApproved(!!user?.is_verified);
      } else {
        setIsApproved(false);
      }
    });
    return () => unsub();
  }, []);

  const isOwner = !!currentUid && currentUid === job.employer_uid;

  if (editing) {
    return (
      <div className={`border-2 p-4 ${isSOS ? 'border-[#FF0000]' : 'border-gray-200'}`}>
        <div className="flex items-center justify-between mb-4">
          <span className="font-black text-base">עריכת משרה</span>
          <button onClick={() => setEditing(false)} className="text-xs text-gray-400 hover:text-black">✕ ביטול</button>
        </div>
        <PostJobForm
          employerUid={job.employer_uid}
          editJob={job}
          onSuccess={() => { setEditing(false); onUpdated?.(); }}
          onCancel={() => setEditing(false)}
        />
      </div>
    );
  }

  return (
    <div
      className={`border-2 p-4 flex flex-col gap-3 ${
        isSOS ? 'border-[#FF0000] bg-red-50' : 'border-gray-200 bg-white'
      }`}
    >
      <div className="flex items-start justify-between gap-2">
        <div className="flex items-center gap-2">
          {isSOS && (
            <span className="bg-[#FF0000] text-white text-xs font-black px-2 py-0.5 uppercase tracking-wide">
              SOS
            </span>
          )}
          <h3 className="font-black text-base leading-tight">{job.title}</h3>
        </div>
        <div className="flex items-center gap-3 shrink-0">
          {distanceKm !== undefined && (
            <span className="text-xs text-gray-500 font-medium whitespace-nowrap">
              {distanceKm < 1 ? '< 1 ק״מ' : `${Math.round(distanceKm)} ק״מ`}
            </span>
          )}
          {isOwner && (
            <button
              onClick={() => setEditing(true)}
              className="text-xs font-bold text-blue-500 hover:text-blue-700"
            >
              עריכה
            </button>
          )}
        </div>
      </div>

      <p className="text-sm text-gray-600 leading-relaxed">{job.description}</p>

      <div className="flex items-center gap-1 text-sm text-gray-500">
        <span>📍</span>
        <span>{job.location.label}</span>
      </div>

      <div className="flex items-center gap-2 text-xs text-gray-400">
        <span>{new Date(job.created_at).toLocaleDateString('he-IL')}</span>
      </div>

      {isApproved ? (
        <div className="flex gap-2 pt-1">
          <a
            href={`tel:${job.contact.phone}`}
            className="flex-1 bg-black text-white text-center py-2.5 text-sm font-bold hover:bg-gray-900 transition-colors"
          >
            📞 התקשר
          </a>
          {job.contact.whatsapp && (
            <a
              href={`https://wa.me/${job.contact.whatsapp.replace(/\D/g, '')}`}
              target="_blank"
              rel="noopener noreferrer"
              className="flex-1 bg-green-600 text-white text-center py-2.5 text-sm font-bold hover:bg-green-700 transition-colors"
            >
              💬 WhatsApp
            </a>
          )}
        </div>
      ) : (
        <div className="flex items-center justify-between pt-1">
          <span className="text-xs text-gray-400 font-bold">🔒 לרשומים בלבד</span>
          <Link href="/register" className="text-xs font-black text-white bg-black px-3 py-1.5 rounded hover:bg-gray-800 transition-colors">
            הצטרפות
          </Link>
        </div>
      )}
    </div>
  );
}
