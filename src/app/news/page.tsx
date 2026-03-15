import { NewsFeed } from '@/components/dashboard/NewsFeed';
import LiveWeatherWidget from '@/components/dashboard/LiveWeatherWidget';
import { fetchNews } from '@/lib/api/news';

export const revalidate = 900; // revalidate every 15 min

export default async function NewsPage() {
  const newsItems = await fetchNews().catch(() => []);

  return (
    <div dir="rtl" className="min-h-screen bg-gray-50">

      {/* Page header */}
      <div className="bg-white border-b border-gray-200 px-6 py-5">
        <h1 className="text-2xl font-black text-black tracking-tight">חדשות</h1>
        <p className="text-sm text-gray-400 mt-0.5">חדשות ומזג אוויר</p>
      </div>

      {/* Content grid */}
      <div className="max-w-7xl mx-auto px-4 py-6 lg:grid lg:grid-cols-5 lg:gap-6 gap-0">

        {/* Left: weather */}
        <div className="lg:col-span-2 mb-6 lg:mb-0">
          <div className="bg-white border border-gray-200 shadow-sm">
            <div className="px-5 py-3 border-b border-gray-100 flex items-center gap-2">
              <span className="text-base">🌤️</span>
              <span className="text-xs font-black uppercase tracking-widest text-gray-500">מזג אוויר עכשיו – תל אביב</span>
            </div>
            <div className="p-4">
              <LiveWeatherWidget />
            </div>
          </div>
        </div>

        {/* Right: news */}
        <div className="lg:col-span-3">
          <div className="bg-white border border-gray-200 shadow-sm">
            <div className="px-5 py-3 border-b border-gray-100 flex items-center justify-between">
              <div className="flex items-center gap-2">
                <span className="text-base">📰</span>
                <span className="text-xs font-black uppercase tracking-widest text-gray-500">חדשות אחרונות</span>
              </div>
              <span className="text-xs text-gray-400 font-medium">
                {newsItems.length > 0 ? `${newsItems.length} כתבות` : ''}
              </span>
            </div>
            <div className="p-4">
              <NewsFeed items={newsItems} />
            </div>
          </div>
        </div>

      </div>
    </div>
  );
}
