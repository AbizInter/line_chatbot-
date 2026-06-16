import { NextRequest, NextResponse } from 'next/server';
import { validateSignature, messagingApi } from '@line/bot-sdk';
import type { WebhookEvent } from '@line/bot-sdk';
import { getFaqCsv } from '@/lib/sheet';
import { askGemini, DEFAULT_REPLY } from '@/lib/gemini';
import { getHistory, appendHistory } from '@/lib/history';

const GEMINI_TIMEOUT_MS = 7_000;

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
    console.error('[WEBHOOK] LINE env vars missing — LINE_CHANNEL_SECRET or LINE_CHANNEL_ACCESS_TOKEN not set');
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
      if (event.type !== 'message' || event.message.type !== 'text') return;

      const userMessage = event.message.text;
      const replyToken = event.replyToken;
      const userId = event.source.userId ?? 'unknown';
      let reply = DEFAULT_REPLY;

      try {
        let faqCsv = '';
        try {
          faqCsv = await getFaqCsv();
        } catch (err) {
          console.error('[WEBHOOK] Sheet unavailable:', err instanceof Error ? err.message : err);
        }

        const history = await getHistory(userId);

        reply = await withTimeout(
          askGemini({ faqCsv, question: userMessage, history }),
          GEMINI_TIMEOUT_MS,
          'GEMINI',
        );

        await appendHistory(userId, userMessage, reply);
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        if (msg.includes('GEMINI_TIMEOUT')) {
          console.error('[GEMINI_TIMEOUT]', msg);
        } else {
          console.error('[WEBHOOK] Processing error:', msg);
        }
      }

      try {
        await client.replyMessage({
          replyToken,
          messages: [{ type: 'text', text: reply }],
        });
      } catch (err) {
        console.error('[LINE_REPLY_FAILED]', err instanceof Error ? err.message : err);
      }
    }),
  );

  return NextResponse.json({ ok: true });
}
