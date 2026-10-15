# منصة البلاغات الهندسية والصيانة الذكية — النسخة 0.1 (الخلفية)

## التشغيل
1. أنشئ قاعدة بيانات: `createdb maintenance`
2. نفّذ المخطط: `psql -d maintenance -f schema.sql`
3. انسخ `.env.example` إلى `.env` وعدّل القيم
4. `npm install`
5. أنشئ المدير: `node seed.js admin كلمة_مرور_قوية`
6. `npm start`  ← الخادم على http://localhost:3000

## أهم المسارات
| المسار | الوصف |
|---|---|
| POST /auth/login | تسجيل الدخول (يعيد JWT) |
| POST /users | إنشاء مستخدم (admin) |
| POST /tickets | رفع بلاغ |
| GET /tickets?status=&priority=&department_id= | قائمة البلاغات |
| GET /tickets/:id | تفاصيل البلاغ وسجل الأحداث |
| PATCH /tickets/:id/assign | إسناد لفني |
| PATCH /tickets/:id/status | تغيير الحالة |
| GET /stats/kpi | MTTR وإحصائيات الأقسام |

مسار الحالات: new → assigned → in_progress → resolved → closed (أو rejected).
