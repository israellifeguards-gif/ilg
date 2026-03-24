'use client';

import useSWR from 'swr';
import { useState } from 'react';
import type { NewsItem } from '@/types';

const SOURCE_COLORS: Record<string, string> = {
  'ynet':        '#ff6600',
  'וואלה':       '#0057b8',
  'ישראל היום':  '#c8102e',
  'מעריב':       '#1a1a2e',
};

function timeAgo(dateStr: string): string {
  const diff = Date.now() - new Date(dateStr).getTime();
  const mins = Math.floor(diff / 60000);
  if (mins < 2) return 'עכשיו';
  if (mins < 60) return `לפני ${mins} דק׳`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `לפני ${hours} שע׳`;
  const days = Math.floor(hours / 24);
  return `לפני ${days} ימים`;
}

function formatTime(dateStr: string): string {
  try {
    return new Date(dateStr).toLocaleTimeString('he-IL', {
      hour: '2-digit', minute: '2-digit', timeZone: 'Asia/Jerusalem',
    });
  } catch {
    return '';
  }
}

const PAGE = 12;
const fetcher = (url: string) => fetch(url).then(r => r.json());

export function NewsFeed() {
  const [visible, setVisible] = useState(PAGE);

  const { data: items, isLoading, isValidating, mutate, dataUpdatedAt } = useSWR<NewsItem[]>(
    '/api/news',
    fetcher,
    {
      refreshInterval:       10 * 60 * 1000,
      revalidateOnFocus:     false,
      revalidateOnReconnect: true,
      onSuccess: () => setVisible(PAGE), // reset to first page on refresh
    },
  );

  const list    = items ?? [];
  const shown   = list.slice(0, visible);
  const hasMore = visible < list.length;

  const lastRefresh = dataUpdatedAt
    ? new Date(dataUpdatedAt).toLocaleTimeString('he-IL', {
        hour: '2-digit', minute: '2-digit', timeZone: 'Asia/Jerusalem',
      })
    : null;

  if (isLoading) {
    return (
      <div className="space-y-3 py-2">
        {Array.from({ length: 6 }).map((_, i) => (
          <div key={i} className="flex gap-3 py-3 animate-pulse">
            <div className="w-1 rounded-full bg-gray-200 self-stretch" style={{ minHeight: 40 }} />
            <div className="flex-1 space-y-2">
              <div className="h-4 bg-gray-100 rounded w-4/5" />
              <div className="h-3 bg-gray-50 rounded w-1/3" />
            </div>
          </div>
        ))}
      </div>
    );
  }

  if (list.length === 0) {
    return (
      <div className="text-center py-12 text-sm text-gray-400">
        אין פריטי חדשות זמינים כרגע
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-3">
      {/* Toolbar */}
      <div className="flex items-center justify-between gap-2" dir="rtl">
        <span className="text-xs text-gray-400">
          {shown.length} מתוך {list.length} כתבות
          {lastRefresh && <> · עודכן {lastRefresh}</>}
          {isValidating && (
            <span className="inline-block w-3 h-3 border-2 border-gray-300 border-t-gray-600 rounded-full animate-spin mr-2 align-middle" />
          )}
        </span>
        <button
          onClick={() => mutate()}
          disabled={isValidating}
          className="text-xs px-2.5 py-1 border border-gray-200 rounded-lg text-gray-500
                     hover:border-gray-400 hover:text-black transition disabled:opacity-40"
        >
          ↻ רענן
        </button>
      </div>

      {/* News list */}
      <ul className="divide-y divide-gray-100">
        {shown.map((item, i) => (
          <li key={i}>
            <a
              href={item.link}
              target="_blank"
              rel="noopener noreferrer"
              className="flex items-start gap-3 py-3 px-1 hover:bg-gray-50 transition-colors group rounded"
            >
              <div
                className="w-1 self-stretch rounded-full shrink-0 mt-0.5"
                style={{ backgroundColor: SOURCE_COLORS[item.source] ?? '#d1d5db', minHeight: 16 }}
              />
              <div className="flex-1 min-w-0">
                <p className="font-bold text-black text-base leading-snug group-hover:text-gray-600 transition-colors">
                  {item.title}
                </p>
                <div className="flex items-center gap-2 mt-1">
                  <span
                    className="text-xs font-black px-1.5 py-0.5 rounded"
                    style={{ backgroundColor: SOURCE_COLORS[item.source] ?? '#333', color: '#fff', fontSize: 10 }}
                  >
                    {item.source}
                  </span>
                  <span className="text-xs text-gray-400">{timeAgo(item.pubDate)}</span>
                  <span className="text-xs text-gray-300 tabular-nums">{formatTime(item.pubDate)}</span>
                </div>
              </div>
              <span className="text-gray-300 group-hover:text-gray-500 transition-colors text-sm mt-0.5 shrink-0">←</span>
            </a>
          </li>
        ))}
      </ul>

      {/* Load more */}
      {hasMore && (
        <button
          onClick={() => setVisible(v => v + PAGE)}
          className="w-full py-3 border border-dashed border-gray-200 rounded-xl text-sm
                     text-gray-400 hover:border-gray-400 hover:text-black transition font-medium"
        >
          הצג עוד כתבות ({list.length - visible} נותרו)
        </button>
      )}
    </div>
  );
}
