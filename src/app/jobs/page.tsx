'use client';

import { useEffect, useState } from 'react';
import { useSearchParams } from 'next/navigation';
import { getJobs } from '@/lib/firebase/firestore';
import { JobBoard } from '@/components/jobs/JobBoard';
import { EmployerPostButton } from '@/components/jobs/EmployerPostButton';
import type { Job } from '@/types';

export default function JobsPage() {
  const searchParams = useSearchParams();
  const isSOS = searchParams.get('type') === 'sos';
  const [jobs, setJobs] = useState<Job[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    getJobs().then(data => { setJobs(data); setLoading(false); });
  }, []);

  return (
    <div className="max-w-2xl mx-auto px-4 py-8 space-y-6">
      <div>
        <h1 className="text-2xl font-black mb-1">
          {isSOS ? '🆘 משרות SOS' : 'לוח משרות'}
        </h1>
        <p className="text-sm text-gray-500">
          {isSOS ? 'משרות דחופות בלבד' : 'משרות ברחבי הארץ'}
        </p>
      </div>
      <EmployerPostButton />
      {loading ? (
        <div className="flex justify-center py-16">
          <div className="w-8 h-8 border-2 border-black border-t-transparent rounded-full animate-spin" />
        </div>
      ) : (
        <JobBoard
          jobs={jobs}
          initialFilter={isSOS ? 'SOS' : 'Regular'}
          onJobUpdated={() => getJobs().then(setJobs)}
        />
      )}
    </div>
  );
}
