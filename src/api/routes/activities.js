// src/api/routes/activities.js
import { Router } from 'express';
import { query, transaction } from '../db.js';
import { verifyJWT } from '../middleware/auth.js';

const router = Router();
router.use(verifyJWT);

const isAdmin = (role) => role === 'superadmin' || role === 'admin';

// ─── GET /api/v1/activities ───────────────────────────────────────────────────
router.get('/', async (req, res) => {
    try {
        let sql, params;
        if (isAdmin(req.user.role)) {
            sql = `
                SELECT a.*, v.total_attended, v.created_by_name,
                       COALESCE(json_agg(
                           json_build_object('user_id', u.id, 'full_name', u.full_name, 'role', u.role)
                       ) FILTER (WHERE u.id IS NOT NULL), '[]') AS staff,
                       (SELECT COUNT(*) FROM nbu_activity_target_students ts WHERE ts.activity_id = a.id) AS explicit_target_count,
                       (SELECT COUNT(*) FROM nbu_activity_targets t WHERE t.activity_id = a.id) AS rule_target_count
                FROM nbu_activities a
                JOIN nbu_v_activity_summary v ON v.id = a.id
                LEFT JOIN nbu_activity_staff as2 ON as2.activity_id = a.id
                LEFT JOIN users u ON u.id = as2.user_id
                GROUP BY a.id, v.total_attended, v.created_by_name
                ORDER BY a.start_datetime DESC`;
            params = [];
        } else {
            sql = `
                SELECT a.*, v.total_attended, v.created_by_name, '[]'::json AS staff,
                       (SELECT COUNT(*) FROM nbu_activity_target_students ts WHERE ts.activity_id = a.id) AS explicit_target_count,
                       (SELECT COUNT(*) FROM nbu_activity_targets t WHERE t.activity_id = a.id) AS rule_target_count
                FROM nbu_activities a
                JOIN nbu_v_activity_summary v ON v.id = a.id
                JOIN nbu_activity_staff as2 ON as2.activity_id = a.id AND as2.user_id = $1
                ORDER BY a.start_datetime DESC`;
            params = [req.user.id];
        }
        const { rows } = await query(sql, params);
        return res.json({ success: true, data: rows, total: rows.length });
    } catch (err) {
        console.error('GET activities error:', err);
        return res.status(500).json({ success: false, message: 'เกิดข้อผิดพลาด' });
    }
});

// ─── GET /api/v1/activities/:id ───────────────────────────────────────────────
router.get('/:id', async (req, res) => {
    try {
        const { rows } = await query(
            `SELECT a.*, v.total_attended, v.created_by_name,
                    COALESCE(json_agg(
                        json_build_object('user_id', u.id, 'full_name', u.full_name, 'role', u.role)
                    ) FILTER (WHERE u.id IS NOT NULL), '[]') AS staff
             FROM nbu_activities a
             JOIN nbu_v_activity_summary v ON v.id = a.id
             LEFT JOIN nbu_activity_staff as2 ON as2.activity_id = a.id
             LEFT JOIN users u ON u.id = as2.user_id
             WHERE a.id = $1
             GROUP BY a.id, v.total_attended, v.created_by_name`,
            [req.params.id]
        );
        if (!rows.length) return res.status(404).json({ success: false, message: 'ไม่พบกิจกรรม' });

        const [sessionRes, targetRes] = await Promise.all([
            query(`SELECT id, status, opened_at, closed_at, opened_by
                   FROM nbu_sessions WHERE activity_id = $1 ORDER BY opened_at DESC LIMIT 1`,
                [req.params.id]),
            query(`SELECT id, faculty, year, level, major, study_plan, student_status FROM nbu_activity_targets WHERE activity_id = $1 ORDER BY id`,
                [req.params.id]),
        ]);
        return res.json({ success: true, data: {
            ...rows[0],
            current_session: sessionRes.rows[0] || null,
            targets: targetRes.rows,
        }});
    } catch (err) {
        console.error('GET activity error:', err);
        return res.status(500).json({ success: false, message: 'เกิดข้อผิดพลาด' });
    }
});

// ─── POST /api/v1/activities ──────────────────────────────────────────────────
router.post('/', async (req, res) => {
    if (!isAdmin(req.user.role)) return res.status(403).json({ success: false, message: 'ไม่มีสิทธิ์' });
    const { title, description, location, activity_type, start_datetime, end_datetime, max_participants, staff_ids, targets } = req.body;
    if (!title || !start_datetime || !end_datetime)
        return res.status(400).json({ success: false, message: 'กรุณากรอก title, start_datetime, end_datetime' });

    try {
        const result = await transaction(async (client) => {
            const { rows } = await client.query(
                `INSERT INTO nbu_activities (title, description, location, activity_type, start_datetime, end_datetime, max_participants, created_by)
                 VALUES ($1,$2,$3,$4,$5,$6,$7,$8) RETURNING *`,
                [title, description || '', location || '', activity_type || 'general',
                 start_datetime, end_datetime, max_participants || 0, req.user.id]
            );
            const activity = rows[0];
            if (Array.isArray(staff_ids) && staff_ids.length > 0) {
                for (const uid of staff_ids) {
                    await client.query(
                        'INSERT INTO nbu_activity_staff (activity_id, user_id) VALUES ($1,$2) ON CONFLICT DO NOTHING',
                        [activity.id, uid]
                    );
                }
            }
            if (Array.isArray(targets) && targets.length > 0) {
                for (const t of targets) {
                    await client.query(
                        `INSERT INTO nbu_activity_targets (activity_id, faculty, year, level, major, study_plan, student_status) VALUES ($1,$2,$3,$4,$5,$6,$7) ON CONFLICT DO NOTHING`,
                        [activity.id, t.faculty || null, t.year || null, t.level || null, t.major || null, t.study_plan || null, t.student_status || null]
                    );
                }
            }
            return activity;
        });
        return res.status(201).json({ success: true, data: result });
    } catch (err) {
        console.error('POST activity error:', err);
        return res.status(500).json({ success: false, message: 'เกิดข้อผิดพลาด' });
    }
});

// ─── PUT /api/v1/activities/:id ───────────────────────────────────────────────
router.put('/:id', async (req, res) => {
    if (!isAdmin(req.user.role)) return res.status(403).json({ success: false, message: 'ไม่มีสิทธิ์' });
    const { title, description, location, activity_type, start_datetime, end_datetime, max_participants, is_active, staff_ids, targets } = req.body;
    try {
        const { rows } = await query(
            `UPDATE nbu_activities SET
                title = COALESCE($1, title), description = COALESCE($2, description),
                location = COALESCE($3, location), activity_type = COALESCE($4, activity_type),
                start_datetime = COALESCE($5, start_datetime), end_datetime = COALESCE($6, end_datetime),
                max_participants = COALESCE($7, max_participants), is_active = COALESCE($8, is_active)
             WHERE id = $9 RETURNING *`,
            [title, description, location, activity_type, start_datetime, end_datetime, max_participants, is_active, req.params.id]
        );
        if (!rows.length) return res.status(404).json({ success: false, message: 'ไม่พบกิจกรรม' });

        if (Array.isArray(staff_ids)) {
            await query('DELETE FROM nbu_activity_staff WHERE activity_id = $1', [req.params.id]);
            for (const uid of staff_ids) {
                await query(
                    'INSERT INTO nbu_activity_staff (activity_id, user_id) VALUES ($1,$2) ON CONFLICT DO NOTHING',
                    [req.params.id, uid]
                );
            }
        }
        if (Array.isArray(targets)) {
            await query('DELETE FROM nbu_activity_targets WHERE activity_id = $1', [req.params.id]);
            for (const t of targets) {
                await query(
                    `INSERT INTO nbu_activity_targets (activity_id, faculty, year, level, major, study_plan, student_status) VALUES ($1,$2,$3,$4,$5,$6,$7) ON CONFLICT DO NOTHING`,
                    [req.params.id, t.faculty || null, t.year || null, t.level || null, t.major || null, t.study_plan || null, t.student_status || null]
                );
            }
        }
        return res.json({ success: true, data: rows[0] });
    } catch (err) {
        console.error('PUT activity error:', err);
        return res.status(500).json({ success: false, message: 'เกิดข้อผิดพลาด' });
    }
});

// ─── DELETE /api/v1/activities/:id ───────────────────────────────────────────
router.delete('/:id', async (req, res) => {
    if (!isAdmin(req.user.role)) return res.status(403).json({ success: false, message: 'ไม่มีสิทธิ์' });
    try {
        const { rowCount } = await query('DELETE FROM nbu_activities WHERE id = $1', [req.params.id]);
        if (!rowCount) return res.status(404).json({ success: false, message: 'ไม่พบกิจกรรม' });
        return res.json({ success: true, message: 'ลบกิจกรรมสำเร็จ' });
    } catch (err) {
        console.error('DELETE activity error:', err);
        return res.status(500).json({ success: false, message: 'เกิดข้อผิดพลาด' });
    }
});

// ─── POST /api/v1/activities/:id/session/open ─────────────────────────────────
router.post('/:id/session/open', async (req, res) => {
    const activityId = req.params.id;
    if (!isAdmin(req.user.role)) {
        const { rows } = await query(
            'SELECT 1 FROM nbu_activity_staff WHERE activity_id = $1 AND user_id = $2',
            [activityId, req.user.id]
        );
        if (!rows.length) return res.status(403).json({ success: false, message: 'ไม่มีสิทธิ์เปิด session กิจกรรมนี้' });
    }
    try {
        const { rows: openSessions } = await query(
            "SELECT id FROM nbu_sessions WHERE activity_id = $1 AND status = 'open'",
            [activityId]
        );
        if (openSessions.length > 0)
            return res.status(409).json({ success: false, message: 'มี session ที่เปิดอยู่แล้ว', session_id: openSessions[0].id });

        const { rows } = await query(
            `INSERT INTO nbu_sessions (activity_id, opened_by) VALUES ($1,$2) RETURNING *`,
            [activityId, req.user.id]
        );
        return res.status(201).json({ success: true, message: 'เปิด session สำเร็จ', data: rows[0] });
    } catch (err) {
        console.error('Open session error:', err);
        return res.status(500).json({ success: false, message: 'เกิดข้อผิดพลาด' });
    }
});

// ─── POST /api/v1/activities/:id/session/close ────────────────────────────────
router.post('/:id/session/close', async (req, res) => {
    const activityId = req.params.id;
    const { session_id } = req.body;
    if (!isAdmin(req.user.role)) {
        const { rows } = await query(
            'SELECT 1 FROM nbu_activity_staff WHERE activity_id = $1 AND user_id = $2',
            [activityId, req.user.id]
        );
        if (!rows.length) return res.status(403).json({ success: false, message: 'ไม่มีสิทธิ์ปิด session กิจกรรมนี้' });
    }
    try {
        const { rows, rowCount } = await query(
            `UPDATE nbu_sessions SET status = 'closed', closed_at = NOW(), closed_by = $1
             WHERE id = $2 AND activity_id = $3 AND status = 'open' RETURNING *`,
            [req.user.id, session_id, activityId]
        );
        if (!rowCount) return res.status(404).json({ success: false, message: 'ไม่พบ session หรือ session ปิดแล้ว' });
        return res.json({ success: true, message: 'ปิด session สำเร็จ', data: rows[0] });
    } catch (err) {
        console.error('Close session error:', err);
        return res.status(500).json({ success: false, message: 'เกิดข้อผิดพลาด' });
    }
});

// ─── GET /api/v1/activities/:id/sessions ─────────────────────────────────────
router.get('/:id/sessions', async (req, res) => {
    try {
        const { rows } = await query(
            `SELECT s.*, u.full_name AS opened_by_name, cu.full_name AS closed_by_name,
                    COUNT(att.id) AS attendance_count
             FROM nbu_sessions s
             LEFT JOIN users u   ON u.id  = s.opened_by
             LEFT JOIN users cu  ON cu.id = s.closed_by
             LEFT JOIN nbu_attendance att ON att.session_id = s.id
             WHERE s.activity_id = $1
             GROUP BY s.id, u.full_name, cu.full_name
             ORDER BY s.opened_at DESC`,
            [req.params.id]
        );
        return res.json({ success: true, data: rows });
    } catch (err) {
        return res.status(500).json({ success: false, message: 'เกิดข้อผิดพลาด' });
    }
});

// ─── POST /api/v1/activities/:id/staff ───────────────────────────────────────
router.post('/:id/staff', async (req, res) => {
    if (!isAdmin(req.user.role)) return res.status(403).json({ success: false, message: 'ไม่มีสิทธิ์' });
    const { user_id } = req.body;
    try {
        await query(
            'INSERT INTO nbu_activity_staff (activity_id, user_id) VALUES ($1,$2) ON CONFLICT DO NOTHING',
            [req.params.id, user_id]
        );
        return res.json({ success: true, message: 'มอบหมาย staff สำเร็จ' });
    } catch (err) {
        return res.status(500).json({ success: false, message: 'เกิดข้อผิดพลาด' });
    }
});

// ─── POST /api/v1/activities/targets/preview ─────────────────────────────────
// นับจำนวนนักศึกษาตามกลุ่มเป้าหมายที่กำหนด (ก่อนบันทึก)
router.post('/targets/preview', async (req, res) => {
    if (!isAdmin(req.user.role)) return res.status(403).json({ success: false, message: 'ไม่มีสิทธิ์' });
    const { targets } = req.body;
    if (!Array.isArray(targets) || targets.length === 0) {
        return res.json({ success: true, count: 0 });
    }
    try {
        // ชั้นปีดูจาก 2 ตัวแรกของรหัสนักศึกษา (เช่น 67xxxx = รุ่น 2567)
        const validParams = [];
        const validConditions = targets.map(t => {
            const parts = [];
            if (t.faculty)        { validParams.push(t.faculty);        parts.push(`s.faculty = $${validParams.length}`); }
            if (t.level)          { validParams.push(t.level);          parts.push(`s.level = $${validParams.length}`); }
            if (t.major)          { validParams.push(t.major);          parts.push(`s.major = $${validParams.length}`); }
            if (t.study_plan)     { validParams.push(t.study_plan);     parts.push(`s.study_plan = $${validParams.length}`); }
            if (t.student_status) { validParams.push(t.student_status); parts.push(`s.student_status = $${validParams.length}`); }
            if (t.year)           { parts.push(`SUBSTRING(s.student_id, 1, 2) = '${parseInt(t.year).toString().padStart(2,'0')}'`); }
            return parts.length ? `(${parts.join(' AND ')})` : 'TRUE';
        });
        const whereClause = validConditions.join(' OR ');
        const { rows } = await query(
            `SELECT COUNT(DISTINCT s.student_id) AS count FROM nbu_students s WHERE ${whereClause}`,
            validParams
        );
        return res.json({ success: true, count: parseInt(rows[0]?.count || 0) });
    } catch (err) {
        console.error('Target preview error:', err);
        return res.status(500).json({ success: false, message: 'เกิดข้อผิดพลาด' });
    }
});

// ─── POST /api/v1/activities/:id/targets/students ────────────────────────────
// import รายชื่อนักศึกษาเป้าหมายสำหรับกิจกรรม (แทนที่รายชื่อเดิม)
router.post('/:id/targets/students', async (req, res) => {
    if (!isAdmin(req.user.role)) return res.status(403).json({ success: false, message: 'ไม่มีสิทธิ์' });
    const { student_ids } = req.body; // array of string
    if (!Array.isArray(student_ids)) {
        return res.status(400).json({ success: false, message: 'student_ids ต้องเป็น array' });
    }
    const activityId = req.params.id;
    try {
        // ลบรายชื่อเดิม แล้ว insert ใหม่ (ไม่กระทบ attendance)
        await query('DELETE FROM nbu_activity_target_students WHERE activity_id = $1', [activityId]);
        let inserted = 0;
        for (const sid of student_ids) {
            const clean = String(sid).trim();
            if (!clean) continue;
            await query(
                `INSERT INTO nbu_activity_target_students (activity_id, student_id) VALUES ($1,$2) ON CONFLICT DO NOTHING`,
                [activityId, clean]
            );
            inserted++;
        }
        return res.json({ success: true, inserted, message: `นำเข้า ${inserted} รายชื่อสำเร็จ` });
    } catch (err) {
        console.error('Import target students error:', err);
        return res.status(500).json({ success: false, message: 'เกิดข้อผิดพลาด' });
    }
});

// ─── GET /api/v1/activities/:id/targets/students/count ───────────────────────
router.get('/:id/targets/students/count', async (req, res) => {
    try {
        const { rows } = await query(
            'SELECT COUNT(*) AS c FROM nbu_activity_target_students WHERE activity_id = $1',
            [req.params.id]
        );
        return res.json({ success: true, count: parseInt(rows[0]?.c || 0) });
    } catch (err) {
        return res.status(500).json({ success: false, message: 'เกิดข้อผิดพลาด' });
    }
});

// ─── DELETE /api/v1/activities/:id/staff/:userId ──────────────────────────────
router.delete('/:id/staff/:userId', async (req, res) => {
    if (!isAdmin(req.user.role)) return res.status(403).json({ success: false, message: 'ไม่มีสิทธิ์' });
    try {
        await query(
            'DELETE FROM nbu_activity_staff WHERE activity_id = $1 AND user_id = $2',
            [req.params.id, req.params.userId]
        );
        return res.json({ success: true, message: 'ลบ staff สำเร็จ' });
    } catch (err) {
        return res.status(500).json({ success: false, message: 'เกิดข้อผิดพลาด' });
    }
});

export default router;
