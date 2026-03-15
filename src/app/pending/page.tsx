export default function PendingPage() {
  return (
    <div className="min-h-screen flex flex-col items-center justify-center text-center px-6 bg-white">
      <div className="text-6xl mb-6">📬</div>
      <h1 className="text-3xl font-black mb-3">ברוך הבא ל-ILG!</h1>
      <p className="text-gray-600 max-w-sm leading-relaxed mb-6">
        שלחנו לך מייל אימות לכתובת שהזנת. לחץ על הקישור במייל כדי לאמת את החשבון שלך.
      </p>

      <div className="border border-gray-200 p-5 max-w-sm w-full text-sm text-right space-y-3">
        <p className="font-black text-base">מה קורה עכשיו?</p>
        <div className="flex items-start gap-3">
          <span className="text-[#FF0000] font-black flex-shrink-0">1.</span>
          <p className="text-gray-600">בדוק את תיבת הדואר שלך ולחץ על קישור האימות</p>
        </div>
        <div className="flex items-start gap-3">
          <span className="text-[#FF0000] font-black flex-shrink-0">2.</span>
          <p className="text-gray-600">תעודת ההצלה שלך נמצאת בבדיקה על ידי צוות ILG</p>
        </div>
        <div className="flex items-start gap-3">
          <span className="text-[#FF0000] font-black flex-shrink-0">3.</span>
          <p className="text-gray-600">לאחר אישור התעודה תקבל גישה מלאה לפלטפורמה</p>
        </div>
      </div>

      <p className="text-xs text-gray-400 mt-6">
        לא קיבלת מייל? בדוק את תיקיית הספאם
      </p>
    </div>
  );
}
