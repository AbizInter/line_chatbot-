import { GoogleGenAI } from '@google/genai';
import type { ChatMessage } from '@/lib/history';

export const DEFAULT_REPLY =
  'ขออภัยค่ะ ข้อมูลส่วนนี้ยังไม่มีในระบบ เดี๋ยวแอดมินตรวจสอบและติดต่อกลับคุณลูกค้าอีกครั้งนะคะ';

interface AskGeminiParams {
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
เมื่อลูกค้าถามถึงปฏิทินโดยทั่วไป ให้นำเสนอเพียง 2 ตัวเลือกหลักคือ (1) พิมพ์ Artwork ลูกค้าเอง และ (2) ปฏิทินสำเร็จรูป (ไม่พิมพ์โลโก้) เท่านั้น ห้ามนำเสนอ "ฐานปฏิทินเปล่า" เว้นแต่ลูกค้าจะถามเจาะจงเองก่อน
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

export async function askGemini({ faqCsv, question }: AskGeminiParams): Promise<string> {
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) {
    console.error('[GEMINI] GEMINI_API_KEY env missing');
    return DEFAULT_REPLY;
  }

  const ai = new GoogleGenAI({ apiKey });
  const prompt = buildPrompt(faqCsv, question, history);

  try {
    const response = await ai.models.generateContent({
      model: 'gemini-2.5-flash',
      contents: prompt,
      config: {
        temperature: 1.0,
        maxOutputTokens: 2048,
      },
    });

    const finishReason = response.candidates?.[0]?.finishReason;
    const thoughtsTokenCount = response.usageMetadata?.thoughtsTokenCount;
    const candidatesTokenCount = response.usageMetadata?.candidatesTokenCount;

    console.log('[GEMINI]', { finishReason, thoughtsTokenCount, candidatesTokenCount });

    if (finishReason === 'MAX_TOKENS') {
      console.warn('[GEMINI] MAX_TOKENS — returning default reply');
      return DEFAULT_REPLY;
    }

    const text = response.text?.trim();
    if (!text) {
      console.error('[GEMINI_EMPTY_RESPONSE]');
      return DEFAULT_REPLY;
    }

    return text;
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    if (/timeout|ETIMEDOUT|ECONNABORTED|AbortError/i.test(msg)) {
      console.error('[GEMINI_TIMEOUT]', msg);
    } else {
      console.error('[GEMINI] Error:', msg);
    }
    return DEFAULT_REPLY;
  }
}
