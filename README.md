# NBU Activity Attendance System

ระบบบันทึกการเข้าร่วมกิจกรรมของนักศึกษา มหาวิทยาลัยนอร์ทกรุงเทพ

---

## สารบัญ

- [ภาพรวมระบบ](#ภาพรวมระบบ)
- [URL และหน้าต่างๆ](#url-และหน้าต่างๆ)
- [การติดตั้ง (Development)](#การติดตั้ง-development)
- [การ Deploy ขึ้น Server](#การ-deploy-ขึ้น-server)
- [คู่มือการใช้งาน Admin](#คู่มือการใช้งาน-admin)
- [คู่มือการใช้งาน Scanner (iPad)](#คู่มือการใช้งาน-scanner-ipad)
- [การ Import นักศึกษา](#การ-import-นักศึกษา)
- [API Reference](#api-reference)
- [โครงสร้างโปรเจกต์](#โครงสร้างโปรเจกต์)

---

## ภาพรวมระบบ

```
เครื่องสแกน QR ──► iPad (Scanner App) ──► API Server ──► PostgreSQL
                                                    │
                                                    └──► Redis (cache นักศึกษา)
                                                    │
                    Admin Web ◄─────────────────────┘
                    Stats (ผู้บริหาร) ◄──────────────┘
                    Report (สาธารณะ) ◄──────────────┘
                    LIFF (LINE OA) ◄─────────────────┘
```

**Flow การเช็คชื่อ**

1. นักศึกษาแสดง QR Code จากบัตรนักศึกษา
2. เครื่องสแกนอ่าน QR → ส่งค่าไปยัง iPad
3. iPad ส่ง POST `/api/v1/attendance/scan` พร้อม `qr_raw`
4. Server ตรวจสอบ QR (format + expiry + HMAC) → ดึงข้อมูลจาก Redis (<5ms)
5. บันทึก attendance → PostgreSQL (async)
6. iPad แสดงชื่อ คณะ รูปนักศึกษา + เสียง beep สีเขียว

---

## URL และหน้าต่างๆ

| หน้า | URL | ต้อง Login |
| ---- | --- | ---------- |
| Admin Panel | `https://activity.northbkk.ac.th/admin` | ✅ admin/staff |
| Scanner App (iPad) | `https://activity.northbkk.ac.th/scanner` | ✅ staff ขึ้นไป |
| รายงานผู้บริหาร | `https://activity.northbkk.ac.th/stats` | ✅ admin/dean |
| รายงานสาธารณะ | `https://activity.northbkk.ac.th/report` | ❌ |
| LIFF App (LINE) | `https://activity.northbkk.ac.th/liff` | ❌ (ใช้ LINE token) |
| LINE OA Webhook | `https://activity.northbkk.ac.th/line/webhook` | ❌ |
| API Base | `https://activity.northbkk.ac.th/api/v1` | ✅ (ส่วนใหญ่) |
| Health Check | `https://activity.northbkk.ac.th/api/health` | ❌ |

---

## การติดตั้ง (Development)

### ความต้องการ

- Node.js 20+
- Python 3.10+ (สำหรับ deploy script และ import script)
- PostgreSQL 14+
- Redis หรือ Redis Cloud

### ขั้นตอน

```bash
# 1. Clone / copy โปรเจกต์
cd /your/path

# 2. ติดตั้ง dependencies
npm install

# 3. ตั้งค่า environment
cp .env.example .env
# แก้ไข .env ให้ครบ (ดูหัวข้อ Environment Variables ด้านล่าง)

# 4. สร้างตาราง database
node database/migrate.js

# 5. สร้าง superadmin user เริ่มต้น
node scripts/create_admin.mjs admin ChangeMe123! ชื่อผู้ดูแล superadmin

# 6. Import นักศึกษา (optional สำหรับ dev)
python scripts/import_students.py students.csv --dry-run

# 7. รัน server
npm run dev
```

### Environment Variables

แก้ไขในไฟล์ `.env` (copy จาก `.env.example`):

```env
# Server
NODE_ENV=production
PORT=5533
BASE_URL=https://activity.northbkk.ac.th

# PostgreSQL
DB_HOST=nbc.northbkk.ac.th
DB_PORT=5432
DB_NAME=nbu-actmenu
DB_USER=postgres
DB_PASSWORD=your_db_password
DB_POOL_MAX=10

# Redis Cloud (SSL)
REDIS_HOST=your.redis.host
REDIS_PORT=10109
REDIS_PASSWORD=your_redis_password
REDIS_URL=redis://default:PASSWORD@HOST:PORT

# JWT (random string ยาวอย่างน้อย 32 ตัว)
JWT_SECRET=change_this_to_random_secret_min_32_chars
JWT_EXPIRES_IN=8h

# LINE Messaging API
LINE_CHANNEL_ACCESS_TOKEN=your_token
LINE_CHANNEL_SECRET=your_secret

# QR Secret (ดูจาก admin config ของระบบ LINE OA มหาวิทยาลัย)
QR_SECRET=your_qr_secret_key

# รูปนักศึกษา (ดึงจาก Registrar แล้ว resize เก็บ local)
PHOTO_BASE_URL=https://reg.northbkk.ac.th/studentimg
THUMBNAIL_DIR=/var/www/app/nbu-activity-checkin/public/thumbnails
THUMBNAIL_BASE_URL=https://activity.northbkk.ac.th/thumbnails
THUMBNAIL_SIZE=120
THUMBNAIL_QUALITY=80
```

---

## การ Deploy ขึ้น Server

### อัตโนมัติ (แนะนำ)

```bash
# Deploy ทั้งโปรเจกต์
python scripts/deploy.py

# Deploy เฉพาะไฟล์ที่แก้ไข (เร็วกว่า)
python scripts/deploy.py src/stats/index.html src/admin/index.html
```

script จะ: upload ไฟล์ → extract → npm install → restart PM2 → setup Nginx

### จัดการ Service (PM2)

```bash
# PM2 ของ root (process จริงที่ server ใช้)
echo 'PASSWORD' | sudo -S pm2 list
echo 'PASSWORD' | sudo -S pm2 restart 19   # id:19 = nbu-activity
echo 'PASSWORD' | sudo -S pm2 logs 19

# ดู log
sudo pm2 logs nbu-activity --lines 100
```

> **หมายเหตุ:** Server มี PM2 สองชุด — ใช้ **root PM2 id:19** เท่านั้น (port 5533)

---

## คู่มือการใช้งาน Admin

### Role และสิทธิ์

| Role | สิทธิ์ |
| ---- | ------ |
| superadmin | ทุกอย่าง รวมถึงสร้าง admin/superadmin |
| admin | สร้าง/แก้ไขกิจกรรม, จัดการ staff, Import นักศึกษา (สร้าง superadmin ไม่ได้) |
| staff | เปิด/ปิด session เช็คชื่อ, ดู report เฉพาะกิจกรรมที่ได้รับมอบหมาย |
| dean | Login หน้า Stats เท่านั้น — ดูสถิติเฉพาะคณะตัวเอง (`faculty_scope`) |
| manager | Login หน้า Stats เท่านั้น — ดูสถิติและ export ได้ทุกคณะ ไม่ต้องระบุ `faculty_scope` |

**หมายเหตุ:** Dean และ Manager เข้าได้เฉพาะ `https://activity.northbkk.ac.th/stats` ไม่มีสิทธิ์ใน Admin panel

---

### จัดการกิจกรรม

**สร้างกิจกรรมใหม่**

1. คลิก **+ สร้างกิจกรรม**
2. กรอกข้อมูลหลัก: ชื่อ, วันที่, สถานที่, ประเภท
3. เลือก **Staff** ที่รับผิดชอบ
4. กำหนด **กลุ่มเป้าหมาย** (optional):
   - แบบ rule: เลือกคณะ / ระดับ / รุ่น (เพิ่มได้หลายกลุ่ม)
   - แบบ import: อัปโหลด CSV รายชื่อเฉพาะ
5. คลิก **บันทึก**

**กลุ่มเป้าหมาย** ใช้แสดงสถิติ "เป้าหมาย vs เข้าร่วม" และรายชื่อขาด

---

### ออกรายงาน

- **Admin** → เมนู **รายงาน** → Export Excel / CSV
- **ผู้บริหาร / Dean** → `https://activity.northbkk.ac.th/stats` → Export CSV พร้อมสถานะ (เข้าร่วม/ขาด)
- **สาธารณะ** → `https://activity.northbkk.ac.th/report` → ดูกราฟ ไม่มีชื่อนักศึกษา

---

### Import นักศึกษาเข้ากิจกรรม

สำหรับกิจกรรมที่รู้รายชื่อล่วงหน้า (เช่น เชิญเฉพาะ):

1. ไปที่กิจกรรม → ส่วน **กลุ่มเป้าหมาย**
2. คลิก **Import CSV รายชื่อ**
3. อัปโหลด CSV ที่มีคอลัมน์ `student_id`
4. ระบบจะนับเป็น "กลุ่มเป้าหมาย" ในสถิติ

---

## คู่มือการใช้งาน Scanner (iPad)

### การเตรียมการ

1. เปิด browser บน iPad ไปที่ `https://activity.northbkk.ac.th/scanner`
2. ล็อกอินด้วย account staff / admin
3. ต่อเครื่องสแกน Barcode ผ่าน USB หรือ Bluetooth (รองรับ keyboard wedge ทุกรุ่น)

### เปิด Session เช็คชื่อ

1. เลือกกิจกรรมจาก dropdown ด้านบน
2. คลิก **เปิด Session** → badge เปลี่ยนเป็นสีเขียว "Session เปิด ✓"
3. คลิกกล่อง **"คลิกที่นี่ แล้วสแกน QR Code"** เพื่อ focus
4. นักศึกษาแสดง QR → สแกนได้เลย

### ผลลัพธ์การสแกน

| สัญญาณ | ความหมาย |
| ------ | -------- |
| เสียงสั้น + แสงเขียว | เช็คชื่อสำเร็จ แสดงชื่อ/รูปนักศึกษา |
| เสียงสองครั้ง + แสงแดง | เช็คชื่อซ้ำ หรือ QR หมดอายุ / ไม่ถูกต้อง |

### เช็คชื่อ Manual (กรณีสแกนไม่ได้)

1. พิมพ์ชื่อหรือรหัสนักศึกษาในช่อง **"ค้นหาด้วยชื่อ / รหัสนักศึกษา"**
2. คลิก **ค้นหา**
3. คลิกที่ชื่อนักศึกษาในผลลัพธ์เพื่อเช็คชื่อ

> **หมายเหตุ:** ถ้าหน้าจอค้าง ให้คลิกพื้นที่ว่างเพื่อ refocus input ก่อนสแกน

---

## การ Import นักศึกษา

### รูปแบบ CSV

```csv
student_id,full_name,faculty,major,level,study_period
671280108,นายสมชาย ใจดี,บริหารธุรกิจ,การตลาด,ปริญญาตรี,ภาคปกติ
671280109,นางสาวมานี รักดี,นิเทศศาสตร์,การประชาสัมพันธ์,ปริญญาตรี,ภาคปกติ
```

### รันคำสั่ง

```bash
# Import ปกติ (download รูปนักศึกษาด้วย)
python scripts/import_students.py students.csv

# Import ข้าม download รูป (เร็วกว่า)
python scripts/import_students.py students.csv --skip-photos

# ทดสอบโดยไม่บันทึก
python scripts/import_students.py students.csv --dry-run
```

script จะ:

- บันทึกข้อมูลลง `nbu_students` (PostgreSQL)
- เขียน cache ลง Redis ทุก key `student:{student_id}`
- Download รูปจาก `reg.northbkk.ac.th` → resize 120×120px → เก็บใน `THUMBNAIL_DIR`

### URL รูปนักศึกษา

```text
รหัส 671280108 → https://reg.northbkk.ac.th/studentimg/67/671280108.jpg
Thumbnail      → https://activity.northbkk.ac.th/thumbnails/671280108.jpg
```

---

## API Reference

### Authentication

```http
POST /api/v1/auth/login
Body: { "username": "admin", "password": "..." }
Response: { "success": true, "token": "eyJ...", "user": {...} }
```

ทุก request (ยกเว้น public endpoints) ต้องส่ง header:

```http
Authorization: Bearer <token>
```

---

### Public Endpoints (ไม่ต้อง login)

| Method | Endpoint | คำอธิบาย |
| ------ | -------- | -------- |
| GET | `/api/v1/public/activities` | รายการกิจกรรมที่เปิดอยู่ + จำนวนผู้เข้าร่วม |
| GET | `/api/v1/public/stats/:activityId` | สถิติแยกคณะ/สาขา (ไม่มีชื่อนักศึกษา) |

---

### Activities

| Method | Endpoint | คำอธิบาย |
| ------ | -------- | -------- |
| GET | `/api/v1/activities` | รายการกิจกรรมทั้งหมด |
| POST | `/api/v1/activities` | สร้างกิจกรรมใหม่ |
| GET | `/api/v1/activities/:id` | ดูกิจกรรม + session ล่าสุด + targets |
| PUT | `/api/v1/activities/:id` | แก้ไขกิจกรรม |
| DELETE | `/api/v1/activities/:id` | ลบกิจกรรม |
| POST | `/api/v1/activities/:id/session/open` | เปิด session เช็คชื่อ |
| POST | `/api/v1/activities/:id/session/close` | ปิด session |
| GET | `/api/v1/activities/:id/sessions` | ประวัติ session ทั้งหมด |
| POST | `/api/v1/activities/:id/staff` | เพิ่ม staff |
| DELETE | `/api/v1/activities/:id/staff/:userId` | ลบ staff |
| POST | `/api/v1/activities/:id/import-targets` | Import CSV รายชื่อเป้าหมาย |
| GET | `/api/v1/activities/:id/target-count` | นับจำนวนเป้าหมาย |

**Body สร้างกิจกรรม:**

```json
{
  "title": "พบอาจารย์ที่ปรึกษา",
  "location": "ห้องเรียน",
  "activity_type": "academic",
  "start_datetime": "2026-05-01T08:00:00",
  "end_datetime": "2026-05-01T17:00:00",
  "max_participants": 0,
  "staff_ids": ["uuid-1"],
  "targets": [
    { "faculty": null, "level": "ปริญญาตรี", "year": "68" },
    { "faculty": null, "level": "ปริญญาตรี สมทบ", "year": "68" }
  ]
}
```

---

### Attendance

| Method | Endpoint | คำอธิบาย |
| ------ | -------- | -------- |
| POST | `/api/v1/attendance/scan` | เช็คชื่อด้วย QR |
| POST | `/api/v1/attendance/manual` | เช็คชื่อ manual |
| GET | `/api/v1/attendance/:activityId` | รายชื่อผู้เข้าร่วม |
| DELETE | `/api/v1/attendance/:id` | ลบรายการเช็คชื่อ |

**QR Scan:**
```json
POST /api/v1/attendance/scan
{
  "qr_raw": "671280108|1775716100|6dd426b0ff3fcf28",
  "activity_id": "uuid-of-activity",
  "session_id": "uuid-of-session"
}
```

---

### Stats (ต้อง login: admin / dean)

| Method | Endpoint | คำอธิบาย |
| ------ | -------- | -------- |
| GET | `/api/v1/stats/activities` | รายการกิจกรรม + จำนวนผู้เข้าร่วม |
| GET | `/api/v1/stats/:activityId` | สถิติเต็ม: แยกคณะ/สาขา, ล่าสุด, รายชื่อขาด |

> Dean จะเห็นเฉพาะข้อมูลคณะตัวเองตาม `faculty_scope` ใน JWT

---

### Students

| Method | Endpoint | คำอธิบาย |
| ------ | -------- | -------- |
| GET | `/api/v1/students/meta` | รายการคณะ / ระดับ / รุ่น ทั้งหมดใน DB |
| GET | `/api/v1/students/search?q=` | ค้นหานักศึกษา |
| GET | `/api/v1/students/:studentId` | ดูข้อมูลนักศึกษา |
| GET | `/api/v1/students/faculties` | รายการคณะ |

---

### Reports

| Method | Endpoint | คำอธิบาย |
| ------ | -------- | -------- |
| GET | `/api/v1/reports/:activityId/excel` | Export Excel |
| GET | `/api/v1/reports/:activityId/pdf` | Export PDF |

---

### Users (Admin เท่านั้น)

| Method | Endpoint | คำอธิบาย |
| ------ | -------- | -------- |
| GET | `/api/v1/users` | รายการผู้ใช้ทั้งหมด |
| POST | `/api/v1/users` | สร้างผู้ใช้ใหม่ |
| PUT | `/api/v1/users/:id` | แก้ไขผู้ใช้ |
| DELETE | `/api/v1/users/:id` | ลบผู้ใช้ |

---

### LIFF (LINE Frontend Framework)

| Method | Endpoint | คำอธิบาย |
| ------ | -------- | -------- |
| GET | `/api/v1/liff/me?token=` | ดูข้อมูลตัวเองผ่าน LINE access token |
| GET | `/api/v1/liff/history?token=` | ประวัติการเข้าร่วมกิจกรรม |

---

## โครงสร้างโปรเจกต์

```
nbu-activity-checkin/
├── server.js                     ← entry point (Express)
├── package.json
├── .env                          ← ไม่ commit (gitignore)
├── .env.example                  ← template
├── ecosystem.config.cjs          ← PM2 config
│
├── src/
│   ├── api/
│   │   ├── db.js                 ← PostgreSQL pool
│   │   ├── redis.js              ← Redis client
│   │   ├── middleware/
│   │   │   └── auth.js           ← JWT verify middleware
│   │   └── routes/
│   │       ├── auth.js           ← POST /auth/login
│   │       ├── activities.js     ← CRUD + session + targets + import
│   │       ├── attendance.js     ← scan + manual + list
│   │       ├── students.js       ← search + meta
│   │       ├── users.js          ← CRUD users
│   │       ├── reports.js        ← Excel + PDF export
│   │       ├── stats.js          ← สถิติผู้บริหาร (JWT required)
│   │       ├── public.js         ← สถิติสาธารณะ (no auth)
│   │       ├── import.js         ← Import นักศึกษา CSV
│   │       └── liff.js           ← LIFF API (LINE token auth)
│   │
│   ├── admin/
│   │   └── index.html            ← Admin Web UI (SPA)
│   ├── scanner/
│   │   └── index.html            ← Scanner App (iPad)
│   ├── stats/
│   │   └── index.html            ← รายงานผู้บริหาร (login required)
│   ├── report/
│   │   └── index.html            ← รายงานสาธารณะ (no login)
│   ├── liff/
│   │   └── index.html            ← LIFF App สำหรับ LINE OA
│   ├── home/
│   │   └── index.html            ← หน้าแรก
│   └── line-oa/
│       └── webhook.js            ← LINE webhook + Flex Messages
│
├── database/
│   ├── schema.sql                ← DDL ตาราง/view/trigger
│   └── migrate.js                ← รัน schema.sql
│
├── docs/
│   ├── SYSTEM.md                 ← System documentation
│   ├── database-connect.md       ← Database & host summary
│   └── nginx.conf                ← Nginx config ตัวอย่าง
│
└── scripts/
    ├── import_students.py        ← CSV → PostgreSQL + Redis
    ├── create_admin.mjs          ← สร้าง user เริ่มต้น
    └── deploy.py                 ← deploy อัตโนมัติผ่าน SSH/SFTP
```

---

## QR Code Format

```
{student_id}|{exp_unix_timestamp}|{hmac_sha256_16chars}
```

ตัวอย่าง:
```
671280108|1775716100|6dd426b0ff3fcf28
```

- `student_id` — รหัสนักศึกษา
- `exp` — Unix timestamp หมดอายุ (ปัจจุบัน + 5 นาที)
- `hmac` — HMAC-SHA256 ของ `student_id|exp` ย่อเหลือ 16 ตัว ด้วย `QR_SECRET`

---

## Troubleshooting

### Server ไม่ตอบสนอง

```bash
# ตรวจสอบ PM2 ด้วย root
echo 'PASSWORD' | sudo -S pm2 list
echo 'PASSWORD' | sudo -S pm2 restart 19
```

### Redis ต่อไม่ได้

```bash
# ตรวจสอบ config ใน .env — Redis Cloud ใช้ REDIS_URL เต็ม
pm2 restart nbu-activity --update-env
```

### Stats 500 error

- มักเกิดจาก query ตาราง `nbu_students` ที่ยังไม่มีข้อมูล
- ให้ import นักศึกษาก่อน: `python scripts/import_students.py students.csv`

### Export PDF ภาษาไทยไม่แสดง

> pdfkit ไม่รองรับฟอนต์ไทย by default — แนะนำให้ใช้ **Export Excel** แทน

---

## License

สงวนสิทธิ์ มหาวิทยาลัยนอร์ทกรุงเทพ © 2026
