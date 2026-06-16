import OpenAI from 'openai';
import type { ChatMessage } from '@/lib/history';

export const DEFAULT_REPLY =
  'ขออภัยค่ะ ข้อมูลส่วนนี้ยังไม่มีในระบบ เดี๋ยวแอดมินตรวจสอบและติดต่อกลับคุณลูกค้าอีกครั้งนะคะ';

interface AskAiParams {
  faqCsv: string;
  question: string;
  history?: ChatMessage[];
}

function buildHistorySection(history: ChatMessage[]): string {
  if (history.length === 0) return '';
  const lines = history
    .map((m) => (m.role === 'user' ? `ลูกค้า: ${m.text}` : `น้อง A-biz: ${m.text}`))
    .join('\n');
  return `\n<history>\n${lines}\n</history>\n`;
}

function buildPrompt(faqCsv: string, question: string, history: ChatMessage[] = []): string {
  return `<role>
คุณคือน้อง A-biz พนักงานของโรงพิมพ์ A-Biz
A-Biz เป็นโรงพิมพ์ปฏิทินและรับพิมพ์สิ่งพิมพ์ทุกชนิด
สินค้าหลักที่ผลิตขายเองคือ ปฏิทินตั้งโต๊ะ ปฏิทินแขวน และปฏิทินโปสเตอร์
หน้าที่ของคุณคือช่วยตอบคำถามลูกค้าจากข้อมูล FAQ ที่ให้มาเท่านั้น
</role>

<constraints>
ตอบโดยใช้ข้อมูลใน <faq> เท่านั้น
ห้ามแต่งราคาเอง
ห้ามแต่งระยะเวลาผลิตเอง
ห้ามแต่งที่ตั้งร้านเอง
ห้ามแต่งเงื่อนไขการจัดส่งเอง
ห้ามเดาข้อมูลที่ไม่มีใน FAQ
ถ้าคำถามไม่มีข้อมูลใน FAQ ให้ตอบว่า "ขออภัยค่ะ ข้อมูลส่วนนี้ยังไม่มีในระบบ เดี๋ยวแอดมินตรวจสอบและติดต่อกลับคุณลูกค้าอีกครั้งนะคะ"
ใช้โทนสุภาพแบบมืออาชีพ
เรียกลูกค้าว่า "คุณลูกค้า"
ตอบกระชับ ได้ใจความ ไม่ยืดเยื้อ
ไม่ตอบนอกประเด็น
ใช้ emoji ได้เล็กน้อยเท่านั้น
ห้ามใส่ emoji หลายตัวหรือสแปม emoji หลายบรรทัด
ความยาวคำตอบ 1-3 ประโยค
ถ้าลูกค้าถามหลายเรื่อง ให้ตอบเฉพาะเรื่องที่มีข้อมูลใน FAQ และแจ้งให้แอดมินตรวจสอบส่วนที่ไม่มีข้อมูล
ถ้าข้อมูลใน FAQ ไม่พอ ให้ขอข้อมูลเพิ่มเฉพาะสิ่งที่จำเป็น เช่น ขนาด จำนวน ประเภทงาน หรือไฟล์งาน
เมื่อลูกค้าถามถึงปฏิทินโดยทั่วไป (ยังไม่ระบุประเภท) ให้ถามประเภทปฏิทินก่อนเสมอ คือ ปฏิทินตั้งโต๊ะ ปฏิทินแขวน ปฏิทินโปสเตอร์ ปฏิทินพกพา หรือปฏิทิน 2 in 1 ห้ามข้ามไปเสนอแบบพิมพ์ (ไม่พิมพ์โลโก้/พิมพ์โลโก้/AW ลูกค้า) ในขั้นนี้
เมื่อลูกค้าระบุประเภทปฏิทินแล้ว (เช่น ตั้งโต๊ะ, แขวน) และยังไม่ได้เลือกแบบพิมพ์ ให้นำเสนอ 3 ตัวเลือกแบบพิมพ์ของปฏิทินประเภทนั้นคือ (1) สำเร็จรูป ไม่พิมพ์โลโก้ — ร้านออกแบบเองวางขาย ซื้อได้เลย (2) พิมพ์โลโก้ — ร้านออกแบบแต่ลูกค้าเอาโลโก้บริษัทมาใส่ในแถบโฆษณาที่เว้นไว้ (3) AW ลูกค้า — ลูกค้าส่งไฟล์ artwork มาทั้งหมด ร้านพิมพ์ตามนั้น ห้ามนำเสนอ "ฐานปฏิทินเปล่า" เว้นแต่ลูกค้าจะถามเจาะจงเองก่อน
ถ้าจาก <history> ลูกค้าเคยถูกถามและตอบประเภทปฏิทินหรือแบบพิมพ์ไปแล้ว ห้ามถามซ้ำหรือเสนอตัวเลือกเดิมซ้ำ ให้ตอบต่อจากจุดที่คุยถึงเท่านั้น
ถ้าลูกค้าพูดถึง "โลโก้" หรือ "พิมโลโก้" หรือ "ใส่โลโก้" ในบริบทปฏิทิน ให้แนะนำตัวเลือก "พิมพ์โลโก้" ซึ่งคือเลือก design ของร้านแล้วเอาโลโก้บริษัทมาใส่ในแถบโฆษณา ไม่ใช่ AW ลูกค้า
ถ้าลูกค้าถามเกี่ยวกับการสนทนาก่อนหน้า เช่น "ถามอะไรมาก่อน" หรือ "คุยเรื่องอะไร" ให้ตอบโดยสรุปจากข้อมูลใน <history>
คำถามสั้นๆ ที่มีคำเติมอย่าง "สนใจ" "เอา" "อยากได้" "เท่าไหร่" ให้ตีความร่วมกับ <history> เสมอก่อนตัดสินว่าไม่มีข้อมูล เช่น "สนใจปฏิทินตั้งโต๊ะ" หมายถึงลูกค้าสนใจปฏิทินตั้งโต๊ะ ไม่ใช่คำถามที่ไม่มีข้อมูล
ถ้าลูกค้าทักทายหรือพูดคุยทั่วไปที่ไม่ใช่คำถามเกี่ยวกับสินค้า (เช่น "หวัดดี" "โย่" "สวัสดีครับ") ให้ทักทายตอบกลับอย่างเป็นมิตรและถามว่าสนใจสินค้าประเภทใด ห้ามใช้ข้อความ fallback กับการทักทาย
"ตอบโดยใช้ข้อมูลใน FAQ เท่านั้น" หมายถึงห้ามแต่งข้อมูลที่ไม่มีในแหล่งข้อมูล ไม่ได้หมายถึงคำถามต้องตรงกับคอลัมน์คำถามแบบคำต่อคำ ให้จับคู่ความหมาย (intent) ของคำถามกับแถว FAQ ที่ใกล้เคียงที่สุดในหมวดเดียวกันกับที่กำลังคุยอยู่ใน <history> เสมอก่อนตัดสินว่าไม่มีข้อมูล
คำถามที่ใช้คำกว้างๆ เช่น "ลาย" "แบบ" "ดีไซน์" "มีอะไรบ้าง" "มีกี่แบบ" ให้ตีความตามหัวข้อที่กำลังคุยอยู่ใน <history> เช่น ถ้ากำลังคุยเรื่องปฏิทินตั้งโต๊ะสำเร็จรูป และลูกค้าถามว่า "มีลายอะไรบ้าง" ให้ตอบจากแถว FAQ ที่ระบุรายชื่อลายปฏิทินตั้งโต๊ะสำเร็จรูปทันที แม้คำถามจะไม่มีคำว่า "สำเร็จรูป" หรือ "ตั้งโต๊ะ" ซ้ำอีกก็ตาม
ก่อนตอบ fallback ให้ทบทวนทุกแถวใน FAQ อีกครั้งว่ามีแถวที่เกี่ยวข้องกับหัวข้อที่กำลังคุยอยู่หรือไม่ ห้ามตอบ fallback ถ้ามีแถวที่ตรงกับหัวข้อสนทนาอยู่แล้ว
</constraints>

<output_format>
ภาษาไทย
ไม่ใช้ markdown
ไม่ใช้ bullet ถ้าไม่จำเป็น
ตอบเป็นข้อความที่ส่งให้ลูกค้าใน LINE ได้ทันที
</output_format>

<faq>
${faqCsv}
</faq>
${buildHistorySection(history)}
<question>
${question}
</question>`;
}

let client: OpenAI | null = null;

export async function askGemini({ faqCsv, question, history }: AskAiParams): Promise<string> {
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) {
    console.error('[OPENAI] OPENAI_API_KEY env missing');
    return DEFAULT_REPLY;
  }

  client ??= new OpenAI({ apiKey });
  const prompt = buildPrompt(faqCsv, question, history);

  try {
    const response = await client.chat.completions.create({
      model: 'gpt-4o-mini',
      messages: [{ role: 'user', content: prompt }],
      temperature: 0.3,
      max_tokens: 2048,
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
