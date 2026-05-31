# 🏫 LINE Bot สภานักเรียน — ระบบแจ้งชำระเงิน

ระบบบอท LINE สำหรับจัดเก็บเงิน พร้อมแดชบอร์ดแอดมิน  
**Stack:** Node.js + Supabase + Render (ฟรีทั้งหมด)

---

## 📋 ฟีเจอร์

| ฟีเจอร์ | รายละเอียด |
|--------|-----------|
| 📋 เลือกหัวข้อ | แอดมินเพิ่มหัวข้อได้ไม่จำกัด |
| 👤 เลือกชื่อ | แสดงชื่อเล่นใน Quick Reply สะดวกกดบนมือถือ |
| 📸 ส่งสลิป | ส่งรูปในแชท LINE เก็บใน Supabase Storage |
| 📊 แดชบอร์ด | เห็นว่าใครจ่ายแล้ว/ยังไม่จ่าย/รอตรวจ |
| ✅ อนุมัติ/ปฏิเสธ | กดจากแดชบอร์ดได้เลย |
| 📥 Export CSV | ดาวน์โหลดข้อมูลเป็น Excel ได้ |

---

## 🚀 วิธี Deploy ทีละขั้นตอน

### ขั้นตอนที่ 1 — สร้าง LINE Messaging API Channel

1. ไปที่ https://developers.line.biz
2. สร้าง **Provider** ใหม่ (ถ้ายังไม่มี)
3. สร้าง **Messaging API Channel**
4. เข้าไปที่ **Basic Settings** → คัดลอก **Channel Secret**
5. เข้าไปที่ **Messaging API** → **Channel access token** → กด **Issue** → คัดลอก token
6. ใน **Messaging API** tab → เลื่อนลงหา **Auto-reply messages** → ปิดออก

---

### ขั้นตอนที่ 2 — ตั้งค่า Supabase

1. ไปที่ https://supabase.com → สร้างบัญชีฟรี
2. กด **New Project** → ตั้งชื่อ เช่น `student-council`
3. จดรหัสผ่าน Database ไว้
4. รอ Project สร้างเสร็จ (~1 นาที)

**สร้างฐานข้อมูล:**
1. คลิก **SQL Editor** ในแถบซ้าย
2. วางโค้ดจากไฟล์ `sql/schema.sql` ทั้งหมด
3. กด **Run**

**สร้าง Storage Bucket:**
1. คลิก **Storage** ในแถบซ้าย
2. กด **New bucket** → ชื่อ `payment-slips`
3. ✅ เปิด **Public bucket**
4. กด **Save**

**เก็บ Credentials:**
1. ไปที่ **Settings → API**
2. คัดลอก **Project URL** → นี่คือ `SUPABASE_URL`
3. คัดลอก **service_role** key (ใต้ anon key) → นี่คือ `SUPABASE_SERVICE_KEY`

---

### ขั้นตอนที่ 3 — Deploy บน Render

1. ไปที่ https://render.com → สร้างบัญชีฟรี
2. **New → Web Service**
3. เลือก **Deploy from GitHub** (หรือ Deploy manually)

**ถ้าใช้ GitHub:**
1. Push โค้ดทั้งหมดขึ้น GitHub repo
2. Connect repo ใน Render
3. Build Command: `npm install`
4. Start Command: `npm start`

**ถ้าไม่มี GitHub — ใช้ Render CLI:**
```bash
npm install -g @render-cli/cli
render login
render deploy
```

**ตั้ง Environment Variables ใน Render:**
```
LINE_CHANNEL_ACCESS_TOKEN  = (จากขั้นตอนที่ 1)
LINE_CHANNEL_SECRET        = (จากขั้นตอนที่ 1)
SUPABASE_URL               = (จากขั้นตอนที่ 2)
SUPABASE_SERVICE_KEY       = (จากขั้นตอนที่ 2)
ADMIN_SECRET_KEY           = (ตั้งเองเป็นรหัสลับ เช่น abc123xyz789)
PORT                       = 3000
```

5. กด **Deploy** → รอ ~2 นาที
6. คัดลอก URL เช่น `https://student-council-bot.onrender.com`

---

### ขั้นตอนที่ 4 — ตั้ง Webhook LINE

1. กลับไป LINE Developers Console
2. **Messaging API** tab → **Webhook URL**
3. ใส่: `https://your-app.onrender.com/webhook`
4. กด **Verify** → ต้องได้ ✅ Success
5. เปิด **Use webhook**

---

### ขั้นตอนที่ 5 — เพิ่มข้อมูลเริ่มต้น

เปิดแดชบอร์ดที่: `https://your-app.onrender.com`

1. ล็อกอินด้วย **Admin Secret Key** ที่ตั้งไว้
2. ไปแท็บ **⚙️ จัดการ**
3. เพิ่มชื่อนักเรียนทีละคน
4. เพิ่มหัวข้อการชำระเงิน

---

## 📁 โครงสร้างไฟล์

```
line-payment-bot/
├── src/
│   ├── index.js        ← Main server + LINE Bot handler
│   ├── messages.js     ← Flex Message templates
│   └── supabase.js     ← Database client
├── dashboard/
│   └── index.html      ← Admin Dashboard
├── sql/
│   └── schema.sql      ← Database schema
├── package.json
├── render.yaml
└── .env.example
```

---

## 🔄 Flow การทำงาน

```
นักเรียนกด "แจ้งชำระเงิน"
    ↓
เลือกหัวข้อ (Carousel)
    ↓
เลือกชื่อตัวเอง (Quick Reply)
    ↓
ส่งรูปสลิป
    ↓
ระบบบันทึก → แจ้ง "ส่งแล้ว รอตรวจสอบ"
    ↓
แอดมินเปิดแดชบอร์ด → กดอนุมัติ/ปฏิเสธ
```

---

## ⚙️ Admin API (เรียกตรงก็ได้)

| Method | Path | ทำอะไร |
|--------|------|--------|
| POST | `/admin/students` | เพิ่มนักเรียน |
| POST | `/admin/topics` | เพิ่มหัวข้อ |
| GET | `/admin/dashboard` | ดึงข้อมูลทั้งหมด |
| PATCH | `/admin/payments/:id` | อนุมัติ/ปฏิเสธ |

Header ทุก request: `x-admin-key: YOUR_ADMIN_SECRET_KEY`

---

## 💡 หมายเหตุ

- **Render Free Tier** จะ sleep หลังไม่มีการใช้งาน 15 นาที → ครั้งแรกหลัง sleep อาจช้า ~30 วินาที
- หากต้องการให้รวดเร็วตลอดเวลา แนะนำ **Railway** (ฟรี $5/เดือน)
- **Supabase Free** รองรับ 500MB + 1GB bandwidth/เดือน เพียงพอสำหรับสภานักเรียน

---

## 🆘 ปัญหาที่พบบ่อย

**Webhook Verify ไม่ผ่าน**
→ ตรวจ URL ว่าถูกต้อง และ server ยังทำงานอยู่

**ส่งสลิปแล้วขึ้น error**
→ ตรวจว่าสร้าง Supabase Storage bucket ชื่อ `payment-slips` และเปิดเป็น Public แล้ว

**แดชบอร์ด login ไม่ได้**
→ ตรวจ `ADMIN_SECRET_KEY` ใน Render Environment Variables ตรงกับที่กรอกหรือเปล่า
