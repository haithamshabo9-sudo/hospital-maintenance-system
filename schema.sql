-- منصة البلاغات الهندسية والصيانة الذكية - PostgreSQL
CREATE TYPE user_role AS ENUM ('reporter','technician','engineer','manager','admin');
CREATE TYPE ticket_status AS ENUM ('new','assigned','in_progress','resolved','closed','rejected');
CREATE TYPE ticket_priority AS ENUM ('low','medium','high','critical');

CREATE TABLE departments (
  id SERIAL PRIMARY KEY,
  name TEXT NOT NULL UNIQUE,
  floor TEXT
);

CREATE TABLE users (
  id SERIAL PRIMARY KEY,
  full_name TEXT NOT NULL,
  username TEXT NOT NULL UNIQUE,
  password_hash TEXT NOT NULL,
  role user_role NOT NULL DEFAULT 'reporter',
  department_id INT REFERENCES departments(id),
  phone TEXT,
  active BOOLEAN NOT NULL DEFAULT TRUE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE devices (
  id SERIAL PRIMARY KEY,
  name TEXT NOT NULL,
  asset_tag TEXT UNIQUE,
  category TEXT,               -- طبي / معلوماتي / كهربائي ...
  department_id INT REFERENCES departments(id),
  location TEXT
);

CREATE TABLE tickets (
  id SERIAL PRIMARY KEY,
  title TEXT NOT NULL,
  description TEXT,
  department_id INT NOT NULL REFERENCES departments(id),
  device_id INT REFERENCES devices(id),
  reporter_id INT NOT NULL REFERENCES users(id),
  assignee_id INT REFERENCES users(id),
  priority ticket_priority NOT NULL DEFAULT 'medium',
  status ticket_status NOT NULL DEFAULT 'new',
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  resolved_at TIMESTAMPTZ
);
CREATE INDEX idx_tickets_status ON tickets(status);
CREATE INDEX idx_tickets_dept ON tickets(department_id);
CREATE INDEX idx_tickets_assignee ON tickets(assignee_id);

CREATE TABLE ticket_events (
  id SERIAL PRIMARY KEY,
  ticket_id INT NOT NULL REFERENCES tickets(id) ON DELETE CASCADE,
  user_id INT REFERENCES users(id),
  action TEXT NOT NULL,        -- created / assigned / status_changed / comment
  from_status ticket_status,
  to_status ticket_status,
  note TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE attachments (
  id SERIAL PRIMARY KEY,
  ticket_id INT NOT NULL REFERENCES tickets(id) ON DELETE CASCADE,
  file_path TEXT NOT NULL,
  uploaded_by INT REFERENCES users(id),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

INSERT INTO departments(name) VALUES
 ('الإسعاف'),('العناية المشددة'),('الجراحة'),('المخبر'),('الأشعة'),('المعلوماتية');
