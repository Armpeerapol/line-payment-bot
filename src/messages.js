// ============================================
// Flex Message Templates สำหรับ LINE Bot
// ============================================

/**
 * เมนูหลัก
 */
function mainMenu() {
  return {
    type: 'flex',
    altText: '📋 เมนูหลัก - ระบบจ่ายเงินสภานักเรียน',
    contents: {
      type: 'bubble',
      size: 'mega',
      header: {
        type: 'box',
        layout: 'vertical',
        contents: [
          {
            type: 'text',
            text: '🏫 สภานักเรียน',
            weight: 'bold',
            size: 'xl',
            color: '#FFFFFF'
          },
          {
            type: 'text',
            text: 'ระบบแจ้งชำระเงิน',
            size: 'sm',
            color: '#FFFFFF99'
          }
        ],
        backgroundColor: '#2E7D32',
        paddingAll: '20px'
      },
      body: {
        type: 'box',
        layout: 'vertical',
        spacing: 'md',
        contents: [
          {
            type: 'text',
            text: 'เลือกรายการที่ต้องการ',
            size: 'md',
            color: '#555555',
            margin: 'md'
          },
          {
            type: 'button',
            style: 'primary',
            color: '#2E7D32',
            action: {
              type: 'postback',
              label: '💳 แจ้งชำระเงิน',
              data: 'action=select_topic'
            },
            height: 'sm'
          },
          {
            type: 'button',
            style: 'secondary',
            action: {
              type: 'postback',
              label: '📊 ดูสถานะการชำระของฉัน',
              data: 'action=my_status'
            },
            height: 'sm'
          }
        ],
        paddingAll: '20px'
      }
    }
  };
}

/**
 * เลือกหัวข้อการจ่ายเงิน
 */
function topicSelector(topics) {
  if (topics.length === 0) {
    return {
      type: 'text',
      text: '❌ ยังไม่มีหัวข้อการชำระเงินในขณะนี้\nกรุณาติดต่อแอดมิน'
    };
  }

  const bubbles = topics.map(topic => ({
    type: 'bubble',
    size: 'kilo',
    body: {
      type: 'box',
      layout: 'vertical',
      spacing: 'sm',
      contents: [
        {
          type: 'text',
          text: topic.title,
          weight: 'bold',
          size: 'md',
          wrap: true
        },
        topic.amount ? {
          type: 'text',
          text: `💰 ${Number(topic.amount).toLocaleString('th-TH')} บาท`,
          size: 'sm',
          color: '#2E7D32'
        } : null,
        topic.due_date ? {
          type: 'text',
          text: `📅 ครบกำหนด: ${new Date(topic.due_date).toLocaleDateString('th-TH', {year:'numeric',month:'long',day:'numeric'})} เวลา ${new Date(topic.due_date).toLocaleTimeString('th-TH',{hour:'2-digit',minute:'2-digit'})} น.`,
          size: 'xs',
          color: '#888888',
          wrap: true
        } : null,
        topic.description ? {
          type: 'text',
          text: topic.description,
          size: 'xs',
          color: '#AAAAAA',
          wrap: true
        } : null
      ].filter(Boolean)
    },
    footer: {
      type: 'box',
      layout: 'vertical',
      contents: [
        {
          type: 'button',
          style: 'primary',
          color: '#2E7D32',
          action: {
            type: 'postback',
            label: 'เลือกหัวข้อนี้',
            data: `action=select_topic_id&topic_id=${topic.id}`
          },
          height: 'sm'
        }
      ]
    }
  }));

  return {
    type: 'flex',
    altText: '📋 เลือกหัวข้อการชำระเงิน',
    contents: {
      type: 'carousel',
      contents: bubbles
    }
  };
}

/**
 * เลือกชื่อนักเรียน — ใช้ Carousel รองรับได้ไม่จำกัด (max 10 bubble ต่อ carousel)
 */
function studentSelector(students, topicId, topicName) {
  if (students.length === 0) {
    return {
      type: 'text',
      text: '❌ ไม่พบรายชื่อนักเรียน กรุณาติดต่อแอดมิน'
    };
  }

  // แบ่งนักเรียนเป็นกลุ่มๆ ละ 5 คนต่อ bubble (max 12 bubble = 60 คน)
  const chunkSize = 5;
  const chunks = [];
  for (let i = 0; i < students.length; i += chunkSize) {
    chunks.push(students.slice(i, i + chunkSize));
  }

  const bubbles = chunks.slice(0, 12).map((group, idx) => ({
    type: 'bubble',
    size: 'kilo',
    header: {
      type: 'box',
      layout: 'vertical',
      contents: [{
        type: 'text',
        text: chunks.length > 1 ? `👥 รายชื่อ (${idx * chunkSize + 1}–${Math.min((idx + 1) * chunkSize, students.length)})` : '👥 เลือกชื่อของคุณ',
        size: 'xs',
        color: '#FFFFFF',
        weight: 'bold'
      }],
      backgroundColor: '#2E7D32',
      paddingAll: '10px'
    },
    body: {
      type: 'box',
      layout: 'vertical',
      spacing: 'sm',
      contents: group.map(s => ({
        type: 'button',
        style: 'secondary',
        height: 'sm',
        action: {
          type: 'postback',
          label: s.nickname ? `${s.nickname} (${s.name.split(' ')[0]})`.substring(0, 40) : s.name.substring(0, 40),
          data: `action=select_student&student_id=${s.id}&topic_id=${topicId}`
        }
      })),
      paddingAll: '12px'
    }
  }));

  return {
    type: 'flex',
    altText: `📝 เลือกชื่อของคุณ — หัวข้อ: ${topicName}`,
    contents: {
      type: 'carousel',
      contents: bubbles
    }
  };
}

/**
 * ยืนยันข้อมูลก่อนส่งสลิป + แสดงเลขบัญชี
 */
function confirmPayment(studentName, topicName, amount) {
  return {
    type: 'flex',
    altText: '📸 กรุณาส่งสลิปการโอนเงิน',
    contents: {
      type: 'bubble',
      header: {
        type: 'box',
        layout: 'vertical',
        contents: [
          { type: 'text', text: '✅ ยืนยันข้อมูลการชำระเงิน', weight: 'bold', color: '#FFFFFF', size: 'md' }
        ],
        backgroundColor: '#1565C0',
        paddingAll: '15px'
      },
      body: {
        type: 'box',
        layout: 'vertical',
        spacing: 'sm',
        contents: [
          // ข้อมูลผู้จ่าย
          {
            type: 'box', layout: 'horizontal',
            contents: [
              { type: 'text', text: '👤 ชื่อ', size: 'sm', color: '#888888', flex: 2 },
              { type: 'text', text: studentName, size: 'sm', weight: 'bold', flex: 5, wrap: true }
            ]
          },
          {
            type: 'box', layout: 'horizontal',
            contents: [
              { type: 'text', text: '📋 หัวข้อ', size: 'sm', color: '#888888', flex: 2 },
              { type: 'text', text: topicName, size: 'sm', weight: 'bold', flex: 5, wrap: true }
            ]
          },
          amount ? {
            type: 'box', layout: 'horizontal',
            contents: [
              { type: 'text', text: '💰 จำนวน', size: 'sm', color: '#888888', flex: 2 },
              { type: 'text', text: `${Number(amount).toLocaleString('th-TH')} บาท`, size: 'sm', weight: 'bold', color: '#2E7D32', flex: 5 }
            ]
          } : null,
          { type: 'separator', margin: 'md' },
          // บัญชีที่ต้องโอน
          {
            type: 'box', layout: 'vertical',
            backgroundColor: '#E8F5E9',
            cornerRadius: '10px',
            paddingAll: '14px',
            margin: 'md',
            contents: [
              { type: 'text', text: '🏦 บัญชีที่ต้องโอน', size: 'sm', weight: 'bold', color: '#1B5E20' },
              { type: 'separator', margin: 'sm', color: '#A5D6A7' },
              {
                type: 'box', layout: 'horizontal', margin: 'sm',
                contents: [
                  { type: 'text', text: 'ธนาคาร', size: 'xs', color: '#666666', flex: 3 },
                  { type: 'text', text: 'ออมสิน', size: 'sm', weight: 'bold', color: '#1B5E20', flex: 5 }
                ]
              },
              {
                type: 'box', layout: 'horizontal', margin: 'xs',
                contents: [
                  { type: 'text', text: 'เลขบัญชี', size: 'xs', color: '#666666', flex: 3 },
                  { type: 'text', text: '020-478218-462', size: 'sm', weight: 'bold', color: '#1B5E20', flex: 5 }
                ]
              }
            ]
          },
          { type: 'separator', margin: 'md' },
          { type: 'text', text: '📸 โอนแล้วส่งรูปสลิปมาในแชทนี้เลยนะคะ', size: 'sm', color: '#1565C0', weight: 'bold', wrap: true, margin: 'md' }
        ].filter(Boolean),
        paddingAll: '20px'
      },
      footer: {
        type: 'box', layout: 'vertical',
        contents: [
          {
            type: 'button', style: 'secondary', height: 'sm',
            action: { type: 'postback', label: '❌ ยกเลิก', data: 'action=cancel' }
          }
        ]
      }
    }
  };
}

/**
 * แจ้งผลการส่งสลิปสำเร็จ
 */
function successMessage(studentName, topicName) {
  return {
    type: 'flex',
    altText: '✅ ส่งสลิปเรียบร้อยแล้ว',
    contents: {
      type: 'bubble',
      body: {
        type: 'box',
        layout: 'vertical',
        spacing: 'md',
        contents: [
          {
            type: 'text',
            text: '✅',
            size: '5xl',
            align: 'center'
          },
          {
            type: 'text',
            text: 'ส่งสลิปเรียบร้อยแล้ว!',
            weight: 'bold',
            size: 'xl',
            align: 'center',
            color: '#2E7D32'
          },
          {
            type: 'text',
            text: `${studentName}\nหัวข้อ: ${topicName}`,
            size: 'sm',
            color: '#666666',
            align: 'center',
            wrap: true
          },
          {
            type: 'text',
            text: 'รอแอดมินตรวจสอบและอนุมัติ',
            size: 'xs',
            color: '#AAAAAA',
            align: 'center',
            wrap: true
          }
        ],
        paddingAll: '30px'
      }
    }
  };
}

/**
 * สถานะการชำระเงินของนักเรียน
 */
function myStatusMessage(studentName, payments) {
  if (payments.length === 0) {
    return {
      type: 'text',
      text: `📊 สถานะของ ${studentName}\n\nยังไม่มีรายการชำระเงิน`
    };
  }

  const statusEmoji = { pending: '⏳', approved: '✅', rejected: '❌', not_paid: '❌' };
  const statusText = { pending: 'รอตรวจสอบ', approved: 'อนุมัติแล้ว', rejected: 'ถูกปฏิเสธ', not_paid: 'ยังไม่ได้จ่าย' };

  const rows = payments.map(p => ({
    type: 'box',
    layout: 'horizontal',
    contents: [
      {
        type: 'text',
        text: `${statusEmoji[p.status]} ${p.topic_title}`,
        size: 'sm',
        flex: 4,
        wrap: true
      },
      {
        type: 'text',
        text: statusText[p.status],
        size: 'sm',
        flex: 3,
        align: 'end',
        color: p.status === 'approved' ? '#2E7D32' : p.status === 'rejected' ? '#C62828' : '#F57F17'
      }
    ],
    margin: 'sm'
  }));

  return {
    type: 'flex',
    altText: `📊 สถานะการชำระเงินของ ${studentName}`,
    contents: {
      type: 'bubble',
      header: {
        type: 'box',
        layout: 'vertical',
        contents: [
          {
            type: 'text',
            text: '📊 สถานะของฉัน',
            weight: 'bold',
            color: '#FFFFFF'
          },
          {
            type: 'text',
            text: studentName,
            size: 'sm',
            color: '#FFFFFF99'
          }
        ],
        backgroundColor: '#1565C0',
        paddingAll: '15px'
      },
      body: {
        type: 'box',
        layout: 'vertical',
        contents: rows,
        paddingAll: '15px',
        spacing: 'sm'
      }
    }
  };
}

module.exports = {
  mainMenu,
  topicSelector,
  studentSelector,
  confirmPayment,
  successMessage,
  myStatusMessage
};
