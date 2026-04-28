import 'dotenv/config';
import express from 'express';
import cors from 'cors';
import helmet from 'helmet';
import morgan from 'morgan';
import path from 'path';
import { fileURLToPath } from 'url';

// Routes
import authRoutes       from './src/api/routes/auth.js';
import activityRoutes   from './src/api/routes/activities.js';
import attendanceRoutes from './src/api/routes/attendance.js';
import studentRoutes    from './src/api/routes/students.js';
import reportRoutes     from './src/api/routes/reports.js';
import statsRoutes      from './src/api/routes/stats.js';
import userRoutes       from './src/api/routes/users.js';
import importRoutes     from './src/api/routes/import.js';
import liffRoutes       from './src/api/routes/liff.js';
import publicRoutes     from './src/api/routes/public.js';
import lineWebhook      from './src/line-oa/webhook.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const app = express();

// ─── Middleware ────────────────────────────────────────────────────────────
app.use(helmet({ contentSecurityPolicy: false }));
app.use(cors({ origin: process.env.BASE_URL, credentials: true }));
app.use(morgan('combined'));

// LINE webhook ต้องการ raw body → ต้องอยู่ก่อน express.json()
app.use('/line/webhook', express.raw({ type: 'application/json' }), lineWebhook);

app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// Static files
app.use('/thumbnails', express.static(process.env.THUMBNAIL_DIR || path.join(__dirname, 'public/thumbnails')));
const staticOpts = { extensions: ['html'] };
app.get('/', (req, res) => res.sendFile(path.join(__dirname, 'src/home/index.html')));
app.use('/admin',   express.static(path.join(__dirname, 'src/admin'),   staticOpts));
app.use('/scanner', express.static(path.join(__dirname, 'src/scanner'), staticOpts));
app.use('/mobile',  express.static(path.join(__dirname, 'src/mobile'),  staticOpts));
app.use('/stats',   express.static(path.join(__dirname, 'src/stats'),   staticOpts));
app.use('/liff',    express.static(path.join(__dirname, 'src/liff'),    staticOpts));
app.use('/report',  express.static(path.join(__dirname, 'src/report'),  staticOpts));
app.use('/mockup',  express.static(path.join(__dirname, 'mockup'),      staticOpts));

// ─── API Routes ────────────────────────────────────────────────────────────
app.use('/api/v1/auth',       authRoutes);
app.use('/api/v1/activities', activityRoutes);
app.use('/api/v1/attendance', attendanceRoutes);
app.use('/api/v1/students',   studentRoutes);
app.use('/api/v1/reports',    reportRoutes);
app.use('/api/v1/stats',      statsRoutes);
app.use('/api/v1/users',      userRoutes);
app.use('/api/v1/import',     importRoutes);
app.use('/api/v1/liff',       liffRoutes);
app.use('/api/v1/public',    publicRoutes);

// Health check
app.get('/api/health', (req, res) => {
    res.json({ status: 'ok', time: new Date().toISOString() });
});

// ─── Error Handler ─────────────────────────────────────────────────────────
app.use((err, req, res, next) => {
    console.error(err.stack);
    res.status(err.status || 500).json({
        success: false,
        message: err.message || 'Internal Server Error',
    });
});

// ─── Start ─────────────────────────────────────────────────────────────────
const PORT = process.env.PORT || 5533;
app.listen(PORT, () => {
    console.log(`✅ NBU Activity Server running on port ${PORT}`);
    console.log(`   ENV  : ${process.env.NODE_ENV}`);
    console.log(`   URL  : ${process.env.BASE_URL}`);
});

export default app;
