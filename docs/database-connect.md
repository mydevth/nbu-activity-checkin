# NBU Activity — Database & Connection Summary

## Server / Infrastructure

| ส่วน | รายละเอียด |
|------|-----------|
| App Server | Ubuntu — IP `147.50.10.29` |
| Process Manager | PM2 id: **19** (root), ชื่อ process: `nbu-activity` |
| App Path | `/var/www/app/nbu-activity-checkin` |
| Port | `5533` (Node.js) |
| Reverse Proxy | Nginx → `https://activity.northbkk.ac.th` |
| Thumbnail Storage | `/var/www/activity/public/thumbnails/` |

---

## PostgreSQL

| รายการ | ค่า |
|--------|-----|
| Host | `nbc.northbkk.ac.th` |
| Port | `5432` |
| Database | `nbu-actmenu` |
| User | `postgres` |
| Password | ดูใน `.env` → `DB_PASSWORD` |

### ตารางทั้งหมด

| ตาราง | คำอธิบาย | Prefix |
|-------|---------|--------|
| `users` | ผู้ใช้งานระบบ (superadmin / admin / staff / dean) | ไม่มี |
| `nbu_students` | ข้อมูลนักศึกษา — import จาก CSV | `nbu_` |
| `nbu_activities` | กิจกรรมทั้งหมด | `nbu_` |
| `nbu_activity_staff` | อาจารย์/เจ้าหน้าที่ที่รับผิดชอบแต่ละกิจกรรม | `nbu_` |
| `nbu_sessions` | session การเปิด/ปิดเช็คชื่อ | `nbu_` |
| `nbu_attendance` | บันทึกการเข้าร่วม — **หัวใจหลักของระบบ** | `nbu_` |
| `nbu_activity_targets` | กลุ่มเป้าหมาย แบบ rule (คณะ / ระดับ / รุ่น) | `nbu_` |
| `nbu_activity_target_students` | กลุ่มเป้าหมาย แบบ explicit (รายชื่อรายบุคคล) | `nbu_` |
| `line_student_links` | เชื่อม LINE `user_id` ↔ `student_id` | ไม่มี |

### Views

| View | คำอธิบาย |
|------|---------|
| `nbu_v_activity_summary` | สรุปจำนวนผู้เข้าร่วมต่อกิจกรรม |
| `nbu_v_attendance_detail` | รายชื่อผู้เข้าร่วมพร้อมข้อมูลนักศึกษา |

---

## Redis

| รายการ | ค่า |
|--------|-----|
| Host | Redis Cloud (SSL) — ดูใน `.env` → `REDIS_HOST` / `REDIS_PORT` |
| Password | ดูใน `.env` → `REDIS_PASSWORD` |
| Key Pattern | `student:{student_id}` (HASH) |
| ใช้งาน | cache ข้อมูลนักศึกษาสำหรับ QR scan — response < 5ms |

---

## External Services

| บริการ | Host / URL | ใช้งาน |
|--------|-----------|--------|
| LINE Messaging API | `api.line.me` | webhook + Flex Message |
| LINE LIFF | `liff.line.me` | แสดงประวัตินักศึกษาใน LINE |
| รูปนักศึกษา (ต้นทาง) | `reg.northbkk.ac.th/studentimg/{yy}/{student_id}.jpg` | ดึงรูปจาก Registrar |
| Thumbnail (local) | `activity.northbkk.ac.th/thumbnails/{student_id}.jpg` | serve รูปที่ resize แล้ว |

---

## URL ของระบบ

| ส่วน | URL |
|------|-----|
| ระบบหลัก | `https://activity.northbkk.ac.th/` |
| Admin panel | `https://activity.northbkk.ac.th/admin` |
| Scanner app (iPad) | `https://activity.northbkk.ac.th/scanner` |
| รายงานสาธารณะ | `https://activity.northbkk.ac.th/report` |
| รายงานผู้บริหาร | `https://activity.northbkk.ac.th/stats` |
| API base | `https://activity.northbkk.ac.th/api/v1` |
| LINE OA webhook | `https://activity.northbkk.ac.th/line/webhook` |
| LIFF app | `https://activity.northbkk.ac.th/liff` |

---

## Deploy

```bash
# Upload ไฟล์และ restart
python scripts/deploy.py [file1] [file2] ...

# Restart PM2 (ผ่าน SSH ด้วย root sudo)
echo 'PASSWORD' | sudo -S pm2 restart 19
```

SSH User: `akkadate` | Host: `147.50.10.29`
