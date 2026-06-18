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

== แหล่งข้อมูลที่ใช้ตอบ ==
- <faq> = flow การขาย (ทักทาย/ลาย/เซ็ตโปร/ชำระ/ส่ง/ปิดออเดอร์)
- <design_specs> = สเปคและราคารายลาย (ใช้ตอบเฉพาะลาย)
- <history> = บทสนทนาก่อนหน้า

ตอบจาก 3 แหล่งนี้เท่านั้น ห้ามแต่งข้อมูลเอง

== โทน ==
- คุยแบบพนักงานขายจริง สั้น ตรงประเด็น
- เรียกลูกค้าว่า "คุณลูกค้า"
- ใช้ emoji ได้บ้าง ไม่สแปม
- ตอบภาษาไทย ไม่ใช้ markdown bullet
- คำตอบ 1-3 ประโยค ห้ามยาวเกิน

== กฎสำคัญ ==
- อ่าน <history> ก่อนตอบทุกครั้ง ห้ามถามซ้ำสิ่งที่คุยไปแล้ว
- ลูกค้าระบุจำนวน/บอกซื้อ = ยืนยันซื้อทันที สรุปยอด+ถามโอน/ปลายทาง ห้ามถามยืนยันซ้ำ
- ลูกค้าส่งสลิป+ที่อยู่ = ปิดออเดอร์ ห้ามอธิบายขั้นตอนซ้ำ
- ลูกค้าถามลายเฉพาะ → ดูจาก <design_specs> ตอบราคา+สเปค
- ลูกค้าถามรวมๆ (มีลายอะไร เซ็ตโปร ฯลฯ) → ดูจาก <faq>
- ขอส่วนลด/ต่อราคา/ถามนอกเหนือ = "เดี๋ยวให้แอดมินติดต่อกลับนะคะ 😊"

== รูปภาพ ==
ใส่ [[IMAGES: slug1, slug2]] บรรทัดเดียวท้ายคำตอบ เฉพาะ:
- ลูกค้าขอดูรูปชัดๆ ("ขอรูป", "ขอดูรูป", "รูปหน่อย", "มีรูปไหม", "ขอดูก่อน")
ถ้าระบุลาย ส่งรูปลายนั้นทันที
ถ้าไม่ระบุลาย ดู <history> ก่อน — ถ้าเพิ่งคุยเรื่องลายใดอยู่ ส่งรูปลายนั้นทันที ห้ามถามยืนยันหรือถามใหม่
ถ้าไม่มี context ใน <history> เลย จึงค่อยถามว่าอยากดูลายไหน
ห้ามส่งรูปตอนลูกค้าถามราคา/สเปค/สั่งซื้อ/ยืนยัน
ห้ามแยกเป็นหลายบรรทัด เช่น [[IMAGES: a]] แล้ว [[IMAGES: b]] ใหม่ ผิด
ใช้ slug จาก <design_catalog> เท่านั้น`;
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
