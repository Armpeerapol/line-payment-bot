require('dotenv').config();
const express = require('express');
const line = require('@line/bot-sdk');
const supabase = require('./supabase');
const msg = require('./messages');
const path = require('path');
const axios = require('axios');

const app = express();

const lineConfig = {
  channelAccessToken: process.env.LINE_CHANNEL_ACCESS_TOKEN,
  channelSecret: process.env.LINE_CHANNEL_SECRET
};

const client = new line.messagingApi.MessagingApiClient({
  channelAccessToken: process.env.LINE_CHANNEL_ACCESS_TOKEN
});

const blobClient = new line.messagingApi.MessagingApiBlobClient({
  channelAccessToken: process.env.LINE_CHANNEL_ACCESS_TOKEN
});

// ============================================
// LINE Webhook
// ============================================
app.post('/webhook',
  line.middleware(lineConfig),
  async (req, res) => {
    res.sendStatus(200);
    const events = req.body.events;
    await Promise.all(events.map(handleEvent));
  }
);

async function handleEvent(event) {
  const userId = event.source.userId;

  try {
    // Follow event — ต้อนรับ
    if (event.type === 'follow') {
      return client.replyMessage({
        replyToken: event.replyToken,
        messages: [
          {
            type: 'text',
            text: '👋 ยินดีต้อนรับสู่ระบบแจ้งชำระเงินสภานักเรียน!\n\nกดปุ่มด้านล่างเพื่อเริ่มต้น 👇'
          },
          msg.mainMenu()
        ]
      });
    }

    // Text message
    if (event.type === 'message' && event.message.type === 'text') {
      const text = event.message.text.trim();

      if (text === 'เมนู' || text === 'menu' || text === 'หน้าหลัก') {
        return client.replyMessage({
          replyToken: event.replyToken,
          messages: [msg.mainMenu()]
        });
      }

      // รอรับสลิป? (state = waiting_slip)
      const session = await getSession(userId);
      if (session?.state === 'waiting_slip') {
        return client.replyMessage({
          replyToken: event.replyToken,
          messages: [{ type: 'text', text: '📸 กรุณาส่งรูปภาพสลิปการโอนเงินนะคะ' }]
        });
      }

      return client.replyMessage({
        replyToken: event.replyToken,
        messages: [
          { type: 'text', text: 'พิมพ์ "เมนู" หรือกดปุ่มด้านล่างเพื่อใช้งาน 👇' },
          msg.mainMenu()
        ]
      });
    }

    // Image message — รับสลิป
    if (event.type === 'message' && event.message.type === 'image') {
      return await handleSlipUpload(event, userId);
    }

    // Postback
    if (event.type === 'postback') {
      return await handlePostback(event, userId);
    }

  } catch (err) {
    console.error('Event error:', err);
  }
}

// ============================================
// Postback Handler
// ============================================
async function handlePostback(event, userId) {
  const params = new URLSearchParams(event.postback.data);
  const action = params.get('action');

  switch (action) {

    case 'select_topic': {
      // ดึงหัวข้อทั้งหมด
      const { data: topics } = await supabase
        .from('payment_topics')
        .select('*')
        .eq('is_active', true)
        .order('created_at', { ascending: false });

      return client.replyMessage({
        replyToken: event.replyToken,
        messages: [
          { type: 'text', text: '📋 เลือกหัวข้อการชำระเงิน' },
          msg.topicSelector(topics || [])
        ]
      });
    }

    case 'select_topic_id': {
      const topicId = params.get('topic_id');

      // ดึงข้อมูลหัวข้อจาก DB (แทนที่จะรับจาก postback เพื่อป้องกัน data เกิน 300 ตัว)
      const { data: topic } = await supabase
        .from('payment_topics')
        .select('id, title')
        .eq('id', topicId)
        .single();

      const topicName = topic?.title || '';

      // ดึงรายชื่อนักเรียน
      const { data: students } = await supabase
        .from('students')
        .select('id, name, nickname')
        .eq('is_active', true)
        .order('name');

      await updateSession(userId, {
        state: 'selecting_student',
        selected_topic_id: topicId
      });

      return client.replyMessage({
        replyToken: event.replyToken,
        messages: [msg.studentSelector(students || [], topicId, topicName)]
      });
    }

    case 'select_student': {
      const studentId = params.get('student_id');
      const topicId = params.get('topic_id');

      // ดึงข้อมูลนักเรียนและหัวข้อจาก DB
      const { data: studentData } = await supabase
        .from('students')
        .select('id, name')
        .eq('id', studentId)
        .single();

      const studentName = studentData?.name || '';

      // ดึงข้อมูลหัวข้อ
      const { data: topic } = await supabase
        .from('payment_topics')
        .select('*')
        .eq('id', topicId)
        .single();

      // ตรวจว่าจ่ายแล้วหรือยัง
      const { data: existing } = await supabase
        .from('payments')
        .select('id, status')
        .eq('student_id', studentId)
        .eq('topic_id', topicId)
        .maybeSingle();

      if (existing) {
        const statusMsg = {
          pending: '⏳ คุณได้ส่งสลิปไว้แล้ว รอการตรวจสอบ',
          approved: '✅ ชำระเงินสำเร็จแล้ว ไม่ต้องส่งซ้ำ',
          rejected: '❌ สลิปถูกปฏิเสธ กรุณาส่งสลิปใหม่'
        };

        if (existing.status !== 'rejected') {
          return client.replyMessage({
            replyToken: event.replyToken,
            messages: [{ type: 'text', text: statusMsg[existing.status] }]
          });
        }
      }

      // บันทึก session
      await updateSession(userId, {
        state: 'waiting_slip',
        selected_topic_id: topicId,
        student_id: studentId
      });

      // Upsert student's line_user_id
      await supabase
        .from('students')
        .update({ line_user_id: userId })
        .eq('id', studentId);

      return client.replyMessage({
        replyToken: event.replyToken,
        messages: [msg.confirmPayment(studentName, topic?.title || '', topic?.amount)]
      });
    }

    case 'my_status': {
      // หานักเรียนจาก LINE user ID
      const { data: student } = await supabase
        .from('students')
        .select('id, name')
        .eq('line_user_id', userId)
        .maybeSingle();

      if (!student) {
        return client.replyMessage({
          replyToken: event.replyToken,
          messages: [{
            type: 'text',
            text: '❓ ยังไม่มีข้อมูลของคุณในระบบ\nกรุณาแจ้งชำระเงินก่อนเพื่อลงทะเบียนชื่อ'
          }]
        });
      }

      const { data: payments } = await supabase
        .from('payment_summary')
        .select('*')
        .eq('student_id', student.id);

      return client.replyMessage({
        replyToken: event.replyToken,
        messages: [msg.myStatusMessage(student.name, payments || [])]
      });
    }

    case 'cancel': {
      await updateSession(userId, { state: 'idle', selected_topic_id: null, student_id: null });
      return client.replyMessage({
        replyToken: event.replyToken,
        messages: [
          { type: 'text', text: '✖️ ยกเลิกแล้ว' },
          msg.mainMenu()
        ]
      });
    }
  }
}

// ============================================
// Slip Upload Handler
// ============================================
async function handleSlipUpload(event, userId) {
  const session = await getSession(userId);

  if (!session || session.state !== 'waiting_slip' || !session.student_id) {
    return client.replyMessage({
      replyToken: event.replyToken,
      messages: [{ type: 'text', text: 'กรุณาเลือกหัวข้อและชื่อก่อนส่งสลิปนะคะ' }, msg.mainMenu()]
    });
  }

  try {
    // ดาวน์โหลดรูปจาก LINE
    const stream = await blobClient.getMessageContent(event.message.id);
    const chunks = [];
    for await (const chunk of stream) chunks.push(chunk);
    const buffer = Buffer.concat(chunks);

    // อัพโหลดไป Supabase Storage
    const fileName = `slips/${session.student_id}_${session.selected_topic_id}_${Date.now()}.jpg`;
    const { data: uploadData, error: uploadError } = await supabase.storage
      .from('payment-slips')
      .upload(fileName, buffer, { contentType: 'image/jpeg', upsert: true });

    if (uploadError) throw uploadError;

    const { data: urlData } = supabase.storage
      .from('payment-slips')
      .getPublicUrl(fileName);

    const slipUrl = urlData.publicUrl;

    // ดึงข้อมูลนักเรียนและหัวข้อ
    const { data: student } = await supabase.from('students').select('name').eq('id', session.student_id).single();
    const { data: topic } = await supabase.from('payment_topics').select('title').eq('id', session.selected_topic_id).single();

    // บันทึก/อัพเดต payment
    const { error: paymentError } = await supabase
      .from('payments')
      .upsert({
        student_id: session.student_id,
        topic_id: session.selected_topic_id,
        slip_url: slipUrl,
        slip_message_id: event.message.id,
        status: 'pending',
        submitted_at: new Date().toISOString()
      }, { onConflict: 'student_id,topic_id' });

    if (paymentError) throw paymentError;

    // Reset session
    await updateSession(userId, { state: 'idle', selected_topic_id: null, student_id: null });

    return client.replyMessage({
      replyToken: event.replyToken,
      messages: [msg.successMessage(student?.name || '', topic?.title || '')]
    });

  } catch (err) {
    console.error('Slip upload error:', err);
    return client.replyMessage({
      replyToken: event.replyToken,
      messages: [{ type: 'text', text: '❌ เกิดข้อผิดพลาดในการส่งสลิป กรุณาลองใหม่อีกครั้ง' }]
    });
  }
}

// ============================================
// Session Helpers
// ============================================
async function getSession(userId) {
  const { data } = await supabase
    .from('line_sessions')
    .select('*')
    .eq('line_user_id', userId)
    .maybeSingle();
  return data;
}

async function updateSession(userId, updates) {
  await supabase
    .from('line_sessions')
    .upsert({
      line_user_id: userId,
      ...updates,
      updated_at: new Date().toISOString()
    }, { onConflict: 'line_user_id' });
}

// ============================================
// Admin API Routes
// ============================================

// Middleware ตรวจ Admin Password
function adminAuth(req, res, next) {
  const auth = req.headers['x-admin-key'];
  if (auth !== process.env.ADMIN_SECRET_KEY) {
    return res.status(401).json({ error: 'Unauthorized' });
  }
  next();
}

app.use(express.json());

// เพิ่มนักเรียน
app.post('/admin/students', adminAuth, async (req, res) => {
  const { name, nickname } = req.body;
  const { data, error } = await supabase.from('students').insert({ name, nickname }).select().single();
  if (error) return res.status(400).json({ error });
  res.json(data);
});

// เพิ่มหัวข้อ
app.post('/admin/topics', adminAuth, async (req, res) => {
  const { title, amount, due_date, description } = req.body;
  const { data, error } = await supabase.from('payment_topics').insert({ title, amount, due_date, description }).select().single();
  if (error) return res.status(400).json({ error });
  res.json(data);
});

// Dashboard data
app.get('/admin/dashboard', adminAuth, async (req, res) => {
  const { topic_id } = req.query;
  let query = supabase.from('payment_summary').select('*');
  if (topic_id) query = query.eq('topic_id', topic_id);
  const { data, error } = await query;
  if (error) return res.status(400).json({ error });
  res.json(data);
});

// ลบนักเรียน
app.delete('/admin/students/:id', adminAuth, async (req, res) => {
  const { error } = await supabase.from('students').delete().eq('id', req.params.id);
  if (error) return res.status(400).json({ error });
  res.json({ success: true });
});

// ลบหัวข้อ
app.delete('/admin/topics/:id', adminAuth, async (req, res) => {
  const { error } = await supabase.from('payment_topics').delete().eq('id', req.params.id);
  if (error) return res.status(400).json({ error });
  res.json({ success: true });
});

// ดึงรายชื่อนักเรียนทั้งหมด
app.get('/admin/students', adminAuth, async (req, res) => {
  const { data, error } = await supabase.from('students').select('*').eq('is_active', true).order('name');
  if (error) return res.status(400).json({ error });
  res.json(data);
});

// ดึงหัวข้อทั้งหมด
app.get('/admin/topics', adminAuth, async (req, res) => {
  const { data, error } = await supabase.from('payment_topics').select('*').eq('is_active', true).order('created_at', { ascending: false });
  if (error) return res.status(400).json({ error });
  res.json(data);
});

// อนุมัติ/ปฏิเสธสลิป
app.patch('/admin/payments/:id', adminAuth, async (req, res) => {
  const { status, note } = req.body;
  const { data, error } = await supabase
    .from('payments')
    .update({ status, note, reviewed_at: new Date().toISOString() })
    .eq('id', req.params.id)
    .select()
    .single();
  if (error) return res.status(400).json({ error });
  res.json(data);
});

// Serve Dashboard
app.use(express.static(path.join(__dirname, '../dashboard')));

// Health check
app.get('/health', (req, res) => res.json({ status: 'ok' }));

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`🚀 LINE Bot server running on port ${PORT}`);
});
