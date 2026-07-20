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
      console.log('[WEBHOOK_EVENT]', {
        type: event.type,
        source: 'source' in event ? event.source : null,
      });

      if (event.type !== 'message' || event.message.type !== 'text') return;

      const userMessage = event.message.text;
      const replyToken = event.replyToken;
      const userId = event.source.userId ?? 'unknown';
      let text = DEFAULT_REPLY;
      let images: Message[] = [];

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

        ({ text, images } = await extractImageMessages(rawReply));
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
    }),
  );

  return NextResponse.json({ ok: true });
}
