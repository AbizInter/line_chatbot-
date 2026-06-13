const CACHE_TTL_MS = 60_000;

interface FaqRow {
  question: string;
  answer: string;
  category: string;
  keywords: string;
}

let cache: { csv: string; at: number } | null = null;

function parseCsvLine(line: string): string[] {
  const fields: string[] = [];
  let cur = '';
  let inQ = false;
  for (let i = 0; i < line.length; i++) {
    const c = line[i];
    if (c === '"') {
      if (inQ && line[i + 1] === '"') { cur += '"'; i++; }
      else inQ = !inQ;
    } else if (c === ',' && !inQ) {
      fields.push(cur); cur = '';
    } else {
      cur += c;
    }
  }
  fields.push(cur);
  return fields;
}

function buildFaqCsv(raw: string): string {
  const lines = raw.replace(/\r/g, '').split('\n').filter((l) => l.trim());
  if (lines.length < 2) return '';

  const headers = parseCsvLine(lines[0]).map((h) => h.trim().toLowerCase());
  const qi = headers.indexOf('question');
  const ai = headers.indexOf('answer');
  const ci = headers.indexOf('category');
  const ki = headers.indexOf('keywords');
  const acti = headers.indexOf('active');

  if (qi === -1 || ai === -1) return '';

  const rows: FaqRow[] = lines.slice(1).reduce<FaqRow[]>((acc, line) => {
    const f = parseCsvLine(line);
    const q = (f[qi] ?? '').trim();
    const a = (f[ai] ?? '').trim();
    if (!q || !a) return acc;
    if (acti !== -1) {
      const act = (f[acti] ?? '').trim().toLowerCase();
      if (act === 'false' || act === 'no' || act === '0') return acc;
    }
    acc.push({
      question: q,
      answer: a,
      category: ci !== -1 ? (f[ci] ?? '').trim() : '',
      keywords: ki !== -1 ? (f[ki] ?? '').trim() : '',
    });
    return acc;
  }, []);

  const esc = (s: string) => s.replace(/"/g, '""');
  const body = rows.map(
    (r) => `"${esc(r.question)}","${esc(r.answer)}","${esc(r.category)}","${esc(r.keywords)}"`,
  );
  return ['question,answer,category,keywords', ...body].join('\n');
}

export async function getFaqCsv(): Promise<string> {
  const now = Date.now();
  if (cache && now - cache.at < CACHE_TTL_MS) return cache.csv;

  const url = process.env.SHEET_CSV_URL;
  if (!url) {
    console.error('[SHEET] SHEET_CSV_URL env missing');
    if (cache) { console.warn('[SHEET] Using stale cache'); return cache.csv; }
    throw new Error('SHEET_FETCH_FAILED: SHEET_CSV_URL not set');
  }

  try {
    const res = await fetch(url, { cache: 'no-store' });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const raw = await res.text();
    const csv = buildFaqCsv(raw);
    cache = { csv, at: now };
    return csv;
  } catch (err) {
    console.error('[SHEET_FETCH_FAILED]', err instanceof Error ? err.message : err);
    if (cache) { console.warn('[SHEET] Using stale cache'); return cache.csv; }
    throw new Error('SHEET_FETCH_FAILED');
  }
}
