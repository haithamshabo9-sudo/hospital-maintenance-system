require('dotenv').config();
const express = require('express');
const cors = require('cors');
const { Pool } = require('pg');
const jwt = require('jsonwebtoken');
const bcrypt = require('bcryptjs');

const pool = new Pool({ connectionString: process.env.DATABASE_URL });
const SECRET = process.env.JWT_SECRET;
if (!SECRET) throw new Error('JWT_SECRET مطلوب في ملف .env');

const app = express();
app.use(cors(), express.json());

const wrap = (fn) => (req, res) =>
  fn(req, res).catch((e) => { console.error(e); res.status(500).json({ error: 'خطأ في الخادم' }); });

// مصادقة + صلاحيات حسب الدور (RBAC)
const auth = (...roles) => (req, res, next) => {
  try {
    req.user = jwt.verify((req.headers.authorization || '').replace('Bearer ', ''), SECRET);
  } catch { return res.status(401).json({ error: 'غير مصرح' }); }
  if (roles.length && !roles.includes(req.user.role))
    return res.status(403).json({ error: 'لا تملك الصلاحية' });
  next();
};

const STAFF = ['technician', 'engineer', 'manager', 'admin'];
const TRANSITIONS = {
  new: ['assigned', 'in_progress', 'rejected'],
  assigned: ['in_progress', 'rejected'],
  in_progress: ['resolved'],
  resolved: ['closed', 'in_progress'],
};

// ---- تسجيل الدخول ----
app.post('/auth/login', wrap(async (req, res) => {
  const { username, password } = req.body;
  const { rows } = await pool.query('SELECT * FROM users WHERE username=$1 AND active', [username]);
  const u = rows[0];
  if (!u || !(await bcrypt.compare(password || '', u.password_hash)))
    return res.status(401).json({ error: 'بيانات الدخول غير صحيحة' });
  const token = jwt.sign({ id: u.id, role: u.role, name: u.full_name }, SECRET, { expiresIn: '12h' });
  res.json({ token, user: { id: u.id, name: u.full_name, role: u.role, department_id: u.department_id } });
}));

// ---- إدارة المستخدمين (للمدير فقط) ----
app.post('/users', auth('admin'), wrap(async (req, res) => {
  const { full_name, username, password, role, department_id, phone } = req.body;
  const hash = await bcrypt.hash(password, 10);
  const { rows } = await pool.query(
    `INSERT INTO users(full_name,username,password_hash,role,department_id,phone)
     VALUES($1,$2,$3,$4,$5,$6) RETURNING id,full_name,username,role`,
    [full_name, username, hash, role || 'reporter', department_id, phone]);
  res.status(201).json(rows[0]);
}));

app.get('/users/technicians', auth(...STAFF), wrap(async (_req, res) => {
  const { rows } = await pool.query(
    `SELECT id, full_name, role FROM users WHERE role IN ('technician','engineer') AND active ORDER BY full_name`);
  res.json(rows);
}));

// ---- بيانات مرجعية ----
app.get('/departments', auth(), wrap(async (_req, res) =>
  res.json((await pool.query('SELECT * FROM departments ORDER BY name')).rows)));

app.get('/devices', auth(), wrap(async (req, res) => {
  const { department_id } = req.query;
  const { rows } = await pool.query(
    'SELECT * FROM devices WHERE ($1::int IS NULL OR department_id=$1) ORDER BY name', [department_id || null]);
  res.json(rows);
}));

app.post('/devices', auth('engineer', 'manager', 'admin'), wrap(async (req, res) => {
  const { name, asset_tag, category, department_id, location } = req.body;
  const { rows } = await pool.query(
    `INSERT INTO devices(name,asset_tag,category,department_id,location) VALUES($1,$2,$3,$4,$5) RETURNING *`,
    [name, asset_tag, category, department_id, location]);
  res.status(201).json(rows[0]);
}));

// ---- البلاغات ----
app.post('/tickets', auth(), wrap(async (req, res) => {
  const { title, description, department_id, device_id, priority } = req.body;
  if (!title || !department_id) return res.status(400).json({ error: 'العنوان والقسم مطلوبان' });
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const { rows } = await client.query(
      `INSERT INTO tickets(title,description,department_id,device_id,reporter_id,priority)
       VALUES($1,$2,$3,$4,$5,COALESCE($6,'medium')) RETURNING *`,
      [title, description, department_id, device_id || null, req.user.id, priority]);
    await client.query(
      `INSERT INTO ticket_events(ticket_id,user_id,action,to_status) VALUES($1,$2,'created','new')`,
      [rows[0].id, req.user.id]);
    await client.query('COMMIT');
    res.status(201).json(rows[0]);
  } catch (e) { await client.query('ROLLBACK'); throw e; } finally { client.release(); }
}));

app.get('/tickets', auth(), wrap(async (req, res) => {
  const { status, department_id, priority } = req.query;
  const mine = STAFF.includes(req.user.role) ? null : req.user.id; // الموظف يرى بلاغاته فقط
  const { rows } = await pool.query(
    `SELECT t.*, d.name AS department, u.full_name AS reporter, a.full_name AS assignee, dv.name AS device
     FROM tickets t
     JOIN departments d ON d.id=t.department_id
     JOIN users u ON u.id=t.reporter_id
     LEFT JOIN users a ON a.id=t.assignee_id
     LEFT JOIN devices dv ON dv.id=t.device_id
     WHERE ($1::int IS NULL OR t.reporter_id=$1)
       AND ($2::ticket_status IS NULL OR t.status=$2)
       AND ($3::int IS NULL OR t.department_id=$3)
       AND ($4::ticket_priority IS NULL OR t.priority=$4)
     ORDER BY CASE t.priority WHEN 'critical' THEN 0 WHEN 'high' THEN 1 WHEN 'medium' THEN 2 ELSE 3 END,
              t.created_at DESC LIMIT 200`,
    [mine, status || null, department_id || null, priority || null]);
  res.json(rows);
}));

app.get('/tickets/:id', auth(), wrap(async (req, res) => {
  const t = (await pool.query('SELECT * FROM tickets WHERE id=$1', [req.params.id])).rows[0];
  if (!t) return res.status(404).json({ error: 'البلاغ غير موجود' });
  if (!STAFF.includes(req.user.role) && t.reporter_id !== req.user.id)
    return res.status(403).json({ error: 'لا تملك الصلاحية' });
  const events = (await pool.query(
    `SELECT e.*, u.full_name FROM ticket_events e LEFT JOIN users u ON u.id=e.user_id
     WHERE ticket_id=$1 ORDER BY e.created_at`, [t.id])).rows;
  res.json({ ...t, events });
}));

// إسناد البلاغ لفني
app.patch('/tickets/:id/assign', auth('engineer', 'manager', 'admin'), wrap(async (req, res) => {
  const { assignee_id } = req.body;
  const { rows } = await pool.query(
    `UPDATE tickets SET assignee_id=$1, status=CASE WHEN status='new' THEN 'assigned' ELSE status END
     WHERE id=$2 AND status NOT IN ('closed','rejected') RETURNING *`, [assignee_id, req.params.id]);
  if (!rows[0]) return res.status(404).json({ error: 'لا يمكن إسناد هذا البلاغ' });
  await pool.query(
    `INSERT INTO ticket_events(ticket_id,user_id,action,note) VALUES($1,$2,'assigned',$3)`,
    [req.params.id, req.user.id, `أُسند إلى المستخدم رقم ${assignee_id}`]);
  res.json(rows[0]);
}));

// تغيير الحالة
app.patch('/tickets/:id/status', auth(...STAFF), wrap(async (req, res) => {
  const { status, note } = req.body;
  const t = (await pool.query('SELECT * FROM tickets WHERE id=$1', [req.params.id])).rows[0];
  if (!t) return res.status(404).json({ error: 'البلاغ غير موجود' });
  if (!(TRANSITIONS[t.status] || []).includes(status))
    return res.status(400).json({ error: `انتقال غير مسموح من ${t.status} إلى ${status}` });
  const { rows } = await pool.query(
    `UPDATE tickets SET status=$1,
       resolved_at = CASE WHEN $1='resolved' THEN now() WHEN $1='in_progress' THEN NULL ELSE resolved_at END,
       assignee_id = COALESCE(assignee_id, $3)
     WHERE id=$2 RETURNING *`, [status, t.id, req.user.id]);
  await pool.query(
    `INSERT INTO ticket_events(ticket_id,user_id,action,from_status,to_status,note)
     VALUES($1,$2,'status_changed',$3,$4,$5)`, [t.id, req.user.id, t.status, status, note || null]);
  res.json(rows[0]);
}));

app.post('/tickets/:id/comments', auth(), wrap(async (req, res) => {
  await pool.query(
    `INSERT INTO ticket_events(ticket_id,user_id,action,note) VALUES($1,$2,'comment',$3)`,
    [req.params.id, req.user.id, req.body.note]);
  res.status(201).json({ ok: true });
}));

// ---- مؤشرات الأداء KPIs ----
app.get('/stats/kpi', auth('manager', 'engineer', 'admin'), wrap(async (_req, res) => {
  const byStatus = (await pool.query('SELECT status, COUNT(*)::int AS n FROM tickets GROUP BY status')).rows;
  const mttr = (await pool.query(
    `SELECT ROUND(AVG(EXTRACT(EPOCH FROM (resolved_at-created_at))/3600)::numeric,2) AS mttr_hours
     FROM tickets WHERE resolved_at IS NOT NULL`)).rows[0];
  const byDept = (await pool.query(
    `SELECT d.name, COUNT(*)::int AS tickets,
       ROUND(AVG(EXTRACT(EPOCH FROM (t.resolved_at-t.created_at))/3600)::numeric,2) AS mttr_hours
     FROM tickets t JOIN departments d ON d.id=t.department_id GROUP BY d.name ORDER BY tickets DESC`)).rows;
  res.json({ byStatus, mttr_hours: mttr.mttr_hours, byDept });
}));

app.get('/health', (_req, res) => res.json({ ok: true }));

const port = process.env.PORT || 3000;
app.listen(port, () => console.log(`الخادم يعمل على المنفذ ${port}`));
