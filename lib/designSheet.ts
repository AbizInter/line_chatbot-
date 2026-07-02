const CACHE_TTL_MS = 60_000;

interface DesignRow {
  name: string;
  specs: string;
  price: string;
  slug: string;
  imageUrl: string;
}

interface DesignCache {
  csv: string;
  catalog: { slug: string; name: string }[];
  imageMap: Map<string, string>;
  at: number;
}

let cache: DesignCache | null = null;

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

function parseDesignSheet(raw: string): DesignRow[] {
  const lines = raw.replace(/\r/g, '').split('\n').filter((l) => l.trim());
  if (lines.length < 2) return [];

  const HEADER_MAP: Record<string, string> = {
    ชื่อลาย: 'name',
    ลาย: 'name',
    สเปก: 'specs',
    สเปค: 'specs',
    ราคา: 'price',
    slug: 'slug',
    image_url: 'imageUrl',
    imageurl: 'imageUrl',
    เปิดใช้: 'active',
    ใช้งาน: 'active',
  };
  const headers = parseCsvLine(lines[0]).map((h) => {
    const trimmed = h.trim();
    return HEADER_MAP[trimmed] ?? HEADER_MAP[trimmed.toLowerCase()] ?? trimmed.toLowerCase();
  });
  const ni = headers.indexOf('name');
  const si = headers.indexOf('specs');
  const pi = headers.indexOf('price');
  const sli = headers.indexOf('slug');
  const ii = headers.indexOf('imageUrl');
  const acti = headers.indexOf('active');

  if (ni === -1) return [];

  return lines.slice(1).reduce<DesignRow[]>((acc, line) => {
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
      slug: sli !== -1 ? (f[sli] ?? '').trim() : '',
      imageUrl: ii !== -1 ? (f[ii] ?? '').trim() : '',
    });
    return acc;
  }, []);
}

function buildCsv(rows: DesignRow[]): string {
  const esc = (s: string) => s.replace(/"/g, '""');
  const body = rows.map((r) => `"${esc(r.name)}","${esc(r.specs)}","${esc(r.price)}"`);
  return ['name,specs,price', ...body].join('\n');
}

async function loadDesignData(): Promise<DesignCache> {
  const now = Date.now();
  if (cache && now - cache.at < CACHE_TTL_MS) return cache;

  const url = process.env.DESIGN_SHEET_CSV_URL;
  if (!url) {
    if (cache) { console.warn('[DESIGN_SHEET] Using stale cache'); return cache; }
    throw new Error('DESIGN_SHEET_NOT_CONFIGURED');
  }

  try {
    const res = await fetch(url, { cache: 'no-store' });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const raw = await res.text();
    const rows = parseDesignSheet(raw);
    const csv = buildCsv(rows);
    const catalog = rows.filter((r) => r.slug).map((r) => ({ slug: r.slug, name: r.name }));
    const imageMap = new Map<string, string>();
    for (const r of rows) {
      if (r.slug && r.imageUrl) imageMap.set(r.slug, r.imageUrl);
    }
    cache = { csv, catalog, imageMap, at: now };
    return cache;
  } catch (err) {
    console.error('[DESIGN_SHEET_FETCH_FAILED]', err instanceof Error ? err.message : err);
    if (cache) { console.warn('[DESIGN_SHEET] Using stale cache'); return cache; }
    throw new Error('DESIGN_SHEET_FETCH_FAILED');
  }
}

export async function getDesignSpecsCsv(): Promise<string> {
  const data = await loadDesignData();
  return data.csv;
}

export async function getCalendarCatalog(): Promise<{ slug: string; name: string }[]> {
  const data = await loadDesignData();
  return data.catalog;
}

function safeEncodeUri(url: string): string {
  return url.replace(/%[0-9A-Fa-f]{2}|[\uD800-\uDBFF][\uDC00-\uDFFF]|[\s\S]/g, (match) => {
    if (match.length === 3 && match[0] === '%') return match;
    return encodeURI(match);
  });
}

export async function getImageUrl(slug: string): Promise<string | null> {
  const data = await loadDesignData();
  const url = data.imageMap.get(slug);
  return url ? safeEncodeUri(url) : null;
}

export async function isValidDesignSlug(slug: string): Promise<boolean> {
  const data = await loadDesignData();
  return data.imageMap.has(slug);
}
