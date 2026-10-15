// إنشاء حساب مدير أولي:  node seed.js admin كلمة_المرور
require('dotenv').config();
const { Pool } = require('pg');
const bcrypt = require('bcryptjs');
(async () => {
  const [username = 'admin', password] = process.argv.slice(2);
  if (!password) { console.error('الاستخدام: node seed.js <username> <password>'); process.exit(1); }
  const pool = new Pool({ connectionString: process.env.DATABASE_URL });
  await pool.query(
    `INSERT INTO users(full_name,username,password_hash,role) VALUES('مدير النظام',$1,$2,'admin')
     ON CONFLICT (username) DO NOTHING`, [username, await bcrypt.hash(password, 10)]);
  console.log('تم إنشاء المدير:', username);
  await pool.end();
})();
