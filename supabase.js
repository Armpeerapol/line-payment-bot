-- ============================================
-- สภานักเรียน LINE Bot - Supabase Schema
-- ============================================

-- ตารางรายชื่อนักเรียน (เพิ่มโดยแอดมิน)
CREATE TABLE students (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  name TEXT NOT NULL,
  nickname TEXT,
  line_user_id TEXT UNIQUE,
  is_active BOOLEAN DEFAULT true,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- ตารางหัวข้อการจ่ายเงิน (เพิ่มโดยแอดมิน)
CREATE TABLE payment_topics (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  title TEXT NOT NULL,
  amount NUMERIC(10,2),
  due_date DATE,
  description TEXT,
  is_active BOOLEAN DEFAULT true,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- ตารางบันทึกการจ่ายเงิน
CREATE TABLE payments (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  student_id UUID REFERENCES students(id) ON DELETE CASCADE,
  topic_id UUID REFERENCES payment_topics(id) ON DELETE CASCADE,
  slip_url TEXT,
  slip_message_id TEXT,
  status TEXT DEFAULT 'pending' CHECK (status IN ('pending', 'approved', 'rejected')),
  submitted_at TIMESTAMPTZ DEFAULT NOW(),
  reviewed_at TIMESTAMPTZ,
  reviewed_by TEXT,
  note TEXT,
  UNIQUE(student_id, topic_id)
);

-- ตาราง LINE Sessions (เก็บ state ของ bot)
CREATE TABLE line_sessions (
  line_user_id TEXT PRIMARY KEY,
  student_id UUID REFERENCES students(id),
  state TEXT DEFAULT 'idle',
  selected_topic_id UUID REFERENCES payment_topics(id),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- Enable RLS
ALTER TABLE students ENABLE ROW LEVEL SECURITY;
ALTER TABLE payment_topics ENABLE ROW LEVEL SECURITY;
ALTER TABLE payments ENABLE ROW LEVEL SECURITY;
ALTER TABLE line_sessions ENABLE ROW LEVEL SECURITY;

-- Allow all from service role (backend)
CREATE POLICY "service_role_all" ON students FOR ALL USING (true);
CREATE POLICY "service_role_all" ON payment_topics FOR ALL USING (true);
CREATE POLICY "service_role_all" ON payments FOR ALL USING (true);
CREATE POLICY "service_role_all" ON line_sessions FOR ALL USING (true);

-- Indexes
CREATE INDEX idx_payments_student ON payments(student_id);
CREATE INDEX idx_payments_topic ON payments(topic_id);
CREATE INDEX idx_payments_status ON payments(status);
CREATE INDEX idx_sessions_user ON line_sessions(line_user_id);

-- View สำหรับ Dashboard
CREATE VIEW payment_summary AS
SELECT
  pt.id AS topic_id,
  pt.title AS topic_title,
  pt.amount,
  pt.due_date,
  s.id AS student_id,
  s.name AS student_name,
  s.nickname,
  COALESCE(p.status, 'not_paid') AS status,
  p.slip_url,
  p.submitted_at,
  p.id AS payment_id
FROM payment_topics pt
CROSS JOIN students s
LEFT JOIN payments p ON p.topic_id = pt.id AND p.student_id = s.id
WHERE pt.is_active = true AND s.is_active = true
ORDER BY pt.created_at DESC, s.name ASC;
