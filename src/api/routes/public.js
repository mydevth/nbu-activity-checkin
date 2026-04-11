// src/api/routes/public.js
// Public endpoints — ไม่ต้อง login / ไม่แสดงชื่อนักศึกษา
import { Router } from 'express';
import { query }  from '../db.js';

const router = Router();

// ─── GET /api/v1/public/activities ────────────────────────────────────────────
// รายการกิจกรรมที่ is_active = true พร้อมจำนวนผู้เข้าร่วมรวม
router.get('/activities', async (req, res) => {
    try {
        const { rows } = await query(`
            SELECT a.id, a.title, a.description, a.location,
                   a.start_datetime, a.end_datetime,
                   COUNT(DISTINCT att.student_id) AS attendee_count
            FROM nbu_activities a
            LEFT JOIN nbu_attendance att ON att.activity_id = a.id
            WHERE a.is_active = true
            GROUP BY a.id
            ORDER BY a.start_datetime DESC
        `);
        return res.json({ success: true, data: rows });
    } catch (err) {
        console.error('Public activities error:', err);
        return res.status(500).json({ success: false, message: 'เกิดข้อผิดพลาด' });
    }
});

// ─── GET /api/v1/public/stats/:activityId ─────────────────────────────────────
// สถิติสาธารณะ — เฉพาะยอดรวม + แยกคณะ (ไม่มีชื่อนักศึกษา)
router.get('/stats/:activityId', async (req, res) => {
    const { activityId } = req.params;
    try {
        const actRes = await query(
            `SELECT id, title, description, location, start_datetime, end_datetime
             FROM nbu_activities WHERE id = $1 AND is_active = true`,
            [activityId]
        );
        if (!actRes.rows[0]) {
            return res.status(404).json({ success: false, message: 'ไม่พบกิจกรรม' });
        }

        const [totalRes, byFacultyRes] = await Promise.all([
            query(
                `SELECT COUNT(*) AS c FROM nbu_attendance WHERE activity_id = $1`,
                [activityId]
            ),
            query(`
                SELECT s.faculty AS label, COUNT(*) AS count
                FROM nbu_attendance att
                JOIN nbu_students s ON s.student_id = att.student_id
                WHERE att.activity_id = $1
                GROUP BY s.faculty ORDER BY count DESC
            `, [activityId]),
        ]);

        return res.json({
            success: true,
            data: {
                activity:   actRes.rows[0],
                total:      parseInt(totalRes.rows[0]?.c || 0),
                by_faculty: byFacultyRes.rows,
            },
        });
    } catch (err) {
        console.error('Public stats error:', err);
        return res.status(500).json({ success: false, message: 'เกิดข้อผิดพลาด' });
    }
});

export default router;
