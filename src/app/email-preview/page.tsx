export default function EmailPreview() {
  const name = 'ישראל ישראלי';
  const verifyUrl = 'https://ilg.co.il/verify?token=example';

  return (
    <>
      <style>{`@import url('https://fonts.googleapis.com/css2?family=Rubik:wght@900&display=swap');`}</style>
      <div style={{ background: '#f1f5f9', minHeight: '100vh', padding: '32px 0', fontFamily: 'Arial, sans-serif' }}>
        <div style={{ maxWidth: 560, margin: '0 auto', background: '#fff', borderRadius: 8, overflow: 'hidden', boxShadow: '0 2px 8px rgba(0,0,0,0.08)' }}>

          {/* Header */}
          <div style={{ background: '#000', padding: '28px 32px', textAlign: 'center' }}>
            <div style={{ fontSize: 32, fontWeight: 900, color: '#fff', letterSpacing: -1, fontFamily: "'Rubik', Arial, sans-serif" }}>
              ILG <span style={{ color: '#FF0000' }}>●</span>
            </div>
            <div style={{ color: '#9ca3af', fontSize: 12, marginTop: 4, fontWeight: 600, letterSpacing: 2 }}>
              ISRAEL LIFEGUARDS
            </div>
          </div>

          {/* Red bar */}
          <div style={{ background: '#FF0000', height: 4 }} />

          {/* Body */}
          <div style={{ padding: '40px 32px 32px', textAlign: 'right', direction: 'rtl' }}>
            <p style={{ fontSize: 24, fontWeight: 900, color: '#000', margin: '0 0 16px', fontFamily: "'Rubik', Arial, sans-serif", lineHeight: 1.4 }}>
              ברוכ/ה הבא/ה, {name}!
            </p>
            <p style={{ fontSize: 15, color: '#374151', margin: '0 0 8px', lineHeight: 1.8 }}>
              הצטרפת לבית החדש של המצילים ואנשי המים בישראל.
            </p>
            <p style={{ fontSize: 15, color: '#374151', margin: '0 0 8px', lineHeight: 1.8 }}>
              כמעט סיימנו - לחץ על הכפתור למטה כדי לאמת את כתובת המייל שלך.
            </p>
            <p style={{ fontSize: 15, color: '#374151', margin: '0 0 28px', lineHeight: 1.8 }}>
              התעודה שלך כבר בבדיקה ובקרוב תוכל להתחיל ולהינות מ-ILG יא כריש/ה!
            </p>

            {/* CTA */}
            <div style={{ marginBottom: 28 }}>
              <a
                href={verifyUrl}
                style={{ display: 'inline-block', background: '#FF0000', color: '#fff', fontWeight: 900, fontSize: 16, padding: '14px 32px', borderRadius: 4, textDecoration: 'none', letterSpacing: 0.5 }}
              >
                אימות כתובת המייל
              </a>
            </div>

            <p style={{ fontSize: 13, color: '#9ca3af', margin: '0 0 6px' }}>
              הכפתור לא עובד? העתק את הקישור:
            </p>
            <p style={{ fontSize: 12, color: '#3b82f6', margin: 0, wordBreak: 'break-all', direction: 'ltr', textAlign: 'left' }}>
              {verifyUrl}
            </p>
          </div>

          {/* Divider */}
          <div style={{ padding: '0 32px' }}>
            <div style={{ borderTop: '1px solid #e5e7eb' }} />
          </div>

          {/* Features */}
          <div style={{ padding: '28px 32px', textAlign: 'right', direction: 'rtl' }}>
            <p style={{ fontSize: 20, fontWeight: 900, color: '#000', margin: '0 0 16px', fontFamily: "'Rubik', Arial, sans-serif" }}>
              מה מחכה לך ב- ILG
            </p>
            {[
              'תחזית גלים מקצועית בזמן אמת לכל חופי ישראל',
              'מזג האוויר וחדשות רלוונטיות לתחום ההצלה והמים',
              'קורסים והשתלמויות',
              'משרות עבודה קבועות ומשרות SOS יומיות',
            ].map((item) => (
              <div key={item} style={{ padding: '8px 0', fontSize: 14, color: '#374151' }}>
                <span style={{ color: '#FF0000', fontWeight: 900, marginLeft: 8 }}>●</span> {item}
              </div>
            ))}
          </div>

          {/* Footer */}
          <div style={{ background: '#000', padding: '20px 32px', textAlign: 'center' }}>
            <p style={{ color: '#6b7280', fontSize: 12, margin: 0 }}>
              © 2025 ILG – Israel Lifeguards Group
            </p>
            <p style={{ color: '#4b5563', fontSize: 11, margin: '6px 0 0' }}>
              קיבלת מייל זה כי נרשמת ל-ILG. אם לא נרשמת, תוכל להתעלם ממנו.
            </p>
          </div>

        </div>
      </div>
    </>
  );
}
