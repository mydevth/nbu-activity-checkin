users                          ← admin/staff/dean accounts
nbu_students                   ← ข้อมูลนักศึกษา (import จาก CSV)
nbu_activities                 ← กิจกรรม
nbu_activity_staff             ← อาจารย์ที่รับผิดชอบ (junction)
nbu_sessions                   ← session เช็คชื่อ (open/closed)
nbu_attendance                 ← การเข้าร่วม (UNIQUE: activity+student)
nbu_activity_targets           ← target rules (faculty/level/year)
nbu_activity_target_students   ← explicit student list
line_student_links             ← LINE UUID ↔ student_id
nbu_v_activity_summary         ← view สรุปกิจกรรม
nbu_v_attendance_detail        ← view รายละเอียดเข้าร่วม
