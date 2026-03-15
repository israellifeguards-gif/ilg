import type { NewsItem } from '@/types';

interface Props {
  items: NewsItem[];
}

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

export function NewsFeed({ items }: Props) {
  if (items.length === 0) {
    return (
      <div className="text-center py-12 text-sm text-gray-400">
        אין פריטי חדשות זמינים כרגע
      </div>
    );
  }

  return (
    <div className="space-y-3">
      <ul className="divide-y divide-gray-100">
        {items.map((item, i) => (
          <li key={i}>
            <a
              href={item.link}
              target="_blank"
              rel="noopener noreferrer"
              className="flex items-start gap-3 py-3 px-1 hover:bg-gray-50 transition-colors group rounded"
            >
              {/* Source color bar */}
              <div
                className="w-1 self-stretch rounded-full shrink-0 mt-0.5"
                style={{ backgroundColor: SOURCE_COLORS[item.source] ?? '#d1d5db', minHeight: 16 }}
              />

              {/* Content */}
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
                </div>
              </div>

              <span className="text-gray-300 group-hover:text-gray-500 transition-colors text-sm mt-0.5 shrink-0">←</span>
            </a>
          </li>
        ))}
      </ul>
    </div>
  );

}
