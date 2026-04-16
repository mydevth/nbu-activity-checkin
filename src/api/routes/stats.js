// src/api/routes/stats.js
import { Router } from 'express';
import { query }      from '../db.js';
import { verifyJWT }  from '../middleware/auth.js';

const router = Router();
router.use(verifyJWT);

function canAccess(role) {
    return ['superadmin', 'admin', 'dean', 'manager'].includes(role);
}

// ─── GET /api/v1/stats/activities ─────────────────────────────────────────────
// รายการกิจกรรมที่ is_active = true พร้อมจำนวนผู้เข้าร่วม
router.get('/activities', async (req, res) => {
    if (!canAccess(req.user.role)) {
        return res.status(403).json({ success: false, message: 'ไม่มีสิทธิ์' });
    }
    const isDean = req.user.role === 'dean';
    const scope  = req.user.faculty_scope;

    try {
        let rows;
        if (isDean && scope) {
            // dean เห็นทุกกิจกรรม แต่นับเฉพาะนักศึกษาในคณะตัวเอง
            ({ rows } = await query(`
                SELECT a.id, a.title, a.location, a.start_datetime,
                       COUNT(DISTINCT att.student_id)
                           FILTER (WHERE s.faculty = $1) AS attendee_count
                FROM nbu_activities a
                LEFT JOIN nbu_attendance att ON att.activity_id = a.id
                LEFT JOIN nbu_students   s   ON s.student_id    = att.student_id
                WHERE a.is_active = true
                GROUP BY a.id
                ORDER BY a.start_datetime DESC
            `, [scope]));
        } else {
            ({ rows } = await query(`
                SELECT a.id, a.title, a.location, a.start_datetime,
                       COUNT(DISTINCT att.student_id) AS attendee_count
                FROM nbu_activities a
                LEFT JOIN nbu_attendance att ON att.activity_id = a.id
                WHERE a.is_active = true
                GROUP BY a.id
                ORDER BY a.start_datetime DESC
            `));
        }
        return res.json({ success: true, data: rows });
    } catch (err) {
        console.error('Stats activities error:', err);
        return res.status(500).json({ success: false, message: 'เกิดข้อผิดพลาด' });
    }
});

// ─── GET /api/v1/stats/:activityId ────────────────────────────────────────────
// สถิติรายละเอียดของกิจกรรม: แยกคณะ, แยกสาขา, QR vs Manual, ล่าสุด
router.get('/:activityId', async (req, res) => {
    if (!canAccess(req.user.role)) {
        return res.status(403).json({ success: false, message: 'ไม่มีสิทธิ์' });
    }
    const { activityId } = req.params;
    const isDean = req.user.role === 'dean';
    const scope  = isDean ? req.user.faculty_scope : null;
    const p2     = scope ? [activityId, scope] : [activityId];
    const filt   = scope ? 'AND s.faculty = $2' : '';

    try {
        const actRes = await query(
            'SELECT id, title, location, start_datetime FROM nbu_activities WHERE id = $1',
            [activityId]
        );
        if (!actRes.rows[0]) {
            return res.status(404).json({ success: false, message: 'ไม่พบกิจกรรม' });
        }

        // โหลด targets ของกิจกรรม — ลำดับความสำคัญ: explicit list > rules
        const [targetStudentsRes, targetRows_r] = await Promise.all([
            query('SELECT student_id FROM nbu_activity_target_students WHERE activity_id = $1', [activityId]),
            query('SELECT faculty, year, level FROM nbu_activity_targets WHERE activity_id = $1', [activityId]),
        ]);
        const hasExplicitList = targetStudentsRes.rows.length > 0;
        const targetRows      = targetRows_r.rows;
        const hasRuleTargets  = targetRows.length > 0;
        const hasTargets      = hasExplicitList || hasRuleTargets;

        // สร้าง WHERE สำหรับกรองนักศึกษาในกลุ่มเป้าหมาย
        function buildTargetWhere(alias = 's') {
            if (!hasTargets) return { clause: 'TRUE', params: [] };
            if (hasExplicitList) {
                // ใช้รายชื่อที่ import มา
                const ids = targetStudentsRes.rows.map(r => `'${r.student_id.replace(/'/g,"''")}'`).join(',');
                return { clause: `${alias}.student_id IN (${ids})`, params: [] };
            }
            // ใช้ rule-based
            const parts = targetRows.map(t => {
                const fc = t.faculty ? `${alias}.faculty = '${t.faculty.replace(/'/g, "''")}'` : 'TRUE';
                const lv = t.level   ? `${alias}.level = '${t.level.replace(/'/g, "''")}'`     : 'TRUE';
                const yr = t.year    ? `SUBSTRING(${alias}.student_id, 1, 2) = '${parseInt(t.year).toString().padStart(2,'0')}'` : 'TRUE';
                return `(${fc} AND ${lv} AND ${yr})`;
            });
            return { clause: `(${parts.join(' OR ')})`, params: [] };
        }
        const tgt = buildTargetWhere('s');

        const [totalRes, byFacultyRes, byFacultyMajorRes, recentRes, targetCountRes, absentRes,
               attendedRes, tgtByFacultyRes, tgtByMajorRes, nonTargetRes] = await Promise.all([
            // รวมทั้งหมด
            scope
                ? query(`SELECT COUNT(*) AS c FROM nbu_attendance att
                         JOIN nbu_students s ON s.student_id = att.student_id
                         WHERE att.activity_id = $1 ${filt}`, p2)
                : query(`SELECT COUNT(*) AS c FROM nbu_attendance WHERE activity_id = $1`, [activityId]),

            // แยกตามคณะ
            query(`
                SELECT s.faculty AS label, COUNT(*) AS count
                FROM nbu_attendance att
                JOIN nbu_students s ON s.student_id = att.student_id
                WHERE att.activity_id = $1 ${filt}
                GROUP BY s.faculty ORDER BY count DESC
            `, p2),

            // แยกตามคณะ + สาขา
            query(`
                SELECT s.faculty, s.major AS label, COUNT(*) AS count
                FROM nbu_attendance att
                JOIN nbu_students s ON s.student_id = att.student_id
                WHERE att.activity_id = $1 ${filt}
                GROUP BY s.faculty, s.major
                ORDER BY s.faculty, count DESC
            `, p2),

            // เช็คชื่อล่าสุด 15 คน (สำหรับ live feed)
            query(`
                SELECT att.checked_at, att.method,
                       s.full_name, s.faculty, s.major, s.student_id
                FROM nbu_attendance att
                JOIN nbu_students s ON s.student_id = att.student_id
                WHERE att.activity_id = $1 ${filt}
                ORDER BY att.checked_at DESC LIMIT 15
            `, p2),

            // จำนวนเป้าหมายทั้งหมด (จากกลุ่มที่กำหนด + scope ของ dean)
            hasTargets
                ? query(`
                    SELECT COUNT(DISTINCT s.student_id) AS c
                    FROM nbu_students s
                    WHERE ${tgt.clause}
                    ${scope ? `AND s.faculty = '${scope.replace(/'/g, "''")}'` : ''}
                  `)
                : Promise.resolve({ rows: [{ c: 0 }] }),

            // รายชื่อที่ยังไม่เข้าร่วม (เฉพาะกรณีมี targets)
            hasTargets
                ? query(`
                    SELECT s.student_id, s.full_name, s.faculty, s.major,
                           SUBSTRING(s.student_id, 1, 2) AS cohort
                    FROM nbu_students s
                    WHERE ${tgt.clause}
                    ${scope ? `AND s.faculty = '${scope.replace(/'/g, "''")}'` : ''}
                    AND s.student_id NOT IN (
                        SELECT att.student_id FROM nbu_attendance att WHERE att.activity_id = $1
                    )
                    ORDER BY s.faculty, s.major, s.student_id
                  `, [activityId])
                : Promise.resolve({ rows: [] }),

            // รายชื่อผู้เข้าร่วมทั้งหมด (สำหรับ export)
            query(`
                SELECT s.student_id, s.full_name, s.faculty, s.major,
                       SUBSTRING(s.student_id, 1, 2) AS cohort
                FROM nbu_attendance att
                JOIN nbu_students s ON s.student_id = att.student_id
                WHERE att.activity_id = $1 ${filt}
                ORDER BY s.faculty, s.major, s.student_id
            `, p2),

            // เป้าหมายแยกตามคณะ
            hasTargets
                ? query(`
                    SELECT s.faculty AS label, COUNT(DISTINCT s.student_id) AS total
                    FROM nbu_students s
                    WHERE ${tgt.clause}
                    ${scope ? `AND s.faculty = '${scope.replace(/'/g, "''")}'` : ''}
                    GROUP BY s.faculty ORDER BY s.faculty
                  `)
                : Promise.resolve({ rows: [] }),

            // เป้าหมายแยกตามคณะ + สาขา
            hasTargets
                ? query(`
                    SELECT s.faculty, s.major AS label, COUNT(DISTINCT s.student_id) AS total
                    FROM nbu_students s
                    WHERE ${tgt.clause}
                    ${scope ? `AND s.faculty = '${scope.replace(/'/g, "''")}'` : ''}
                    GROUP BY s.faculty, s.major ORDER BY s.faculty, s.major
                  `)
                : Promise.resolve({ rows: [] }),

            // รายชื่อผู้เข้าร่วมที่ไม่อยู่ในกลุ่มเป้าหมาย
            hasTargets
                ? query(`
                    SELECT s.student_id, s.full_name, s.faculty, s.major,
                           SUBSTRING(s.student_id, 1, 2) AS cohort
                    FROM nbu_attendance att
                    JOIN nbu_students s ON s.student_id = att.student_id
                    WHERE att.activity_id = $1 ${filt}
                    AND NOT (${tgt.clause})
                    ORDER BY s.faculty, s.major, s.student_id
                  `, p2)
                : Promise.resolve({ rows: [] }),
        ]);

        const target_count = parseInt(targetCountRes.rows[0]?.c || 0);
        const attended     = parseInt(totalRes.rows[0]?.c || 0);


        return res.json({
            success: true,
            data: {
                activity:         actRes.rows[0],
                total:            attended,
                target_count,
                attendance_rate:  target_count > 0 ? Math.round(attended / target_count * 100) : null,
                by_faculty:       byFacultyRes.rows,
                by_faculty_major: byFacultyMajorRes.rows,
                attended:         attendedRes.rows,
                tgt_by_faculty:   tgtByFacultyRes.rows,
                tgt_by_major:     tgtByMajorRes.rows,
                recent:           recentRes.rows,
                absent:           absentRes.rows,
                non_target_attended: nonTargetRes.rows,
                targets:          targetRows,
                has_explicit_list: hasExplicitList,
                explicit_list_count: hasExplicitList ? targetStudentsRes.rows.length : 0,
                scope,
            },
        });
    } catch (err) {
        console.error('Stats detail error:', err);
        return res.status(500).json({ success: false, message: 'เกิดข้อผิดพลาด' });
    }
});

export default router;
