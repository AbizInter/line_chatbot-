const CACHE_TTL_MS = 60_000;

interface DesignRow {
  name: string;
  specs: string;
  price: string;
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

function buildDesignCsv(raw: string): string {
  const lines = raw.replace(/\r/g, '').split('\n').filter((l) => l.trim());
  if (lines.length < 2) return '';

  const HEADER_MAP: Record<string, string> = {
    ชื่อลาย: 'name',
    ลาย: 'name',
    สเปก: 'specs',
    สเปค: 'specs',
    ราคา: 'price',
    เปิดใช้: 'active',
    ใช้งาน: 'active',
  };
  const headers = parseCsvLine(lines[0]).map((h) => {
    const trimmed = h.trim();
    return HEADER_MAP[trimmed] ?? trimmed.toLowerCase();
  });
  const ni = headers.indexOf('name');
  const si = headers.indexOf('specs');
  const pi = headers.indexOf('price');
  const acti = headers.indexOf('active');

  if (ni === -1) return '';

  const rows: DesignRow[] = lines.slice(1).reduce<DesignRow[]>((acc, line) => {
    const f = parseCsvLine(line);
    const name = (f[ni] ?? '').trim();
    if (!name) return acc;
    if (acti !== -1) {
      const act = (f[acti] ?? '').trim().toLowerCase();
      if (act === 'false' || act === 'no' || act === '0') return acc;
    }
    acc.push({
      name,
      specs: si !== -1 ? (f[si] ?? '').trim() : '',
      price: pi !== -1 ? (f[pi] ?? '').trim() : '',
    });
    return acc;
  }, []);

  const esc = (s: string) => s.replace(/"/g, '""');
  const body = rows.map((r) => `"${esc(r.name)}","${esc(r.specs)}","${esc(r.price)}"`);
  return ['name,specs,price', ...body].join('\n');
}

export async function getDesignSpecsCsv(): Promise<string> {
  const now = Date.now();
  if (cache && now - cache.at < CACHE_TTL_MS) return cache.csv;

  const url = process.env.DESIGN_SHEET_CSV_URL;
  if (!url) {
    if (cache) { console.warn('[DESIGN_SHEET] Using stale cache'); return cache.csv; }
    throw new Error('DESIGN_SHEET_NOT_CONFIGURED');
  }

  try {
    const res = await fetch(url, { cache: 'no-store' });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const raw = await res.text();
    const csv = buildDesignCsv(raw);
    cache = { csv, at: now };
    return csv;
  } catch (err) {
    console.error('[DESIGN_SHEET_FETCH_FAILED]', err instanceof Error ? err.message : err);
    if (cache) { console.warn('[DESIGN_SHEET] Using stale cache'); return cache.csv; }
    throw new Error('DESIGN_SHEET_FETCH_FAILED');
  }
}
