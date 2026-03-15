'use client';

import { useState, useEffect, useCallback } from 'react';

const BASE_LAT = 31.5;
const BASE_LON = 35;
const ZOOM = 6;

const MAP_TABS = [
  { id: 'waves', label: 'גלים',  overlay: 'waves' },
  { id: 'wind',  label: 'רוח',   overlay: 'wind'  },
  { id: 'swell', label: 'סוול',  overlay: 'swell' },
  { id: 'rain',  label: 'גשם',   overlay: 'rain'  },
];

const REFRESH_MS = 10 * 60 * 1000;

const DARK = {
  bg:        '#060f1e',
  headBg:    '#0a1628',
  border:    '#1e293b',
  txt:       '#ffffff',
  txt2:      '#64748b',
  tabActive: '#1e3a5f',
  tabActiveTxt: '#38bdf8',
  tabBorder: '#2d4f7a',
  tabInactive: '#0f2035',
  tabInactiveTxt: '#94a3b8',
  btnBg:     '#1e3a5f',
  btnTxt:    '#38bdf8',
  btnBorder: '#2d4f7a',
  spinner:   '#38bdf8',
  loadingBg: '#060f1e',
};

const LIGHT = {
  bg:        '#ffffff',
  headBg:    '#ffffff',
  border:    '#000000',
  txt:       '#000000',
  txt2:      '#374151',
  tabActive: '#2a2a2a',
  tabActiveTxt: '#ffffff',
  tabBorder: '#000000',
  tabInactive: '#f5f5f5',
  tabInactiveTxt: '#000000',
  btnBg:     '#2a2a2a',
  btnTxt:    '#ffffff',
  btnBorder: '#000000',
  spinner:   '#000000',
  loadingBg: '#ffffff',
};

function buildWindyUrl(overlay: string) {
  return (
    `https://embed.windy.com/embed2.html` +
    `?lat=${BASE_LAT}&lon=${BASE_LON}` +
    `&detailLat=32.09&detailLon=34.77` +
    `&width=800&height=600` +
    `&zoom=${ZOOM}&level=surface` +
    `&overlay=${overlay}&product=ecmwf` +
    `&menu=&message=true&marker=true` +
    `&calendar=now&type=map&location=coordinates` +
    `&metricWind=default&metricTemp=default&radarRange=-1`
  );
}

export function MapsView() {
  const [activeTab, setActiveTab] = useState(MAP_TABS[0].id);
  const [iframeKey, setIframeKey] = useState(0);
  const [loading, setLoading] = useState(true);
  const [lastRefresh, setLastRefresh] = useState<string>('');
  const isDark = true;


  const refresh = useCallback(() => {
    setLoading(true);
    setIframeKey(k => k + 1);
    const d = new Date();
    setLastRefresh(`${String(d.getHours()).padStart(2,'0')}:${String(d.getMinutes()).padStart(2,'0')}`);
  }, []);

  useEffect(() => {
    const d = new Date();
    setLastRefresh(`${String(d.getHours()).padStart(2,'0')}:${String(d.getMinutes()).padStart(2,'0')}`);
    const interval = setInterval(refresh, REFRESH_MS);
    return () => clearInterval(interval);
  }, [refresh]);

  const handleTabChange = (id: string) => {
    setActiveTab(id);
    setLoading(true);
  };

  const activeMap = MAP_TABS.find(t => t.id === activeTab)!;
  const c = isDark ? DARK : LIGHT;

  return (
    <div dir="rtl" style={{ minHeight: '100vh', backgroundColor: c.bg }}>

      {/* Header */}
      <div style={{ backgroundColor: c.headBg, borderBottom: `1px solid ${c.border}`, padding: '16px 24px' }}>
        <div style={{ marginBottom: 16 }}>
          <div className="flex items-center gap-3">
            <h1 style={{ fontSize: 20, fontWeight: 900, color: c.txt }}>מפות מזג אוויר</h1>
            <button
              onClick={refresh}
              style={{ fontSize: 14, fontWeight: 700, padding: '8px 20px', backgroundColor: c.btnBg, color: c.btnTxt, border: `1px solid ${c.btnBorder}`, borderRadius: 6, cursor: 'pointer' }}
            >
              רענן
            </button>
            {lastRefresh && <span style={{ fontSize: 12, color: c.txt2 }}>עודכן {lastRefresh}</span>}
          </div>
          <p style={{ fontSize: 12, marginTop: 4, color: c.txt2 }}>מקור: Windy · ECMWF · רענון אוטומטי כל 10 דקות</p>
        </div>

        {/* Tabs */}
        <div className="flex gap-1">
          {MAP_TABS.map(tab => (
            <button
              key={tab.id}
              onClick={() => handleTabChange(tab.id)}
              style={{
                fontSize: 14, fontWeight: 900, padding: '8px 20px', cursor: 'pointer', transition: 'all 0.15s',
                backgroundColor: activeTab === tab.id ? c.tabActive : c.tabInactive,
                color: activeTab === tab.id ? c.tabActiveTxt : c.tabInactiveTxt,
                border: `1px solid ${c.tabBorder}`,
                borderRadius: 6,
              }}
            >
              {tab.label}
            </button>
          ))}
        </div>
      </div>

      {/* Map */}
      <div style={{ position: 'relative' }}>
        {loading && (
          <div style={{ position: 'absolute', inset: 0, display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 10, backgroundColor: c.loadingBg }}>
            <div style={{ textAlign: 'center' }}>
              <div style={{ width: 40, height: 40, border: `2px solid ${c.spinner}`, borderTopColor: 'transparent', borderRadius: '50%', animation: 'spin 0.8s linear infinite', margin: '0 auto 12px' }} />
              <div style={{ fontSize: 14, fontWeight: 700, color: c.txt }}>טוען מפה...</div>
            </div>
          </div>
        )}
        <div style={{ width: '100%', height: 'calc(100vh - 145px)', minHeight: 500 }}>
          <iframe
            key={`${activeTab}-${iframeKey}`}
            src={buildWindyUrl(activeMap.overlay)}
            style={{ width: '100%', height: '100%', border: 'none' }}
            title={activeMap.label}
            loading="lazy"
            onLoad={() => setLoading(false)}
            allowFullScreen
          />
        </div>
      </div>

      <style>{`@keyframes spin { to { transform: rotate(360deg); } }`}</style>
    </div>
  );
}
