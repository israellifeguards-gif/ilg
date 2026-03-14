# Tide Cache Architecture — ILG Dashboard

## הבעיה

Next.js ו-Vercel שומרים תוצאות של Server Components בשלוש שכבות cache:
1. **Full Route Cache** — HTML מוכן נשמר ומוגש בלי להריץ קוד
2. **Data Cache** — תוצאות של `fetch()` נשמרות בזיכרון השרת
3. **Browser Cache** — הדפדפן שומר את ה-HTML המתקבל

כתוצאה מכך, אחרי כיול ה-offset דרך `/api/admin/calibrate-tide`, הדשבורד המשיך להציג זמני גאות ישנים — למרות שה-Firestore עודכן בהצלחה.

---

## הפתרון — 4 שכבות הגנה

### שכבה 1 — Route Level
**קובץ:** `src/app/dashboard/page.tsx`
```ts
export const dynamic = 'force-dynamic';
export const revalidate = 0;
```
מכריח Next.js לרנדר את הדף מחדש בכל בקשה — לא שומר Full Route Cache.

### שכבה 2 — Data Cache Level
**קובץ:** `src/lib/api/surf.ts` — פונקציה `fetchTideOffset()`
```ts
unstable_noStore(); // מבטל Data Cache לכל ה-render הנוכחי
```
מבטיח שקריאת ה-offset מ-Firestore תמיד טרייה, גם אם שכבה 1 נכשלת.

### שכבה 3 — Browser/CDN Level
**קובץ:** `next.config.ts`
```ts
{ key: 'Cache-Control', value: 'no-store, max-age=0' }
```
מונע מהדפדפן ומ-Vercel Edge Network לשמור עותק של דף הדשבורד.

### שכבה 4 — Frontend Level
**קובץ:** `src/app/dashboard/page.tsx`
```tsx
<SurfForecast key={surf.fetchedAt} ... />
```
`fetchedAt` = `new Date().toISOString()` — ייחודי לכל render. כשהוא משתנה, React מפרק ובונה את ה-Component מחדש, כולל איפוס כל ה-state הפנימי (expanded panels, toggles וכו').

### כיול — Revalidation
**קובץ:** `src/app/api/admin/calibrate-tide/route.ts`
```ts
await setTideOffsetRaw(offset);  // כותב ל-Firestore
revalidatePath('/dashboard');     // מוחק cache מיד אחרי הכתיבה
```

---

## איזון מכסות API

| מקור נתונים | הגדרת Cache | סיבה |
|---|---|---|
| Open-Meteo (גלים/רוח/UV) | `cache: 'no-store'` | חינמי, ללא מכסה |
| ISRAMAR Hadera Buoy | `revalidate: 3600` (1h) | הבוי מתעדכן כל שעה בכל מקרה |
| StormGlass | `revalidate: 10800` (3h) | מכסה של **10 בקשות ביום בלבד** |
| Firestore offset | `unstable_noStore()` | מקור האמת — אף פעם לא cached |

---

## בדיקת איכות — Vercel Logs

אחרי כל deploy או כיול, חפש ב-Vercel Logs:

```
# סדר הלוגים התקין בכל רענון דף:
[CACHE-CHECK] Reading from Firestore at: 2026-03-14T10:42:17.003Z   ← timestamp משתנה
[tide] offsetHours=1.37 confirmed fresh from Firestore
[DEBUG] Applying Offset: 1.37h to Raw Time: 13:59 → Final: 15:20 (High)
[TIDE-SYNC] Final Calculated Tide Time: 15:20 (High, h=0.124m) | offset=1.37h
```

| תופעה בלוג | משמעות |
|---|---|
| `CACHE-CHECK` עם timestamp משתנה | ✅ המערכת רצה טרי בכל בקשה |
| `CACHE-CHECK` לא מופיע בכלל | ❌ הדף cached — בדוק Vercel Edge Cache |
| `offsetHours=0` כל הזמן | ❌ Firestore לא נכתב — בדוק את ה-API |
| `out of ±6h range` | ❌ ערך שגוי — קרא ל-calibrate-tide עם offset תקין |

---

## תחזוקה — מה לא לגעת בו

**קבצים סטטיים (JS/CSS/images):** אם אתה רואה `from disk cache` ב-Network Tab על קבצי `.js` או `.css` — זה **תקין לחלוטין**. אל תנסה לבטל את ה-cache שלהם. הם לא קשורים לנתוני הגאות ובטול ה-cache שלהם יאט את האתר משמעותית.

**StormGlass `revalidate: 10800`:** אל תמחק את ה-cache הזה. 10 בקשות ביום = בקשה כל 2.4 שעות. בלי cache, המכסה תיגמר תוך שעה.

**`unstable_noStore()`:** ה-"unstable" בשם מציין שה-API עוד לא יצא מ-experimental ב-Next.js — לא שהוא לא בטוח. אפשר להמשיך להשתמש בו.

---

## כיצד לכייל את הגאות

```
1. פתח את הדשבורד — שים לב לזמן שמוצג לגאות/שפל הבא
2. השווה לנתוני ISRAMAR: https://isramar.ocean.org.il
3. חשב delta: actual − predicted (למשל: 15:20 − 13:59 = +1.35h)
4. קרא ל-API: /api/admin/calibrate-tide?offset=1.35
5. עשה Ctrl+Shift+R בדשבורד
6. בדוק ב-Vercel Logs שה-TIDE-SYNC מציג את הזמן החדש
```
