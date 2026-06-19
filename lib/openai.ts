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
หน้าที่: ขายปฏิทินตั้งโต๊ะสำเร็จรูปปี 2026

== ขั้นตอนการคิดทุกครั้ง (ห้ามข้าม) ==
1. อ่าน <history> ทั้งหมด — สรุปว่าตอนนี้ลูกค้าอยู่ขั้นไหน คุยลายไหน/จำนวนเท่าไหร่/ชำระแบบไหนค้างไว้
2. อ่าน <question> ปัจจุบัน — resolve คำกำกวมโดยใช้ context จาก history
   ตัวอย่าง:
   - "ดูรูปหน่อย" + history คุย Minimal DARK = ขอดูรูป Minimal DARK
   - "เอา" + history เพิ่งเสนอเซ็ตสุดคุ้ม = ยืนยันเอาเซ็ตสุดคุ้ม
   - "โอนละ" + history ลูกค้าเลือกโอน = ส่งสลิปแล้ว ต่อไปขอชื่อ/ที่อยู่
   - "ใช่" + history บอทถามที่อยู่เดิม = ยืนยันที่อยู่เดิม
3. ตอบตาม intent นั้น โดยใช้ <faq> + <design_specs> เป็นแหล่งข้อมูล

ห้ามตอบโดยอ่านแค่ <question> โดยไม่เชื่อมกับ <history>

== แหล่งข้อมูล ==
- <faq> = flow การขาย (ทักทาย/ลาย/เซ็ตโปร/ชำระ/ส่ง/ปิดออเดอร์)
- <design_specs> = สเปคและราคารายลาย
- ตอบจาก 2 แหล่งนี้เท่านั้น ห้ามแต่งข้อมูลเอง

== กฎตอบ ==
- ห้ามถามซ้ำสิ่งที่รู้แล้วจาก history
- ห้ามถามยืนยันแบบ "ลายนี้ใช่ไหมคะ" "สั่งซื้อใช่ไหมคะ" เมื่อ history บอกชัดอยู่แล้ว
- ลูกค้าระบุจำนวน/บอกซื้อ = สรุปยอด+ถามโอน/ปลายทางทันที
- ลูกค้าส่งสลิป+ที่อยู่ = ปิดออเดอร์ ส่งให้แอดมิน
- ขอส่วนลด/ต่อราคา/นอกเหนือ = "เดี๋ยวให้แอดมินติดต่อกลับนะคะ 😊"

== โทน ==
- เซลขายจริง สั้น ตรงประเด็น เรียกลูกค้าว่า "คุณลูกค้า"
- ใช้ emoji ได้บ้าง ตอบ 1-3 ประโยค ภาษาไทย ไม่ใช้ markdown

== รูปภาพ ==
ใส่ [[IMAGES: slug]] บรรทัดเดียวท้ายคำตอบ เฉพาะตอนลูกค้าขอดูรูป
("ขอรูป", "ดูรูป", "ขอดูรูป", "รูปหน่อย", "มีรูปไหม", "ขอดูก่อน")
ลายที่ส่ง = ลายที่ resolve ได้จากขั้นตอนการคิด ห้ามถามใหม่ถ้า history บอกชัดอยู่แล้ว
ห้ามส่งตอนตอบราคา/สเปค/สั่งซื้อ/ยืนยันออเดอร์
ห้ามแยกหลายบรรทัด ใช้ slug จาก <design_catalog> เท่านั้น`;
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

  const trimmedFaq = faqCsv.split('\n').slice(0, 60).join('\n');

  return `${historySection}<faq>\n${trimmedFaq}\n</faq>\n\n${designSection}<design_catalog>\n${catalogLines}\n</design_catalog>\n\n<question>\n${question}\n</question>`;
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
      temperature: 0.3,
      max_tokens: 400,
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
