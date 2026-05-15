// jpzip CDN を直接叩く軽量クライアント。CORS が通る前提なので fetch のみ。
// オフライン時のデモ用フォールバック辞書を内蔵。

export const ENDPOINT = 'https://jpzip.nadai.dev';

export interface Town {
  town: string;
  kana: string;
  roma: string;
  note?: string;
}

export interface ZipcodeEntry {
  prefecture: string;
  prefecture_kana: string;
  prefecture_roma: string;
  prefecture_code: string;
  city: string;
  city_kana: string;
  city_roma: string;
  city_code: string;
  towns: Town[];
}

export interface Meta {
  version: string;
  generated_at: string;
  spec_version: string;
  total_zipcodes: number;
  prefix_count: number;
  by_pref: Record<string, number>;
  data_source: string;
  endpoints: { group: string; prefix: string };
}

export type LookupResult =
  | { ok: true; zip: string; entry: ZipcodeEntry; source: 'cdn' | 'cache' | 'fallback' }
  | { ok: false; zip: string; error: 'format' | 'not_found' | 'offline' };

const FALLBACK: Record<string, ZipcodeEntry> = {
  '2310831': {
    prefecture: '神奈川県',
    prefecture_kana: 'カナガワケン',
    prefecture_roma: 'Kanagawa',
    prefecture_code: '14',
    city: '横浜市中区',
    city_kana: 'ヨコハマシナカク',
    city_roma: 'Yokohama Shi Naka Ku',
    city_code: '14104',
    towns: [{ town: '矢口台', kana: 'ヤグチダイ', roma: 'Yaguchidai' }],
  },
  '1000001': {
    prefecture: '東京都',
    prefecture_kana: 'トウキョウト',
    prefecture_roma: 'Tokyo',
    prefecture_code: '13',
    city: '千代田区',
    city_kana: 'チヨダク',
    city_roma: 'Chiyoda Ku',
    city_code: '13101',
    towns: [{ town: '千代田', kana: 'チヨダ', roma: 'Chiyoda' }],
  },
  '1500001': {
    prefecture: '東京都',
    prefecture_kana: 'トウキョウト',
    prefecture_roma: 'Tokyo',
    prefecture_code: '13',
    city: '渋谷区',
    city_kana: 'シブヤク',
    city_roma: 'Shibuya Ku',
    city_code: '13113',
    towns: [{ town: '神宮前', kana: 'ジングウマエ', roma: 'Jingumae' }],
  },
  '6038113': {
    prefecture: '京都府',
    prefecture_kana: 'キョウトフ',
    prefecture_roma: 'Kyoto',
    prefecture_code: '26',
    city: '京都市北区',
    city_kana: 'キョウトシキタク',
    city_roma: 'Kyoto Shi Kita Ku',
    city_code: '26101',
    towns: [{ town: '紫竹西栗栖町', kana: 'シチクニシクルスチョウ', roma: 'Shichikunishikurusucho' }],
  },
  '5300001': {
    prefecture: '大阪府',
    prefecture_kana: 'オオサカフ',
    prefecture_roma: 'Osaka',
    prefecture_code: '27',
    city: '大阪市北区',
    city_kana: 'オオサカシキタク',
    city_roma: 'Osaka Shi Kita Ku',
    city_code: '27127',
    towns: [{ town: '梅田', kana: 'ウメダ', roma: 'Umeda' }],
  },
  '0600001': {
    prefecture: '北海道',
    prefecture_kana: 'ホッカイドウ',
    prefecture_roma: 'Hokkaido',
    prefecture_code: '01',
    city: '札幌市中央区',
    city_kana: 'サッポロシチュウオウク',
    city_roma: 'Sapporo Shi Chuo Ku',
    city_code: '01101',
    towns: [{ town: '北一条西', kana: 'キタイチジョウニシ', roma: 'Kitaichijonishi' }],
  },
  '9000001': {
    prefecture: '沖縄県',
    prefecture_kana: 'オキナワケン',
    prefecture_roma: 'Okinawa',
    prefecture_code: '47',
    city: '那覇市',
    city_kana: 'ナハシ',
    city_roma: 'Naha Shi',
    city_code: '47201',
    towns: [{ town: '港町', kana: 'ミナトマチ', roma: 'Minatomachi' }],
  },
};

const memCache = new Map<string, Record<string, ZipcodeEntry> | null>();

export async function lookup(zipRaw: string): Promise<LookupResult> {
  const zip = String(zipRaw || '').trim();
  if (!/^\d{7}$/.test(zip)) return { ok: false, error: 'format', zip };
  const prefix = zip.slice(0, 3);

  if (memCache.has(prefix)) {
    const dict = memCache.get(prefix);
    const entry = dict ? dict[zip] : undefined;
    return entry ? { ok: true, zip, entry, source: 'cache' } : { ok: false, error: 'not_found', zip };
  }

  try {
    const r = await fetch(`${ENDPOINT}/p/${prefix}.json`, { mode: 'cors' });
    if (r.status === 404) {
      memCache.set(prefix, null);
      return { ok: false, error: 'not_found', zip };
    }
    if (!r.ok) throw new Error('http ' + r.status);
    const dict = (await r.json()) as Record<string, ZipcodeEntry>;
    memCache.set(prefix, dict);
    const entry = dict[zip];
    return entry ? { ok: true, zip, entry, source: 'cdn' } : { ok: false, error: 'not_found', zip };
  } catch {
    const entry = FALLBACK[zip];
    if (entry) return { ok: true, zip, entry, source: 'fallback' };
    return { ok: false, error: 'offline', zip };
  }
}

export async function getMeta(): Promise<Meta | null> {
  try {
    const r = await fetch(`${ENDPOINT}/meta.json`, { mode: 'cors' });
    if (!r.ok) return null;
    return (await r.json()) as Meta;
  } catch {
    return null;
  }
}

export const examples: { zip: string; label: string }[] = [
  { zip: '2310831', label: '横浜・矢口台' },
  { zip: '1500001', label: '渋谷・神宮前' },
  { zip: '6038113', label: '京都・紫竹' },
  { zip: '5300001', label: '大阪・梅田' },
  { zip: '0600001', label: '札幌・北一条西' },
  { zip: '9000001', label: '那覇・港町' },
];
