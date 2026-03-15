import type { Metadata } from 'next';
import './globals.css';
import { GlobalAlertBanner } from '@/components/layout/GlobalAlertBanner';
import { Header } from '@/components/layout/Header';
import { MobileNav } from '@/components/layout/MobileNav';

export const metadata: Metadata = {
  title: 'ILG – הבית של המצילים בישראל',
  description: 'עדכונים, משרות, SOS ועוד – הכל במקום אחד למצילים בישראל',
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="he" dir="rtl">
      <body>
        <GlobalAlertBanner />
        <Header />
        <main className="pb-20 md:pb-0 min-h-screen">
          {children}
        </main>
        <MobileNav />
      </body>
    </html>
  );
}
