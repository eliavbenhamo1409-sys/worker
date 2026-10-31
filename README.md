# אפליקציית עובד · מחסן

אפליקציית טלפון לעובדי המפעל: קליטת סחורה, מסירה ללקוח ודיווח תקלות (כולל צילום).
Next.js 16 · React 19 · Tailwind v4 · Supabase.

## הרצה

```bash
npm install
cp .env.example .env.local   # ומלאו את פרטי Supabase
npm run dev
```

האפליקציה נפתחת ב-http://localhost:3000 ומפנה ל-`/worker`.

## מבנה

- `src/app/worker/` – מסכי העובד: בחירת עובד, קליטה, מסירה, תקלה
- `src/components/worker/` – רכיבי המסכים (Row, Picker, Summary…)
- `src/components/ui/` – מערכת העיצוב המשותפת
- `src/lib/store.tsx` – נתונים בזמן אמת מ-Supabase
- `src/lib/worker-store.ts` – זיכרון העובד בטלפון והעלאת תמונות
- `supabase/migrations/` – סכמת מסד הנתונים (משותפת עם מערכת הניהול)
