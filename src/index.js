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
            text: '👋 ยินดีต้อนรับสู่ระบบแจ้งชำระเงินสภานักเรียน!\n\nกดปุ่มด้านล่างเพื่อเริ่มต้นได้เลยค่ะ 👇'
          },
          msg.mainMenu()
        ]
      });
    }

    // Text message
    if (event.type === 'message' && event.message.type === 'text') {
      const text = event.message.text.trim();

      // ข้อความจาก Rich Menu — เช็คก่อนเลย ไม่สนใจ session
      if (text === 'แจ้งชำระเงิน') {
        await updateSession(userId, { state: 'idle', selected_topic_id: null, student_id: null });
        return await handlePostback(
          { ...event, postback: { data: 'action=select_topic' } },
          userId
        );
      }

      if (text === 'สถานะ' || text === 'ตรวจสอบสถานะ' || text === 'เช็คสถานะ' || text === 'ดูสถานะ') {
        return await handlePostback(
          { ...event, postback: { data: 'action=my_status' } },
          userId
        );
      }

      // รอรับสลิป? (state = waiting_slip)
      const session = await getSession(userId);
      if (session?.state === 'waiting_slip') {
        return client.replyMessage({
          replyToken: event.replyToken,
          messages: [{ type: 'text', text: '📸 กรุณาส่งรูปภาพสลิปการโอนเงินนะคะ' }]
        });
      }

      // ทุก text message อื่น → แสดงเมนูเสมอ
      return client.replyMessage({
        replyToken: event.replyToken,
        messages: [msg.mainMenu()]
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

      // ดึง student_id ของ user นี้
      const { data: myStudent } = await supabase
        .from('students')
        .select('id')
        .eq('line_user_id', userId)
        .maybeSingle();

      let availableTopics = topics || [];

      if (myStudent) {
        // ดึงหัวข้อที่ user นี้จ่ายแล้ว (pending หรือ approved)
        const { data: myPayments } = await supabase
          .from('payments')
          .select('topic_id, status')
          .eq('student_id', myStudent.id)
          .in('status', ['pending', 'approved']);

        const paidTopicIds = new Set((myPayments || []).map(p => p.topic_id));
        availableTopics = availableTopics.filter(t => !paidTopicIds.has(t.id));
      }

      if (availableTopics.length === 0) {
        return client.replyMessage({
          replyToken: event.replyToken,
          messages: [{ type: 'text', text: '✅ คุณได้ชำระเงินทุกหัวข้อครบแล้ว!' }]
        });
      }

      return client.replyMessage({
        replyToken: event.replyToken,
        messages: [
          { type: 'text', text: '📋 เลือกหัวข้อการชำระเงิน' },
          msg.topicSelector(availableTopics)
        ]
      });
    }

    case 'select_topic_id': {
      const topicId = params.get('topic_id');

      // ดึงข้อมูลหัวข้อจาก DB
      const { data: topic } = await supabase
        .from('payment_topics')
        .select('id, title')
        .eq('id', topicId)
        .single();

      const topicName = topic?.title || '';

      // ดึงรายชื่อนักเรียนทั้งหมด
      const { data: allStudents } = await supabase
        .from('students')
        .select('id, name, nickname')
        .eq('is_active', true)
        .order('name');

      // ดึง payments ที่ pending หรือ approved แล้ว (ไม่ต้องแสดงในรายชื่อ)
      const { data: paidPayments } = await supabase
        .from('payments')
        .select('student_id, status')
        .eq('topic_id', topicId)
        .in('status', ['pending', 'approved']);

      const paidIds = new Set((paidPayments || []).map(p => p.student_id));

      // แสดงเฉพาะคนที่ยังไม่จ่าย หรือถูกปฏิเสธ
      const students = (allStudents || []).filter(s => !paidIds.has(s.id));

      if (students.length === 0) {
        return client.replyMessage({
          replyToken: event.replyToken,
          messages: [{ type: 'text', text: `✅ ทุกคนได้ชำระเงินหัวข้อ "${topicName}" ครบแล้ว!` }]
        });
      }

      await updateSession(userId, {
        state: 'selecting_student',
        selected_topic_id: topicId
      });

      return client.replyMessage({
        replyToken: event.replyToken,
        messages: [msg.studentSelector(students, topicId, topicName)]
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

// เพิ่มหัวข้อ + แจ้งเตือนนักเรียนทันที
app.post('/admin/topics', adminAuth, async (req, res) => {
  const { title, amount, due_date, description } = req.body;
  const { data, error } = await supabase.from('payment_topics').insert({ title, amount, due_date, description }).select().single();
  if (error) return res.status(400).json({ error });

  // ดึงนักเรียนทุกคนที่มี LINE
  const { data: students } = await supabase
    .from('students')
    .select('line_user_id, name')
    .eq('is_active', true)
    .not('line_user_id', 'is', null);

  if (students && students.length > 0) {
    const dueDateStr = due_date
      ? new Date(due_date).toLocaleDateString('th-TH', { year: 'numeric', month: 'long', day: 'numeric' })
      : null;
    const amountStr = amount ? Number(amount).toLocaleString('th-TH') : null;

    const notifyMsg = [
      {
        type: 'flex',
        altText: `📢 แจ้งเตือน: ${title}${amountStr ? ' · ' + amountStr + ' บาท' : ''}`,
        contents: {
          type: 'bubble',
          size: 'mega',
          header: {
            type: 'box',
            layout: 'vertical',
            contents: [
              {
                type: 'box',
                layout: 'horizontal',
                contents: [
                  {
                    type: 'box',
                    layout: 'vertical',
                    contents: [
                      {
                        type: 'text',
                        text: '📢 แจ้งเตือนใหม่',
                        color: '#ffffff99',
                        size: 'sm',
                        weight: 'bold'
                      },
                      {
                        type: 'text',
                        text: 'การชำระเงิน',
                        color: '#FFFFFF',
                        size: 'xxl',
                        weight: 'bold'
                      }
                    ],
                    flex: 1
                  },
                  {
                    type: 'text',
                    text: '🏫',
                    size: '3xl',
                    align: 'end',
                    gravity: 'center'
                  }
                ]
              }
            ],
            paddingAll: '24px',
            backgroundColor: '#1B5E20',
            background: {
              type: 'linearGradient',
              angle: '135deg',
              startColor: '#1B5E20',
              endColor: '#2E7D32'
            }
          },
          body: {
            type: 'box',
            layout: 'vertical',
            spacing: 'none',
            contents: [
              // ชื่อหัวข้อ
              {
                type: 'box',
                layout: 'vertical',
                contents: [
                  {
                    type: 'text',
                    text: 'หัวข้อ',
                    size: 'xs',
                    color: '#888888',
                    weight: 'bold',
                    margin: 'none'
                  },
                  {
                    type: 'text',
                    text: title,
                    size: 'xl',
                    weight: 'bold',
                    color: '#1B5E20',
                    wrap: true,
                    margin: 'sm'
                  }
                ],
                backgroundColor: '#F1F8E9',
                paddingAll: '18px',
                cornerRadius: '12px',
                margin: 'none'
              },
              // ข้อมูล
              {
                type: 'box',
                layout: 'vertical',
                spacing: 'sm',
                margin: 'lg',
                contents: [
                  amountStr ? {
                    type: 'box',
                    layout: 'horizontal',
                    contents: [
                      {
                        type: 'box',
                        layout: 'vertical',
                        contents: [{ type: 'text', text: '💰', size: 'lg', align: 'center' }],
                        backgroundColor: '#E8F5E9',
                        width: '44px',
                        height: '44px',
                        cornerRadius: '22px',
                        justifyContent: 'center',
                        alignItems: 'center'
                      },
                      {
                        type: 'box',
                        layout: 'vertical',
                        flex: 1,
                        paddingStart: '12px',
                        contents: [
                          { type: 'text', text: 'จำนวนเงิน', size: 'xs', color: '#888888' },
                          { type: 'text', text: `${amountStr} บาท`, size: 'lg', weight: 'bold', color: '#2E7D32' }
                        ]
                      }
                    ],
                    alignItems: 'center'
                  } : null,
                  dueDateStr ? {
                    type: 'box',
                    layout: 'horizontal',
                    contents: [
                      {
                        type: 'box',
                        layout: 'vertical',
                        contents: [{ type: 'text', text: '📅', size: 'lg', align: 'center' }],
                        backgroundColor: '#FFF3E0',
                        width: '44px',
                        height: '44px',
                        cornerRadius: '22px',
                        justifyContent: 'center',
                        alignItems: 'center'
                      },
                      {
                        type: 'box',
                        layout: 'vertical',
                        flex: 1,
                        paddingStart: '12px',
                        contents: [
                          { type: 'text', text: 'ครบกำหนด', size: 'xs', color: '#888888' },
                          { type: 'text', text: dueDateStr, size: 'md', weight: 'bold', color: '#E65100' }
                        ]
                      }
                    ],
                    alignItems: 'center'
                  } : null,
                  description ? {
                    type: 'box',
                    layout: 'horizontal',
                    contents: [
                      {
                        type: 'box',
                        layout: 'vertical',
                        contents: [{ type: 'text', text: '📝', size: 'lg', align: 'center' }],
                        backgroundColor: '#E3F2FD',
                        width: '44px',
                        height: '44px',
                        cornerRadius: '22px',
                        justifyContent: 'center',
                        alignItems: 'center'
                      },
                      {
                        type: 'box',
                        layout: 'vertical',
                        flex: 1,
                        paddingStart: '12px',
                        contents: [
                          { type: 'text', text: 'รายละเอียด', size: 'xs', color: '#888888' },
                          { type: 'text', text: description, size: 'sm', color: '#555555', wrap: true }
                        ]
                      }
                    ],
                    alignItems: 'center'
                  } : null
                ].filter(Boolean)
              },
              // divider
              { type: 'separator', margin: 'xl', color: '#EEEEEE' },
              {
                type: 'text',
                text: 'กดปุ่มด้านล่างเพื่อชำระเงินได้เลยนะคะ 👇',
                size: 'sm',
                color: '#888888',
                align: 'center',
                wrap: true,
                margin: 'lg'
              }
            ],
            paddingAll: '20px'
          },
          footer: {
            type: 'box',
            layout: 'vertical',
            spacing: 'sm',
            contents: [
              {
                type: 'button',
                style: 'primary',
                color: '#2E7D32',
                height: 'sm',
                action: {
                  type: 'message',
                  label: '💳 แจ้งชำระเงินเลย',
                  text: 'แจ้งชำระเงิน'
                }
              },
              {
                type: 'button',
                style: 'secondary',
                height: 'sm',
                action: {
                  type: 'message',
                  label: '📊 ดูสถานะการชำระ',
                  text: 'ตรวจสอบสถานะ'
                }
              }
            ],
            paddingAll: '16px'
          },
          styles: {
            footer: { separator: true }
          }
        }
      }
    ];

    let sent = 0;
    for (const s of students) {
      try {
        await client.pushMessage({ to: s.line_user_id, messages: notifyMsg });
        sent++;
      } catch (e) {
        console.error('Notify failed for', s.name, e.message);
      }
    }
    console.log(`Notified ${sent}/${students.length} students about new topic: ${title}`);
  }

  res.json({ ...data, notified: students?.length || 0 });
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

// ทวงเงิน — ส่งข้อความหาคนที่ยังไม่จ่ายในหัวข้อนั้น
app.post('/admin/remind/:topic_id', adminAuth, async (req, res) => {
  const { topic_id } = req.params;
  const { message } = req.body;

  const { data: topic } = await supabase
    .from('payment_topics')
    .select('title, amount, due_date')
    .eq('id', topic_id)
    .single();

  const { data: allStudents } = await supabase
    .from('students')
    .select('id, name, line_user_id')
    .eq('is_active', true)
    .not('line_user_id', 'is', null);

  const { data: paidPayments } = await supabase
    .from('payments')
    .select('student_id, status')
    .eq('topic_id', topic_id)
    .in('status', ['pending', 'approved']);

  const paidIds = new Set((paidPayments || []).map(p => p.student_id));
  const unpaidStudents = (allStudents || []).filter(s => !paidIds.has(s.id));

  if (unpaidStudents.length === 0) {
    return res.json({ success: true, sent: 0, message: 'ทุกคนจ่ายแล้ว' });
  }

  const defaultMsg = message ||
    `📢 แจ้งเตือนการชำระเงิน\n\nหัวข้อ: ${topic?.title || ''}\n${topic?.amount ? 'จำนวน: ' + Number(topic.amount).toLocaleString('th-TH') + ' บาท\n' : ''}${topic?.due_date ? 'ครบกำหนด: ' + new Date(topic.due_date).toLocaleDateString('th-TH') + '\n' : ''}\nกรุณาชำระเงินและส่งสลิปผ่านบอทนี้ด้วยนะคะ 🙏`;

  let sent = 0, failed = 0;

  for (const student of unpaidStudents) {
    try {
      await client.pushMessage({
        to: student.line_user_id,
        messages: [{ type: 'text', text: defaultMsg }]
      });
      sent++;
    } catch (e) {
      console.error('Push failed for ' + student.name + ':', e.message);
      failed++;
    }
  }

  res.json({ success: true, sent, failed, total: unpaidStudents.length });
});

// Serve Dashboard
app.use(express.static(path.join(__dirname, '../dashboard')));


// ============================================
// Rich Menu Setup (เมนูติดด้านล่างตลอด)
// ============================================
async function setupRichMenu() {
  try {
    // ลบ rich menu เก่าทั้งหมดก่อน
    const { richmenus } = await client.getRichMenuList().catch(() => ({ richmenus: [] }));
    for (const rm of (richmenus || [])) {
      await client.deleteRichMenu(rm.richMenuId).catch(() => {});
    }

    // สร้าง rich menu ใหม่
    const richMenuId = await client.createRichMenu({
      size: { width: 2500, height: 843 },
      selected: true,
      name: 'Main Menu',
      chatBarText: 'เมนู 📋',
      areas: [
        {
          bounds: { x: 0, y: 0, width: 1250, height: 843 },
          action: { type: 'postback', data: 'action=select_topic', label: 'แจ้งชำระเงิน' }
        },
        {
          bounds: { x: 1250, y: 0, width: 1250, height: 843 },
          action: { type: 'postback', data: 'action=my_status', label: 'ดูสถานะ' }
        }
      ]
    });

    // อัพโหลดรูป rich menu
    const { createCanvas } = require('canvas');
    const canvas = createCanvas(2500, 843);
    const ctx = canvas.getContext('2d');

    // พื้นหลัง
    ctx.fillStyle = '#1B5E20';
    ctx.fillRect(0, 0, 2500, 843);

    // เส้นแบ่งกลาง
    ctx.fillStyle = '#2E7D32';
    ctx.fillRect(1245, 0, 10, 843);

    // ปุ่มซ้าย — แจ้งชำระเงิน
    ctx.fillStyle = '#2E7D32';
    roundRect(ctx, 80, 120, 1090, 600, 40);
    ctx.fill();

    // ปุ่มขวา — ดูสถานะ
    ctx.fillStyle = '#1565C0';
    roundRect(ctx, 1330, 120, 1090, 600, 40);
    ctx.fill();

    // ข้อความ
    ctx.fillStyle = '#FFFFFF';
    ctx.textAlign = 'center';
    ctx.font = 'bold 120px sans-serif';
    ctx.fillText('💳', 625, 380);
    ctx.font = 'bold 80px sans-serif';
    ctx.fillText('แจ้งชำระเงิน', 625, 580);

    ctx.fillText('📊', 1875, 380);
    ctx.fillText('ดูสถานะ', 1875, 580);

    const imageBuffer = canvas.toBuffer('image/png');

    await client.setRichMenuImage(richMenuId, imageBuffer, 'image/png');
    await client.setDefaultRichMenu(richMenuId);

    console.log('✅ Rich menu created:', richMenuId);
  } catch (err) {
    // canvas อาจไม่มี — ใช้แบบไม่มีรูปแทน (chatBarText ยังทำงานได้)
    console.log('ℹ️ Rich menu image skipped (canvas not available), text-only mode');
    try {
      const richMenuId = await client.createRichMenu({
        size: { width: 2500, height: 843 },
        selected: true,
        name: 'Main Menu',
        chatBarText: '📋 แตะเพื่อเปิดเมนู',
        areas: [
          {
            bounds: { x: 0, y: 0, width: 1250, height: 843 },
            action: { type: 'postback', data: 'action=select_topic', label: 'แจ้งชำระเงิน' }
          },
          {
            bounds: { x: 1250, y: 0, width: 1250, height: 843 },
            action: { type: 'postback', data: 'action=my_status', label: 'ดูสถานะ' }
          }
        ]
      });
      await client.setDefaultRichMenu(richMenuId);
      console.log('✅ Rich menu (text-only) created:', richMenuId);
    } catch (e2) {
      console.error('Rich menu failed:', e2.message);
    }
  }
}

function roundRect(ctx, x, y, w, h, r) {
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.lineTo(x + w - r, y);
  ctx.quadraticCurveTo(x + w, y, x + w, y + r);
  ctx.lineTo(x + w, y + h - r);
  ctx.quadraticCurveTo(x + w, y + h, x + w - r, y + h);
  ctx.lineTo(x + r, y + h);
  ctx.quadraticCurveTo(x, y + h, x, y + h - r);
  ctx.lineTo(x, y + r);
  ctx.quadraticCurveTo(x, y, x + r, y);
  ctx.closePath();
}

// Health check
app.get('/health', (req, res) => res.json({ status: 'ok' }));

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`🚀 LINE Bot server running on port ${PORT}`);
  setupRichMenu();
});
