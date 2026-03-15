'use client';
import Link from 'next/link';
import Image from 'next/image';
import { useEffect } from 'react';

export default function LandingPage() {
  useEffect(() => {
    document.body.style.overflow = 'hidden';
    return () => { document.body.style.overflow = ''; };
  }, []);

  return (
    <div className="relative h-screen overflow-hidden flex flex-col items-center justify-center">

      {/* Sky gradient */}
      <div className="absolute inset-0" style={{
        background: 'linear-gradient(to bottom, #87CEEB 0%, #b8e4f7 40%, #d4f1ff 60%, #f5e6c8 85%, #e8c99a 100%)'
      }} />

      {/* Sun */}
      <div className="absolute" style={{
        top: '18%', right: '12%',
        width: 64, height: 64,
        borderRadius: '50%',
        background: 'radial-gradient(circle, #fff9c4 0%, #ffe066 60%, #ffb300 100%)',
        boxShadow: '0 0 40px 15px rgba(255,220,50,0.35)',
        animation: 'sunPulse 4s ease-in-out infinite',
      }} />

      {/* Seagulls */}
      <svg className="absolute" style={{ top: '22%', left: '10%', animation: 'float 6s ease-in-out infinite' }} width="80" height="30" viewBox="0 0 80 30">
        <path d="M0 15 Q10 5 20 15" fill="none" stroke="#334155" strokeWidth="2" strokeLinecap="round"/>
        <path d="M25 12 Q35 2 45 12" fill="none" stroke="#334155" strokeWidth="2" strokeLinecap="round"/>
        <path d="M55 10 Q63 3 71 10" fill="none" stroke="#334155" strokeWidth="1.5" strokeLinecap="round"/>
      </svg>

      {/* Content */}
      <div className="relative z-10 flex flex-col items-center text-center px-6" style={{ marginBottom: '30vh' }}>
        <div className="w-36 h-36 md:w-48 md:h-48 relative mb-2 drop-shadow-lg mt-8" style={{ animation: 'float 5s ease-in-out infinite', marginTop: 60 }}>
          <Image src="/assets/logo.png" alt="ILG Logo" fill className="object-contain" priority />
        </div>

        <h1 className="text-3xl md:text-5xl font-black leading-tight mb-3 max-w-2xl drop-shadow-sm" style={{ color: '#0a1628' }}>
          הבית החדש של המצילים בישראל
          <span className="text-[#FF0000]"> ILG</span>
        </h1>

        <p className="text-base md:text-lg font-medium max-w-xl mb-8 leading-relaxed" style={{ color: '#1e3a5f' }}>
          עדכונים חמים, תחזיות, משרות עבודה, קורסים ועוד...הכל במקום אחד.
        </p>

        <Link
          href="/register"
          className="text-white text-lg font-black px-10 py-4 shadow-xl transition-all hover:scale-105 active:scale-95"
          style={{ backgroundColor: '#FF0000', borderRadius: 4 }}
        >
          הצטרפות לקהילה
        </Link>
      </div>

      {/* Wave layer 1 (back) */}
      <div className="absolute" style={{ bottom: '18%', left: '-10%', width: '120%', overflow: 'hidden' }}>
        <svg viewBox="0 0 1440 120" preserveAspectRatio="none" style={{ width: '100%', height: 80, animation: 'wave1 7s ease-in-out infinite', opacity: 0.5 }}>
          <path d="M0,60 C180,100 360,20 540,60 C720,100 900,20 1080,60 C1260,100 1350,40 1440,60 L1440,120 L0,120 Z" fill="#3b82f6"/>
        </svg>
      </div>

      {/* Wave layer 2 (mid) */}
      <div className="absolute" style={{ bottom: '14%', left: '-20%', width: '140%' }}>
        <svg viewBox="0 0 1440 120" preserveAspectRatio="none" style={{ width: '100%', height: 90, animation: 'wave2 5s ease-in-out infinite', opacity: 0.75 }}>
          <path d="M0,40 C200,80 400,10 600,50 C800,90 1000,20 1200,50 C1320,70 1380,30 1440,40 L1440,120 L0,120 Z" fill="#1d6fa4"/>
        </svg>
      </div>

      {/* Wave layer 3 (front) */}
      <div className="absolute" style={{ bottom: '10%', left: '-10%', width: '120%', overflow: 'hidden' }}>
        <svg viewBox="0 0 1440 120" preserveAspectRatio="none" style={{ width: '100%', height: 100, animation: 'wave3 4s ease-in-out infinite' }}>
          <path d="M0,50 C150,90 300,15 450,55 C600,95 750,25 900,55 C1050,85 1200,30 1440,50 L1440,120 L0,120 Z" fill="#0a4f7a"/>
        </svg>
      </div>

      {/* Sand */}
      <div className="absolute bottom-0 w-full" style={{
        height: '12%',
        background: 'linear-gradient(to bottom, #e8c99a 0%, #d4a96a 100%)',
      }}>
        {[...Array(18)].map((_, i) => (
          <div key={i} className="absolute rounded-full" style={{
            width: 4 + (i % 3) * 2,
            height: 3 + (i % 2),
            backgroundColor: 'rgba(180,130,60,0.3)',
            left: `${(i * 5.8) % 95}%`,
            top: `${20 + (i % 4) * 18}%`,
          }} />
        ))}
      </div>

      {/* CSS Animations */}
      <style>{`
        @keyframes wave1 {
          0%, 100% { transform: translateX(0); }
          50% { transform: translateX(-40px); }
        }
        @keyframes wave2 {
          0%, 100% { transform: translateX(0); }
          50% { transform: translateX(35px); }
        }
        @keyframes wave3 {
          0%, 100% { transform: translateX(0); }
          50% { transform: translateX(-30px); }
        }
        @keyframes float {
          0%, 100% { transform: translateY(40px); }
          50% { transform: translateY(30px); }
        }
        @keyframes sunPulse {
          0%, 100% { box-shadow: 0 0 40px 15px rgba(255,220,50,0.35); }
          50% { box-shadow: 0 0 60px 25px rgba(255,220,50,0.5); }
        }
      `}</style>
    </div>
  );
}
