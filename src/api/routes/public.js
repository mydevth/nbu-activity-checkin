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

        const [tgtStuRes, tgtRuleRes] = await Promise.all([
            query('SELECT student_id FROM nbu_activity_target_students WHERE activity_id = $1', [activityId]),
            query('SELECT faculty, year, level FROM nbu_activity_targets WHERE activity_id = $1', [activityId]),
        ]);
        const hasExplicit    = tgtStuRes.rows.length > 0;
        const targetRows     = tgtRuleRes.rows;
        const hasRules       = targetRows.length > 0;
        const hasTargets     = hasExplicit || hasRules;

        function buildTargetWhere(alias = 's') {
            if (!hasTargets) return 'TRUE';
            if (hasExplicit) {
                const ids = tgtStuRes.rows.map(r => `'${r.student_id.replace(/'/g,"''")}'`).join(',');
                return `${alias}.student_id IN (${ids})`;
            }
            const parts = targetRows.map(t => {
                const fc = t.faculty ? `${alias}.faculty = '${t.faculty.replace(/'/g, "''")}'` : 'TRUE';
                const lv = t.level   ? `${alias}.level = '${t.level.replace(/'/g, "''")}'`     : 'TRUE';
                const yr = t.year    ? `SUBSTRING(${alias}.student_id, 1, 2) = '${parseInt(t.year).toString().padStart(2,'0')}'` : 'TRUE';
                return `(${fc} AND ${lv} AND ${yr})`;
            });
            return `(${parts.join(' OR ')})`;
        }

        const tgtWhere = buildTargetWhere('s');
        const [totalRes, byFacultyRes, byMajorRes, targetCountRes, tgtByFacultyRes, tgtByMajorRes] = await Promise.all([
            query(`SELECT COUNT(*) AS c FROM nbu_attendance WHERE activity_id = $1`, [activityId]),
            query(`
                SELECT s.faculty AS label, COUNT(*) AS count
                FROM nbu_attendance att
                JOIN nbu_students s ON s.student_id = att.student_id
                WHERE att.activity_id = $1
                GROUP BY s.faculty ORDER BY count DESC
            `, [activityId]),
            query(`
                SELECT s.faculty, s.major AS label, COUNT(*) AS count
                FROM nbu_attendance att
                JOIN nbu_students s ON s.student_id = att.student_id
                WHERE att.activity_id = $1
                GROUP BY s.faculty, s.major ORDER BY s.faculty, count DESC
            `, [activityId]),
            hasTargets
                ? query(`SELECT COUNT(DISTINCT s.student_id) AS c FROM nbu_students s WHERE ${tgtWhere}`)
                : Promise.resolve({ rows: [{ c: 0 }] }),
            hasTargets
                ? query(`SELECT s.faculty AS label, COUNT(DISTINCT s.student_id) AS total FROM nbu_students s WHERE ${tgtWhere} GROUP BY s.faculty ORDER BY s.faculty`)
                : Promise.resolve({ rows: [] }),
            hasTargets
                ? query(`SELECT s.faculty, s.major AS label, COUNT(DISTINCT s.student_id) AS total FROM nbu_students s WHERE ${tgtWhere} GROUP BY s.faculty, s.major ORDER BY s.faculty, s.major`)
                : Promise.resolve({ rows: [] }),
        ]);

        const total        = parseInt(totalRes.rows[0]?.c || 0);
        const target_count = parseInt(targetCountRes.rows[0]?.c || 0);

        return res.json({
            success: true,
            data: {
                activity:        actRes.rows[0],
                total,
                target_count,
                attendance_rate: target_count > 0 ? Math.round(total / target_count * 100) : null,
                by_faculty:      byFacultyRes.rows,
                by_major:        byMajorRes.rows,
                tgt_by_faculty:  tgtByFacultyRes.rows,
                tgt_by_major:    tgtByMajorRes.rows,
            },
        });
    } catch (err) {
        console.error('Public stats error:', err);
        return res.status(500).json({ success: false, message: 'เกิดข้อผิดพลาด' });
    }
});

export default router;
