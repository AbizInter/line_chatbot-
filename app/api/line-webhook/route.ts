import { NextRequest, NextResponse } from 'next/server';
import { validateSignature, messagingApi } from '@line/bot-sdk';
import type { WebhookEvent } from '@line/bot-sdk';

type Message = messagingApi.Message;
import { getFaqCsv } from '@/lib/sheet';
import { getDesignSpecsCsv, getCalendarCatalog, getImageUrl } from '@/lib/designSheet';
import { askGemini, DEFAULT_REPLY } from '@/lib/openai';
import { getHistory, appendHistory } from '@/lib/history';

const AI_TIMEOUT_MS = 12_000;
const MAX_IMAGES = 3;

const IMAGES_TAG_PATTERN = /\n?\[\[IMAGES:\s*([^\]]*)\]\]\s*$/i;
const ORDER_TAG_PATTERN = /\n?\[\[ORDER:\s*(\{[\s\S]*?\})\s*\]\]\s*$/i;

interface OrderData {
  items?: { name: string; qty: number; price: number }[];
  total?: number;
  payment?: 'transfer' | 'cod';
  name?: string;
  phone?: string;
  address?: string;
}

function extractOrderTag(reply: string): { text: string; order: OrderData | null } {
  const match = reply.match(ORDER_TAG_PATTERN);
  if (!match) return { text: reply, order: null };

  const text = reply.slice(0, match.index).trim();
  try {
    const order = JSON.parse(match[1]) as OrderData;
    return { text, order };
  } catch (err) {
    console.error('[ORDER_PARSE_FAILED]', err instanceof Error ? err.message : err);
    return { text, order: null };
  }
}

async function extractImageMessages(reply: string): Promise<{ text: string; images: Message[] }> {
  const match = reply.match(IMAGES_TAG_PATTERN);
  if (!match) return { text: reply, images: [] };

  const text = reply.slice(0, match.index).trim();
  const slugs = match[1]
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean)
    .slice(0, MAX_IMAGES);

  const images: Message[] = [];
  for (const slug of slugs) {
    const url = await getImageUrl(slug);
    if (url) {
      images.push({ type: 'image', originalContentUrl: url, previewImageUrl: url });
    } else {
      console.warn('[WEBHOOK] Unknown slug in IMAGES tag:', slug);
    }
  }

  return { text, images };
}

function formatOrderMessage(order: OrderData, displayName: string): string {
  const lines: string[] = ['🛒 คำสั่งซื้อใหม่'];
  lines.push(`💬 LINE: ${displayName}`);
  if (order.name) lines.push(`👤 ชื่อ: ${order.name}`);
  if (order.phone) lines.push(`📞 โทร: ${order.phone}`);
  if (order.address) lines.push(`📍 ที่อยู่: ${order.address}`);
  if (order.items && order.items.length) {
    lines.push('📦 รายการ:');
    for (const it of order.items) {
      lines.push(`  - ${it.name} x${it.qty} = ${it.qty * it.price} บาท`);
    }
  }
  if (order.total !== undefined) lines.push(`💰 ยอดรวม: ${order.total} บาท`);
  if (order.payment) {
    lines.push(`💳 ชำระ: ${order.payment === 'transfer' ? 'โอนเงิน' : 'เก็บปลายทาง (+30)'}`);
  }
  return lines.join('\n');
}

async function pushOrderToSalesGroup(
  client: messagingApi.MessagingApiClient,
  order: OrderData,
  userId: string,
): Promise<void> {
  const groupId = process.env.SALES_GROUP_ID;
  if (!groupId) {
    console.warn('[ORDER] SALES_GROUP_ID env var missing — skip push');
    return;
  }

  let displayName = 'ลูกค้า';
  try {
    const profile = await client.getProfile(userId);
    if (profile.displayName) displayName = profile.displayName;
  } catch (err) {
    console.warn('[ORDER] Failed to get profile:', err instanceof Error ? err.message : err);
  }

  try {
    await client.pushMessage({
      to: groupId,
      messages: [{ type: 'text', text: formatOrderMessage(order, displayName) }],
    });
    console.log('[ORDER_PUSHED]', { userId, displayName, total: order.total });
  } catch (err) {
    console.error('[ORDER_PUSH_FAILED]', err instanceof Error ? err.message : err);
  }
}

async function withTimeout<T>(promise: Promise<T>, ms: number, label: string): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(new Error(`${label}_TIMEOUT`)), ms);
  });
  try {
    return await Promise.race([promise, timeout]);
  } finally {
    clearTimeout(timer);
  }
}

export async function POST(request: NextRequest) {
  const channelSecret = process.env.LINE_CHANNEL_SECRET;
  const channelAccessToken = process.env.LINE_CHANNEL_ACCESS_TOKEN;

  if (!channelSecret || !channelAccessToken) {
    console.error('[WEBHOOK] LINE env vars missing');
    return NextResponse.json({ ok: true });
  }

  const rawBody = await request.text();
  const signature = request.headers.get('x-line-signature') ?? '';

  if (!validateSignature(rawBody, channelSecret, signature)) {
    console.warn('[WEBHOOK] Signature validation failed');
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  let parsed: { events: WebhookEvent[] };
  try {
    parsed = JSON.parse(rawBody) as { events: WebhookEvent[] };
  } catch {
    console.error('[WEBHOOK] JSON parse failed');
    return NextResponse.json({ ok: true });
  }

  const client = new messagingApi.MessagingApiClient({ channelAccessToken });

  await Promise.all(
    parsed.events.map(async (event) => {
      console.log('[WEBHOOK_EVENT]', {
        type: event.type,
        source: 'source' in event ? event.source : null,
      });

      if (event.type !== 'message' || event.message.type !== 'text') return;

      // ตอบเฉพาะแชท 1:1 กับลูกค้า ไม่ตอบในกลุ่ม/ห้อง
      if (event.source.type !== 'user') return;

      const userMessage = event.message.text;
      const replyToken = event.replyToken;
      const userId = event.source.userId ?? 'unknown';
      let text = DEFAULT_REPLY;
      let images: Message[] = [];
      let order: OrderData | null = null;

      try {
        let faqCsv = '';
        try {
          faqCsv = await getFaqCsv();
        } catch (err) {
          console.error('[WEBHOOK] Sheet unavailable:', err instanceof Error ? err.message : err);
        }

        let designSpecsCsv = '';
        let catalog: { slug: string; name: string }[] = [];
        try {
          designSpecsCsv = await getDesignSpecsCsv();
          catalog = await getCalendarCatalog();
        } catch (err) {
          const msg = err instanceof Error ? err.message : String(err);
          if (msg !== 'DESIGN_SHEET_NOT_CONFIGURED') {
            console.error('[WEBHOOK] Design sheet unavailable:', msg);
          }
        }

        const history = await getHistory(userId);

        const rawReply = await withTimeout(
          askGemini({ faqCsv, designSpecsCsv, catalog, question: userMessage, history }),
          AI_TIMEOUT_MS,
          'OPENAI',
        );

        // Extract ORDER tag first, then IMAGES tag
        const orderResult = extractOrderTag(rawReply);
        order = orderResult.order;
        const afterOrder = orderResult.text;

        ({ text, images } = await extractImageMessages(afterOrder));
        await appendHistory(userId, userMessage, text);
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        if (msg.includes('OPENAI_TIMEOUT')) {
          console.error('[OPENAI_TIMEOUT]', msg);
        } else {
          console.error('[WEBHOOK] Processing error:', msg);
        }
      }

      try {
        await client.replyMessage({
          replyToken,
          messages: [{ type: 'text', text }, ...images],
        });
      } catch (err) {
        console.error('[LINE_REPLY_FAILED]', err instanceof Error ? err.message : err);
      }

      // Push order to sales group after replying customer
      if (order) {
        await pushOrderToSalesGroup(client, order, userId);
      }
    }),
  );

  return NextResponse.json({ ok: true });
}
