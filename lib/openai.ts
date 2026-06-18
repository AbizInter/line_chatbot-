import OpenAI from 'openai';
import type { ChatMessage } from '@/lib/history';
import { CALENDAR_CATALOG } from '@/lib/calendarCatalog';

const DISCONTINUED_DESIGNS = ['Cat-Meaw', 'Planner Post-it'];

function filterDiscontinued(csv: string): string {
  const pattern = new RegExp(
    DISCONTINUED_DESIGNS.map((n) => n.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('|'),
    'gi',
  );
  return csv
    .split('\n')
    .filter((line) => !pattern.test(line))
    .join('\n');
}

export const DEFAULT_REPLY =
  'ขออภัยค่ะ ข้อมูลส่วนนี้ยังไม่มีในระบบ เดี๋ยวแอดมินตรวจสอบและติดต่อกลับคุณลูกค้าอีกครั้งนะคะ';

interface AskAiParams {
  faqCsv: string;
  designSpecsCsv?: string;
  question: string;
  history?: ChatMessage[];
}

function buildSystemPrompt(): string {
  return `คุณคือน้อง A-biz พนักงานขายของโรงพิมพ์ A-Biz คุยผ่าน LINE

== สินค้า 2 กลุ่ม ==
[A] ปฏิทินสำเร็จรูป — ขายได้เลย ราคาอยู่ใน FAQ
[B] งานสั่งทำพิเศษ (พิมพ์โลโก้/AW/นามบัตร/โบรชัวร์/กล่อง/งานบิล ฯลฯ) — ต้องแอดมินเสนอราคา ห้ามแต่งราคาเอง

== โทน ==
- คุยแบบพนักงานขายจริง ไม่ใช่ bot อ่าน FAQ
- สั้น กระชับ ตรงประเด็น
- เรียกลูกค้าว่า "คุณลูกค้า"
- ใช้ emoji ได้บ้าง ไม่สแปม
- ตอบภาษาไทย ไม่ใช้ markdown ไม่ใช้ bullet ถ้าไม่จำเป็น

== Flow ขาย [กลุ่ม A] ==
1. ลูกค้าถาม → ตอบตรงจาก FAQ อย่างมั่นใจ
2. ลูกค้าสนใจ/ระบุจำนวน → เสนอเซ็ตที่คุ้มกว่าก่อน (upsell) ถ้าไม่รับค่อยตอบตามที่ขอ
3. ลูกค้าบอกซื้อ → สรุปยอดรวม แล้วถามทันทีว่า "โอนเงิน หรือ เก็บปลายทางคะ?"
   - โอน: แจ้งบัญชี บจก.เอบิซ อินเตอร์กรุ๊ป ธ.กสิกรไทย 711-2-73862-7 พร้อมขอชื่อ/โทร/ที่อยู่และสลิป
   - ปลายทาง: ขอชื่อ/โทร/ที่อยู่จัดส่งได้เลย
4. ลูกค้าส่งที่อยู่และชำระแล้ว → ยืนยันรับออเดอร์ แจ้งว่าแอดมินจะดำเนินการต่อ

== Flow ขาย [กลุ่ม B] ==
- ถามสเปก (ประเภท/ขนาด/จำนวน/ไฟล์) ให้ครบก่อน
- เมื่อได้สเปกพอแล้ว ตอบว่า "รับทราบค่ะ เดี๋ยวแอดมินจะติดต่อกลับเพื่อเสนอราคานะคะ"

== กฎห้ามทำ ==
- ห้ามถามหรืออธิบายซ้ำสิ่งที่คุยไปแล้วใน <history>
- ห้ามแต่งราคา ลาย โปรโมชั่น หรือข้อมูลที่ไม่มีใน FAQ
- ห้ามใช้ fallback กับการทักทายหรือตอนลูกค้าลังเล/ต่อรอง

== อ่านสัญญาณลูกค้า ==
- "ซื้อ" / "เอา" / "รับ" / "ตกลง" / "ก็บอกว่าซื้อ" = ยืนยันซื้อ → เข้า Flow ขั้น 3 ทันที ห้ามทบทวนราคาซ้ำ
- ส่งสลิป / "โอนแล้ว" / "จ่ายแล้ว" = ชำระแล้ว → เข้า Flow ขั้น 4 ทันที
- ลังเล / บ่น / ต่อรอง = ตอบแบบพนักงานขาย ปลอบหรืออธิบายเพิ่ม ห้ามใช้ fallback
- ขอส่วนลด / ต่อราคา / ถามสิ่งไม่มีใน FAQ = "เดี๋ยวให้แอดมินติดต่อกลับนะคะ 😊"
- ทักทายทั่วไป = "สวัสดีค่ะ ร้าน A-Biz ยินดีให้บริการค่ะ ตอนนี้มีปฏิทินสำเร็จรูปปี 2026 หลายลาย สนใจปฏิทินแบบไหนคะ?"

== รูปภาพ ==
ใส่ [[IMAGES: slug]] ต่อท้ายคำตอบ (บรรทัดสุดท้าย) เฉพาะ 2 กรณี:
1. ลูกค้าขอดูรูป/ตัวอย่างลาย
2. บอทกำลังแนะนำรายการลาย (สูงสุด 3 slug)
ห้ามใส่ตอนตอบราคา/สเปค/ยืนยันออเดอร์
ใช้เฉพาะ slug จาก <design_catalog> เท่านั้น`;
}

function buildUserPrompt(
  faqCsv: string,
  designSpecsCsv: string,
  question: string,
  history: ChatMessage[] = [],
): string {
  const historySection =
    history.length === 0
      ? ''
      : `<history>\n${history
          .map((m) => (m.role === 'user' ? `ลูกค้า: ${m.text}` : `น้อง A-biz: ${m.text}`))
          .join('\n')}\n</history>\n\n`;

  const designSection = designSpecsCsv.trim()
    ? `<design_specs>\n${designSpecsCsv}\n</design_specs>\n\n`
    : '';

  const catalogLines = CALENDAR_CATALOG.map((d) => `${d.slug}: ${d.name}`).join('\n');

  return `${historySection}<faq>\n${faqCsv}\n</faq>\n\n${designSection}<design_catalog>\n${catalogLines}\n</design_catalog>\n\n<question>\n${question}\n</question>`;
}

let client: OpenAI | null = null;

export async function askGemini({
  faqCsv,
  designSpecsCsv = '',
  question,
  history = [],
}: AskAiParams): Promise<string> {
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) {
    console.error('[OPENAI] OPENAI_API_KEY env missing');
    return DEFAULT_REPLY;
  }

  client ??= new OpenAI({ apiKey });

  const cleanFaq = filterDiscontinued(faqCsv);
  const cleanDesign = filterDiscontinued(designSpecsCsv);

  try {
    const response = await client.chat.completions.create({
      model: 'gpt-4o-mini',
      messages: [
        { role: 'system', content: buildSystemPrompt() },
        { role: 'user', content: buildUserPrompt(cleanFaq, cleanDesign, question, history) },
      ],
      temperature: 0.4,
      max_tokens: 512,
    });

    const finishReason = response.choices?.[0]?.finish_reason;
    console.log('[OPENAI]', { finishReason, usage: response.usage });

    if (finishReason === 'length') {
      console.warn('[OPENAI] MAX_TOKENS — returning default reply');
      return DEFAULT_REPLY;
    }

    const text = response.choices?.[0]?.message?.content?.trim();
    if (!text) {
      console.error('[OPENAI_EMPTY_RESPONSE]');
      return DEFAULT_REPLY;
    }

    return text;
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    if (/timeout|ETIMEDOUT|ECONNABORTED|AbortError/i.test(msg)) {
      console.error('[OPENAI_TIMEOUT]', msg);
    } else {
      console.error('[OPENAI] Error:', msg);
    }
    return DEFAULT_REPLY;
  }
}
