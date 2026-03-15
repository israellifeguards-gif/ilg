'use client';

import { useState } from 'react';
import { createUserWithEmailAndPassword, sendEmailVerification } from 'firebase/auth';
import { auth } from '@/lib/firebase/config';
import { createUser } from '@/lib/firebase/firestore';
import { uploadCertificate } from '@/lib/firebase/storage';
import type { UserRole } from '@/types';
import { useRouter } from 'next/navigation';

type Step = 1 | 2 | 3;

interface FormData {
  displayName: string;
  email: string;
  password: string;
  phone: string;
  role: UserRole | '';
  certFile: File | null;
  certPreview: string | null;
  legalConsent: boolean;
}

const INITIAL: FormData = {
  displayName: '',
  email: '',
  password: '',
  phone: '',
  role: '',
  certFile: null,
  certPreview: null,
  legalConsent: false,
};

export function RegisterForm() {
  const router = useRouter();
  const [step, setStep] = useState<Step>(1);
  const [form, setForm] = useState<FormData>(INITIAL);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [showPassword, setShowPassword] = useState(false);

  function setField<K extends keyof FormData>(key: K, value: FormData[K]) {
    setForm((prev) => ({ ...prev, [key]: value }));
  }

  function handleFileChange(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    setField('certFile', file);
    const reader = new FileReader();
    reader.onloadend = () => setField('certPreview', reader.result as string);
    reader.readAsDataURL(file);
  }

  async function handleSubmit() {
    setLoading(true);
    setError('');
    try {
      const cred = await createUserWithEmailAndPassword(auth, form.email, form.password);
      const uid = cred.user.uid;

      const verifyUrl = `${window.location.origin}/pending`;
      await sendEmailVerification(cred.user, { url: verifyUrl });

      fetch('/api/send-welcome', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: form.displayName, email: form.email, verifyUrl }),
      }).catch(() => null);

      let certUrl: string | null = null;
      if (form.certFile) {
        certUrl = await uploadCertificate(uid, form.certFile);
      }

      const ipRes = await fetch('https://api.ipify.org?format=json').catch(() => null);
      const { ip } = ipRes ? await ipRes.json().catch(() => ({ ip: '' })) : { ip: '' };

      await createUser(uid, {
        displayName: form.displayName,
        phone: form.phone,
        role: form.role as UserRole,
        certification_url: certUrl,
        is_verified: false,
        sos_active: false,
        radius_pref: 0,
        consent_timestamp: new Date().toISOString(),
        ip_address: ip || null,
        created_at: new Date().toISOString(),
      });

      router.push('/pending');
    } catch (err: unknown) {
      const code = (err as { code?: string }).code;
      if (code === 'auth/email-already-in-use') {
        setError('כתובת המייל כבר רשומה במערכת.');
      } else if (code === 'auth/weak-password') {
        setError('הסיסמה חייבת להכיל לפחות 6 תווים.');
      } else if (code === 'auth/invalid-email') {
        setError('כתובת המייל אינה תקינה.');
      } else {
        setError('אירעה שגיאה. נסה שוב.');
      }
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="w-full max-w-md mx-auto px-4 py-8">
      {/* Progress bar */}
      <div className="flex gap-2 mb-8">
        {[1, 2, 3].map((s) => (
          <div
            key={s}
            className={`h-1 flex-1 transition-colors ${step >= s ? 'bg-[#FF0000]' : 'bg-gray-200'}`}
          />
        ))}
      </div>

      {/* Step 1 – Identity */}
      {step === 1 && (
        <div className="space-y-5">
          <h2 className="text-2xl font-black">פרטים אישיים</h2>

          <div>
            <label className="block text-sm font-semibold mb-1">שם מלא</label>
            <input
              type="text"
              value={form.displayName}
              onChange={(e) => setField('displayName', e.target.value)}
              className="w-full border border-gray-300 px-4 py-3 text-base focus:outline-none focus:border-black"
              placeholder="ישראל ישראלי"
            />
          </div>

          <div>
            <label className="block text-sm font-semibold mb-1">כתובת מייל</label>
            <input
              type="email"
              value={form.email}
              onChange={(e) => setField('email', e.target.value)}
              className="w-full border border-gray-300 px-4 py-3 text-base focus:outline-none focus:border-black"
              placeholder="israel@example.com"
              dir="ltr"
            />
          </div>

          <div>
            <label className="block text-sm font-semibold mb-1">סיסמה</label>
            <div className="relative">
              <input
                type={showPassword ? 'text' : 'password'}
                value={form.password}
                onChange={(e) => setField('password', e.target.value)}
                className="w-full border border-gray-300 px-4 py-3 pl-11 text-base focus:outline-none focus:border-black"
                placeholder="לפחות 6 תווים"
                dir="ltr"
              />
              <button
                type="button"
                onClick={() => setShowPassword((v) => !v)}
                className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400 hover:text-gray-700"
                aria-label={showPassword ? 'הסתר סיסמה' : 'הצג סיסמה'}
              >
                {showPassword ? (
                  <svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                    <path d="M17.94 17.94A10.07 10.07 0 0 1 12 20c-7 0-11-8-11-8a18.45 18.45 0 0 1 5.06-5.94"/>
                    <path d="M9.9 4.24A9.12 9.12 0 0 1 12 4c7 0 11 8 11 8a18.5 18.5 0 0 1-2.16 3.19"/>
                    <line x1="1" y1="1" x2="23" y2="23"/>
                  </svg>
                ) : (
                  <svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                    <path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"/>
                    <circle cx="12" cy="12" r="3"/>
                  </svg>
                )}
              </button>
            </div>
          </div>

          <div>
            <label className="block text-sm font-semibold mb-1">מספר טלפון</label>
            <input
              type="tel"
              value={form.phone}
              onChange={(e) => setField('phone', e.target.value)}
              className="w-full border border-gray-300 px-4 py-3 text-base focus:outline-none focus:border-black"
              placeholder="050-123-4567"
            />
          </div>

          <div>
            <label className="block text-sm font-semibold mb-1">תפקיד</label>
            <select
              value={form.role}
              onChange={(e) => setField('role', e.target.value as UserRole)}
              className="w-full border border-gray-300 px-4 py-3 text-base focus:outline-none focus:border-black bg-white"
            >
              <option value="">בחר תפקיד...</option>
              <option value="SeaLifeguard">מציל/ה ים</option>
              <option value="PoolLifeguard">מציל/ה בריכה</option>
              <option value="AssistantLifeguard">עוזר/ת מציל</option>
              <option value="PoolOperator">מפעיל/ת בריכה</option>
              <option value="Employer">מעסיק/ה</option>
              <option value="Courses">קורסים</option>
            </select>
          </div>

          <button
            onClick={() => {
              if (!form.displayName || !form.email || !form.password || !form.phone || !form.role) {
                setError('יש למלא את כל השדות');
                return;
              }
              if (form.password.length < 6) {
                setError('הסיסמה חייבת להכיל לפחות 6 תווים');
                return;
              }
              setError('');
              setStep(2);
            }}
            className="w-full bg-black text-white py-4 font-black text-base hover:bg-gray-900 transition-colors"
          >
            המשך
          </button>
          {error && <p className="text-[#FF0000] text-sm text-center">{error}</p>}
        </div>
      )}

      {/* Step 2 – Certificate Upload */}
      {step === 2 && (
        <div className="space-y-5">
<h2 className="text-2xl font-black">
            {(form.role === 'SeaLifeguard' || form.role === 'PoolLifeguard' || form.role === 'PoolOperator')
              ? 'העלאת תעודה מקצועית'
              : 'העלאת תעודת זהות'}
          </h2>
          <div className="bg-gray-50 border border-gray-200 rounded p-3 text-sm text-gray-600">
            {(form.role === 'SeaLifeguard' || form.role === 'PoolLifeguard' || form.role === 'PoolOperator')
              ? <p>🏅 לתפקידך נדרשת <strong>תעודה מקצועית</strong> בתוקף.</p>
              : <p>📋 לתפקידך נדרשת <strong>תעודת זהות בלבד</strong> לאימות זהות.</p>
            }
          </div>
          <p className="text-gray-500 text-sm">
            {(form.role === 'SeaLifeguard' || form.role === 'PoolLifeguard' || form.role === 'PoolOperator')
              ? 'צלם/י את תעודת המקצוע שלך והעלה תמונה ברורה.'
              : 'צלם/י את תעודת הזהות שלך והעלה תמונה ברורה.'}
          </p>

          {/* Preview */}
          {form.certPreview && (
            <div className="border-2 border-[#FF0000] p-2 text-center">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src={form.certPreview} alt="תצוגה מקדימה" className="max-h-48 mx-auto object-contain" />
            </div>
          )}

          {/* Two upload buttons */}
          <div className="flex gap-3">
            <label className="flex-1 cursor-pointer">
              <div className="border-2 border-dashed border-gray-300 hover:border-gray-500 p-5 text-center transition-colors">
                <span className="text-3xl">📁</span>
                <p className="text-sm font-semibold mt-1">גלריה</p>
              </div>
              <input type="file" accept="image/*" onChange={handleFileChange} className="hidden" />
            </label>
            <label className="flex-1 cursor-pointer">
              <div className="border-2 border-dashed border-gray-300 hover:border-gray-500 p-5 text-center transition-colors">
                <span className="text-3xl">📷</span>
                <p className="text-sm font-semibold mt-1">צלם תמונה</p>
              </div>
              <input type="file" accept="image/*" capture="environment" onChange={handleFileChange} className="hidden" />
            </label>
          </div>
          <p className="text-xs text-gray-400 text-center">JPG, PNG עד 10MB</p>

          <div className="flex gap-3">
            <button
              onClick={() => setStep(1)}
              className="flex-1 border-2 border-black py-3 font-bold hover:bg-gray-100 transition-colors"
            >
              חזור
            </button>
            <button
              onClick={() => {
                if (!form.certFile) {
                  const needsCert = form.role === 'SeaLifeguard' || form.role === 'PoolLifeguard' || form.role === 'PoolOperator';
                  setError(needsCert ? 'יש להעלות תמונה של תעודת ההצלה' : 'יש להעלות תמונה של תעודת הזהות');
                  return;
                }
                setError('');
                setStep(3);
              }}
              className="flex-1 bg-black text-white py-3 font-black hover:bg-gray-900 transition-colors"
            >
              המשך
            </button>
          </div>
          {error && <p className="text-[#FF0000] text-sm text-center">{error}</p>}
        </div>
      )}

      {/* Step 3 – Legal Consent */}
      {step === 3 && (
        <div className="space-y-5">
          <h2 className="text-2xl font-black">תנאי שימוש</h2>

          <div className="border border-gray-200 p-4 text-sm text-gray-700 leading-relaxed max-h-48 overflow-y-auto space-y-3">
            <p className="font-bold">הצהרת כתב ויתור</p>
            <p>
              ILG הינה לוח מודעות בלבד. האתר אינו מהווה מעסיק ואינו צד ליחסי עבודה בין מציל למעסיק.
              האחריות לאימות תעודות ההצלה ולוודא כשירות המציל מוטלת על המעסיק בלבד.
            </p>
            <p>
              ILG אינה אחראית לנזקים כלשהם שייגרמו כתוצאה מהשימוש בפלטפורמה, לרבות נזקים הנובעים
              מהסתמכות על מידע שפורסם בה.
            </p>
            <p>
              על ידי הצטרפות לפלטפורמה אתה מסכים לתנאי השימוש המלאים ולמדיניות הפרטיות של ILG.
            </p>
          </div>

          <label className="flex items-start gap-3 cursor-pointer">
            <input
              type="checkbox"
              checked={form.legalConsent}
              onChange={(e) => setField('legalConsent', e.target.checked)}
              className="mt-1 w-5 h-5 accent-[#FF0000] flex-shrink-0"
            />
            <span className="text-sm font-medium leading-relaxed">
              אני מאשר שקראתי והסכמתי לתנאי השימוש ופטור מאחריות
            </span>
          </label>

          <div className="flex gap-3">
            <button
              onClick={() => setStep(2)}
              className="flex-1 border-2 border-black py-3 font-bold hover:bg-gray-100 transition-colors"
            >
              חזור
            </button>
            <button
              onClick={handleSubmit}
              disabled={!form.legalConsent || loading}
              className="flex-1 bg-[#FF0000] text-white py-3 font-black hover:bg-red-700 transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
            >
              {loading ? 'נרשם...' : 'הצטרפות'}
            </button>
          </div>
          {error && <p className="text-[#FF0000] text-sm text-center">{error}</p>}
        </div>
      )}
    </div>
  );
}
