import { Redis } from '@upstash/redis';

const redis = new Redis({
  url: process.env.KV_REST_API_URL!,
  token: process.env.KV_REST_API_TOKEN!,
});

export interface ChatMessage {
  role: 'user' | 'assistant';
  text: string;
}

const MAX_MESSAGES = 6; // 3 exchanges
const TTL_SECONDS = 7 * 24 * 60 * 60; // 7 days

export async function getHistory(userId: string): Promise<ChatMessage[]> {
  try {
    const data = await redis.get<ChatMessage[]>(`history:${userId}`);
    return data ?? [];
  } catch {
    return [];
  }
}

export async function appendHistory(
  userId: string,
  userText: string,
  botText: string,
): Promise<void> {
  try {
    const history = await getHistory(userId);
    history.push({ role: 'user', text: userText });
    history.push({ role: 'assistant', text: botText });
    const trimmed = history.slice(-MAX_MESSAGES);
    await redis.set(`history:${userId}`, trimmed, { ex: TTL_SECONDS });
  } catch (err) {
    console.error('[HISTORY] Failed to save:', err);
  }
}
