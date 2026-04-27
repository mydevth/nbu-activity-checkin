# NBU Activity Checkin — Phase 1: ภาพรวมระบบปัจจุบัน

> เอกสารนี้สรุปสิ่งที่พัฒนาเสร็จแล้ว (Production Ready) ใช้อ้างอิงก่อนพัฒนา Phase ต่อไป

---

## 1. Tech Stack

| Layer | Technology |
|-------|-----------|
| Runtime | Node.js 20 LTS |
| Framework | Express.js (ES Modules) |
| Port | 5533 |
| Primary DB | PostgreSQL (`nbu-actmenu`) |
| Cache | Redis Cloud (SSL/TLS) |
| Auth | JWT (8h) + bcrypt (12 rounds) |
| Image | sharp (120×120 JPEG thumbnails) |
| Report | ExcelJS (Excel/CSV) |
| LINE | LINE Messaging API + LIFF 2.0 |
| Process | PM2 (id: 19) |
| Reverse Proxy | Nginx + Let's Encrypt SSL |

---

## 2. โครงสร้างไฟล์

```
nbu-activity-checkin/
├── server.js                     ← Express entry point
├── package.json
├── .env / .env.example
│
├── src/
│   ├── api/
│   │   ├── db.js                 ← PostgreSQL pool + transaction()
│   │   ├── redis.js              ← getStudent() / setStudent()
│   │   ├── middleware/
│   │   │   └── auth.js           ← verifyJWT → req.user
│   │   ├── utils/
│   │   │   └── qr.js             ← verifyQR() / generateQR()
│   │   └── routes/
│   │       ├── auth.js           ← login / logout
│   │       ├── activities.js     ← CRUD + session open/close + targets
│   │       ├── attendance.js     ← QR scan + manual checkin
│   │       ├── students.js       ← search + meta (faculties/levels/cohorts)
│   │       ├── import.js         ← CSV upload + 3-phase import + SSE
│   │       ├── reports.js        ← Excel / CSV export + dashboard
│   │       ├── stats.js          ← statistics (dean-scoped)
│   │       ├── users.js          ← user CRUD
│   │       ├── liff.js           ← LINE LIFF endpoints
│   │       └── public.js         ← endpoints ไม่ต้อง login
│   │
│   ├── admin/
│   │   ├── index.html            ← Admin SPA (1,508 บรรทัด)
│   │   └── import.html           ← Import UI (SSE progress)
│   │
│   ├── scanner/
│   │   └── index.html            ← iPad Scanner App (1,128 บรรทัด)
│   │
│   ├── stats/
│   │   └── index.html            ← Statistics Dashboard (1,090 บรรทัด)
│   │
│   ├── mobile/
│   │   └── index.html            ← Mobile View (914 บรรทัด)
│   │
│   ├── liff/
│   │   └── index.html            ← LINE LIFF App
│   │
│   ├── report/
│   │   └── index.html            ← Public Report Page
│   │
│   ├── home/
│   │   └── index.html            ← Landing Page
│   │
│   └── line-oa/
│       └── webhook.js            ← LINE Messaging API webhook
│
├── database/
│   ├── schema.sql                ← initial schema
│   ├── migrate.js                ← migration v1
│   ├── migrate_v2.js             ← v2: table refinements
│   ├── migrate_v3.js             ← v3: FK, indexes, views, triggers
│   ├── migrate_dean_role.js      ← เพิ่ม dean role + faculty_scope
│   ├── migrate_stats.js          ← stats columns
│   ├── migrate_targets.js        ← nbu_activity_targets
│   └── migrate_targets_v2.js     ← level column + nbu_activity_target_students
│
└── scripts/
    ├── create_admin.mjs          ← สร้าง superadmin user
    ├── test-qr.js                ← ทดสอบ QR generation/verification
    ├── deploy.py                 ← SSH deployment
    └── import_students.py        ← legacy Python importer
```

---

## 3. Database Schema

### Tables

| Table | Primary Key | หน้าที่ |
|-------|------------|--------|
| `users` | UUID | admin / staff / dean accounts |
| `nbu_students` | VARCHAR (student_id) | ข้อมูลนักศึกษา (import จาก CSV) |
| `nbu_activities` | UUID | กิจกรรม |
| `nbu_activity_staff` | (activity_id, user_id) | อาจารย์ที่รับผิดชอบ |
| `nbu_sessions` | UUID | session เช็คชื่อ (open / closed) |
| `nbu_attendance` | UUID | การเข้าร่วม — UNIQUE(activity_id, student_id) |
| `nbu_activity_targets` | SERIAL | target rules (faculty / level / year) |
| `nbu_activity_target_students` | SERIAL | explicit student list |
| `line_student_links` | — | LINE UUID ↔ student_id |

### Views

| View | ใช้ใน |
|------|------|
| `nbu_v_activity_summary` | activity list, dashboard |
| `nbu_v_attendance_detail` | reports, statistics |

### Triggers

- `update_updated_at()` — auto-update `updated_at` ใน users, nbu_students, nbu_activities

### Key Columns

**users**
```sql
id, username, password_hash, full_name,
role  -- 'superadmin' | 'admin' | 'staff' | 'dean'
faculty_scope,  -- dean only
is_active, created_at, updated_at
```

**nbu_students**
```sql
student_id (PK), full_name, faculty, major,
level, study_duration, study_period, study_plan, loan_status,
photo_url, imported_at, updated_at
```

**nbu_activities**
```sql
id, title, description, location, activity_type,
start_datetime, end_datetime, max_participants,
is_active, created_by, created_at, updated_at
```

**nbu_attendance**
```sql
id, activity_id, session_id, student_id,
checked_at, checked_by,
method  -- 'qr_scan' | 'manual'
note
UNIQUE(activity_id, student_id)
```

**nbu_sessions**
```sql
id, activity_id, opened_by, closed_by,
opened_at, closed_at,
status  -- 'open' | 'closed'
note
```

---

## 4. API Endpoints

### Authentication
| Method | Path | หน้าที่ |
|--------|------|--------|
| POST | `/api/v1/auth/login` | รับ `{ username, password }` → JWT |
| POST | `/api/v1/auth/logout` | stateless (client ลบ token) |

### Activities
| Method | Path | Role | หน้าที่ |
|--------|------|------|--------|
| GET | `/api/v1/activities` | all | list (staff เห็นแค่กิจกรรมตัวเอง) |
| POST | `/api/v1/activities` | admin | สร้าง + assign staff + targets |
| GET | `/api/v1/activities/:id` | all | รายละเอียด + current_session + targets |
| PUT | `/api/v1/activities/:id` | admin | แก้ไข + rebuild staff/targets |
| DELETE | `/api/v1/activities/:id` | admin | ลบ (cascade) |
| POST | `/api/v1/activities/:id/session/open` | admin/staff | เปิด session |
| POST | `/api/v1/activities/:id/session/close` | admin/staff | ปิด session |
| GET | `/api/v1/activities/:id/sessions` | all | ดู session history |
| POST | `/api/v1/activities/targets/preview` | admin | preview จำนวน students ที่ match rules |
| POST | `/api/v1/activities/:id/targets/students` | admin | import explicit student list |
| GET | `/api/v1/activities/:id/targets/students/count` | all | นับ target students |

### Attendance
| Method | Path | หน้าที่ |
|--------|------|--------|
| POST | `/api/v1/attendance/scan` | QR scan → Redis lookup → async DB insert |
| POST | `/api/v1/attendance/manual` | เพิ่มรายการด้วยมือ |
| GET | `/api/v1/attendance/:activityId` | รายชื่อผู้เข้าร่วม (filter: faculty, year, method) |
| DELETE | `/api/v1/attendance/:id` | ลบรายการ |

### Students
| Method | Path | หน้าที่ |
|--------|------|--------|
| GET | `/api/v1/students/search?q=` | ค้นหาชื่อ / รหัส (max 20) |
| GET | `/api/v1/students/meta` | faculties, levels, cohorts |
| GET | `/api/v1/students/meta/faculties` | list คณะ |
| GET | `/api/v1/students/:studentId` | ข้อมูลนักศึกษา 1 คน |

### Import
| Method | Path | หน้าที่ |
|--------|------|--------|
| POST | `/api/v1/import/upload` | อัปโหลด CSV → parse → in-memory (30 min) |
| POST | `/api/v1/import/start` | เริ่ม async job (photos → DB → Redis) |
| GET | `/api/v1/import/progress/:jobId` | SSE stream: phase, total, done, photoOk/Fail |

### Reports
| Method | Path | หน้าที่ |
|--------|------|--------|
| GET | `/api/v1/reports/:activityId/excel` | ดาวน์โหลด Excel |
| GET | `/api/v1/reports/:activityId/csv` | ดาวน์โหลด CSV (UTF-8 BOM) |
| GET | `/api/v1/reports/dashboard` | today_attendance, total_students |

### Statistics
| Method | Path | หน้าที่ |
|--------|------|--------|
| GET | `/api/v1/stats/activities` | list กิจกรรม + attendee_count (dean scoped) |
| GET | `/api/v1/stats/:activityId` | stats 10 dimensions (faculty, major, target, absent, etc.) |

### Users
| Method | Path | Role | หน้าที่ |
|--------|------|------|--------|
| GET | `/api/v1/users` | admin | list users |
| GET | `/api/v1/users/:id` | admin/self | ดู user |
| POST | `/api/v1/users` | admin | สร้าง user |
| PUT | `/api/v1/users/:id` | admin/self | แก้ไข user |
| DELETE | `/api/v1/users/:id` | admin | ลบ user |

### LIFF (LINE In-App)
| Method | Path | หน้าที่ |
|--------|------|--------|
| GET | `/api/v1/liff/me?token=` | ดูโปรไฟล์ + สถิติ (LINE access token) |
| GET | `/api/v1/liff/attendance?token=&page=` | ประวัติ 20 รายการ/หน้า |

### Public (ไม่ต้อง login)
| Method | Path | หน้าที่ |
|--------|------|--------|
| GET | `/api/v1/public/activities` | กิจกรรมทั้งหมด + attendee_count |
| GET | `/api/v1/public/stats/:activityId` | stats สาธารณะ (ไม่มีชื่อนักศึกษา) |

### LINE Webhook
| Method | Path | หน้าที่ |
|--------|------|--------|
| POST | `/line/webhook` | HMAC verify → Flex Message reply |

---

## 5. Redis Schema

```
student:{student_id}  →  HASH
  - student_id
  - full_name
  - faculty
  - major
  - photo_url   ← local thumbnail URL
```

---

## 6. QR Code Format

```
{studentId}|{unixTimestamp}|{hmac16}

ตัวอย่าง: 671280108|1775716100|6dd426b0ff3fcf28

- HMAC: SHA256(studentId|timestamp) → 16 chars แรก
- TTL: 5 นาที
- ตรวจสอบ: format, expiry, timing-safe HMAC comparison
```

---

## 7. Roles & Permissions

| Feature | superadmin | admin | staff | dean |
|---------|-----------|-------|-------|------|
| จัดการ user | ✅ | ✅ | ❌ | ❌ |
| สร้าง/ลบกิจกรรม | ✅ | ✅ | ❌ | ❌ |
| เปิด session เช็คชื่อ | ✅ | ✅ | ✅ (กิจกรรมตัวเอง) | ❌ |
| สแกน QR / manual | ✅ | ✅ | ✅ | ❌ |
| ดู stats ทุกกิจกรรม | ✅ | ✅ | ❌ | ✅ (เฉพาะ faculty_scope) |
| ออก report | ✅ | ✅ | ✅ (กิจกรรมตัวเอง) | ❌ |
| import CSV | ✅ | ✅ | ❌ | ❌ |

---

## 8. Key Workflows

### QR Scan Flow
```
1. Scanner อ่าน QR → ได้ string format: studentId|ts|hmac
2. iPad POST /api/v1/attendance/scan { qr_raw, activity_id, session_id }
3. verifyQR(): format check → expiry check → HMAC verify
4. Redis HGETALL student:{student_id}  (< 5ms)
5. ตรวจ session เปิดอยู่
6. ตรวจซ้ำ (UNIQUE constraint)
7. INSERT async (return 200 ก่อน DB confirm)
8. Response: { success, student: { name, faculty, photo_url } }
9. iPad แสดงชื่อ + รูป (เขียว 5 วินาที) + beep
```

### Import Flow
```
1. Admin อัปโหลด CSV → POST /import/upload
   → parse (BOM + quoted fields + Thai)
   → เก็บ in-memory 30 นาที
   → return { uploadId, preview }

2. Map columns → POST /import/start { uploadId, colId, colName, ... }
   → Phase 1: download photos (concurrent 10)
              URL: {PHOTO_BASE_URL}/{id[0:2]}/{id}.jpg
              resize sharp 120×120 → /thumbnails/{id}.jpg
   → Phase 2: batch INSERT nbu_students (200/batch) ON CONFLICT UPDATE
   → Phase 3: batch Redis HSET (200/batch)

3. Monitor: GET /import/progress/:jobId (SSE)
   → { status, phase, total, done, photoOk, photoFail }
```

### Activity + Session Flow
```
Admin: POST /activities (create + staff + targets)
Staff: POST /activities/:id/session/open
Students: scan QR (attendance records)
Staff: POST /activities/:id/session/close
Admin: GET /reports/:id/excel
```

### LINE OA Flow
```
นักศึกษาพิมพ์ "กิจกรรม" ใน LINE OA
→ POST /line/webhook (raw body + HMAC verify)
→ ค้นหา student จาก line_student_links
→ query attendance + activities
→ สร้าง Flex Message carousel
→ reply กลับ LINE
```

---

## 9. Frontend Apps

| App | URL | ไฟล์ | หมายเหตุ |
|-----|-----|------|---------|
| Landing Page | `/` | src/home/index.html | — |
| Admin Panel | `/admin` | src/admin/index.html | SPA Vanilla JS + SweetAlert2 |
| Import UI | `/admin/import` | src/admin/import.html | SSE progress bar |
| Scanner (iPad) | `/scanner` | src/scanner/index.html | USB barcode scanner optimized |
| Stats Dashboard | `/stats` | src/stats/index.html | dean-scoped stats + charts |
| Mobile View | `/mobile` | src/mobile/index.html | student mobile UI |
| LIFF App | `/liff` | src/liff/index.html | LINE SDK + student history |
| Public Report | `/report` | src/report/index.html | anonymous stats |

---

## 10. Response Format (ทุก Endpoint)

```json
{ "success": true,  "data": {...},    "total": N }
{ "success": false, "message": "..." }
```

HTTP Status Codes:
- `200` — สำเร็จ
- `400` — ข้อมูลไม่ครบ / validation fail
- `401` — ไม่มี token / token หมดอายุ
- `403` — ไม่มีสิทธิ์
- `404` — ไม่พบข้อมูล
- `409` — ซ้ำ (duplicate attendance, session already open)
- `500` — server error

---

## 11. Deployment

| ข้อมูล | ค่า |
|--------|-----|
| Server | Ubuntu 147.50.10.29 |
| App path | `/var/www/app/nbu-activity-checkin` |
| Thumbnails | `/var/www/activity/public/thumbnails/` |
| PM2 id | 19 (root user) |
| URL | https://activity.northbkk.ac.th |

```bash
# Deploy
ssh root@147.50.10.29
cd /var/www/app/nbu-activity-checkin
git pull
npm install
pm2 restart 19
```

---

## 12. สิ่งที่ทำงานอยู่แล้ว (Production Ready)

- ✅ Multi-role auth (superadmin, admin, staff, dean)
- ✅ QR scan flow (HMAC → Redis < 5ms → async DB insert)
- ✅ Student import 3-phase + SSE progress
- ✅ Excel / CSV export พร้อม formatting
- ✅ LINE OA webhook + Flex Message carousel
- ✅ LIFF app นักศึกษาดูประวัติ
- ✅ Session management (open / close)
- ✅ Target system (rule-based + explicit list)
- ✅ Dean-scoped statistics (10 dimensions)
- ✅ Admin SPA (activities, users, reports, import)
- ✅ iPad Scanner App (USB barcode scanner optimized)
- ✅ Stats Dashboard

---

## 13. ข้อสังเกตสำคัญก่อนพัฒนา Phase ต่อไป

1. **Response pattern** คงเดิมทุก endpoint: `{ success, message, data }`
2. **ไม่มี controller layer** — business logic อยู่ใน route files โดยตรง
3. **Frontend เป็น Single HTML** ทุกอัน (inline CSS + JS) ไม่ใช้ framework
4. **Import route** มี in-memory store + 30-min auto-cleanup
5. **Stats route** มี 10 parallel queries — ระวังเพิ่ม query ใหม่ต้อง handle ครบ
6. **Dean role** ต้อง filter ทุก endpoint ด้วย `faculty_scope`
7. **QR ใช้ HMAC** ไม่ใช่ encryption — student_id ไม่ถูก encrypt แค่ verify
8. **Thumbnail** เก็บใน server local ไม่ใช่ cloud storage
9. **LINE webhook** ต้องรับ raw body ก่อน express.json() — mount ลำดับสำคัญมาก
10. **UNIQUE constraint** บน attendance(activity_id, student_id) — ป้องกัน duplicate ที่ DB level
