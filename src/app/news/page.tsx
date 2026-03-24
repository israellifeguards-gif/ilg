import { NewsFeed } from '@/components/dashboard/NewsFeed';
import LiveWeatherWidget from '@/components/dashboard/LiveWeatherWidget';

export default function NewsPage() {
  return (
    <div dir="rtl" className="min-h-screen bg-gray-50">

      {/* Page header */}
      <div className="bg-white border-b border-gray-200 px-6 py-5">
        <h1 className="text-2xl font-black text-black tracking-tight">חדשות</h1>
        <p className="text-sm text-gray-400 mt-0.5">חדשות ומזג אוויר · מתרענן כל 10 דקות</p>
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

        {/* Right: news — client component, self-fetching */}
        <div className="lg:col-span-3">
          <div className="bg-white border border-gray-200 shadow-sm">
            <div className="px-5 py-3 border-b border-gray-100 flex items-center gap-2">
              <span className="text-base">📰</span>
              <span className="text-xs font-black uppercase tracking-widest text-gray-500">חדשות אחרונות</span>
            </div>
            <div className="p-4">
              <NewsFeed />
            </div>
          </div>
        </div>

      </div>
    </div>
  );
}
