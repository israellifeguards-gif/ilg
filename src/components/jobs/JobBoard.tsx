'use client';

import { useState, useEffect } from 'react';
import { JobCard } from './JobCard';
import { filterJobsByRadius, haversineDistance } from '@/lib/utils/haversine';
import type { Job, RequiredRole } from '@/types';

const ROLE_OPTIONS: { label: string; value: RequiredRole | 'all' }[] = [
  { label: 'כל התפקידים', value: 'all' },
  { label: 'מציל/ה ים', value: 'SeaLifeguard' },
  { label: 'מציל/ה בריכה', value: 'PoolLifeguard' },
  { label: 'עוזר/ת מציל', value: 'AssistantLifeguard' },
  { label: 'מפעיל/ת בריכה', value: 'PoolOperator' },
];

const RADIUS_OPTIONS = [
  { label: '5 ק״מ', value: 5 },
  { label: '20 ק״מ', value: 20 },
  { label: '50 ק״מ', value: 50 },
  { label: '100 ק״מ', value: 100 },
  { label: 'ארצי', value: 0 },
];

interface Props {
  jobs: Job[];
  initialFilter?: 'all' | 'SOS' | 'Regular';
  onJobUpdated?: () => void;
}

export function JobBoard({ jobs, initialFilter = 'all', onJobUpdated }: Props) {
  const [radius, setRadius] = useState(0);
  const [userPos, setUserPos] = useState<{ lat: number; lng: number } | null>(null);
  const [filter, setFilter] = useState<'all' | 'SOS' | 'Regular'>(initialFilter);
  const [roleFilter, setRoleFilter] = useState<RequiredRole | 'all'>('all');

  useEffect(() => {
    if (navigator.geolocation) {
      navigator.geolocation.getCurrentPosition(
        (pos) => setUserPos({ lat: pos.coords.latitude, lng: pos.coords.longitude }),
        () => setUserPos(null)
      );
    }
  }, []);

  let filtered = jobs;

  if (filter !== 'all') {
    filtered = filtered.filter((j) => j.job_type === filter);
  }

  if (roleFilter !== 'all') {
    filtered = filtered.filter((j) => j.required_role === roleFilter);
  }

  if (radius > 0 && userPos) {
    filtered = filterJobsByRadius(filtered, userPos.lat, userPos.lng, radius);
  }

  // SOS always first
  filtered = [...filtered].sort((a, b) =>
    a.job_type === 'SOS' && b.job_type !== 'SOS' ? -1 : 1
  );

  function distFor(job: Job): number | undefined {
    if (!userPos) return undefined;
    return haversineDistance(userPos.lat, userPos.lng, job.location.lat, job.location.lng);
  }

  return (
    <div className="space-y-4">
      {/* Filters */}
      <div className="flex flex-wrap items-center gap-2">
        <select
          value={radius}
          onChange={(e) => setRadius(Number(e.target.value))}
          className="border border-gray-300 px-3 py-1.5 text-xs font-medium focus:outline-none focus:border-black bg-white"
        >
          {RADIUS_OPTIONS.map((o) => (
            <option key={o.value} value={o.value}>{o.label}</option>
          ))}
        </select>
        <select
          value={roleFilter}
          onChange={(e) => setRoleFilter(e.target.value as RequiredRole | 'all')}
          className="border border-gray-300 px-3 py-1.5 text-xs font-medium focus:outline-none focus:border-black bg-white"
        >
          {ROLE_OPTIONS.map((o) => (
            <option key={o.value} value={o.value}>{o.label}</option>
          ))}
        </select>
        {!userPos && radius > 0 && (
          <span className="text-xs text-gray-400">אפשר גישה למיקום לסינון לפי מרחק</span>
        )}
      </div>

      {/* Job list */}
      {filtered.length === 0 ? (
        <div className="text-center py-12 text-gray-400 text-sm">
          אין משרות פתוחות בטווח שנבחר
        </div>
      ) : (
        <div className="space-y-3">
          {filtered.map((job) => (
            <JobCard key={job.id} job={job} distanceKm={distFor(job)} onUpdated={onJobUpdated} />
          ))}
        </div>
      )}
    </div>
  );
}
