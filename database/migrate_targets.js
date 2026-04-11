// database/migrate_targets.js
// สร้างตาราง nbu_activity_targets สำหรับกำหนดกลุ่มเป้าหมายของกิจกรรม
import { query } from '../src/api/db.js';

async function migrate() {
    console.log('Running migrate_targets...');

    await query(`
        CREATE TABLE IF NOT EXISTS nbu_activity_targets (
            id          SERIAL PRIMARY KEY,
            activity_id INTEGER NOT NULL,
            faculty     VARCHAR(100)  DEFAULT NULL,
            year        SMALLINT      DEFAULT NULL,
            created_at  TIMESTAMPTZ  DEFAULT NOW(),
            UNIQUE (activity_id, faculty, year)
        )
    `);
    console.log('✅ nbu_activity_targets created');

    await query(`CREATE INDEX IF NOT EXISTS idx_act_targets_activity ON nbu_activity_targets(activity_id)`);
    console.log('✅ index created');

    process.exit(0);
}

migrate().catch(err => { console.error(err.message); process.exit(1); });
