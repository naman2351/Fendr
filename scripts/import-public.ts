import { readFileSync, writeFileSync, readdirSync, existsSync, mkdirSync } from 'node:fs';
import { basename, join } from 'node:path';
import { parseCsv, printLimited } from './validate-dataset.ts';
import { mergeDatasets, toCsv } from './merge-datasets.ts';
import type { MergeResult } from './merge-datasets.ts';

/**
 * Brings outside datasets into the ScamSaathi format and merges them with your own.
 *
 * Usage (from the Fendr folder):
 *   node scripts/import-public.ts
 *
 * It looks for:
 *   - your own files:      data/dataset_*.csv
 *   - the outside files:   data/private/raw/   (the Shade63 CSV and the bolewara JSON)
 *
 * It writes to data/private/ (which Git ignores):
 *   imported_<date>.csv          the outside rows, cleaned and converted
 *   dataset_full_<date>.csv      your rows + all imported rows
 *   dataset_publishable_<date>.csv  your rows + only the rows whose licence allows sharing
 *   audit_<source>_<date>.csv    100 random imported rows for you to check by eye
 *   import-report_<date>.txt     what happened at every step
 *
 * Options:
 *   --raw <folder>        where the outside files are      (default data/private/raw)
 *   --own <file>          one of your own CSVs; repeat for several (default data/dataset_*.csv)
 *   --out-dir <folder>    where results go                 (default data/private)
 *   --per-template <n>    max rows kept from one near-identical template (default 3)
 *   --sentinel-scam <n>   cap on Shade63 scam rows         (default 1500)
 *   --sentinel-legit <n>  cap on Shade63 legitimate rows   (default 1500)
 *   --bolewara-scam <n>   cap on bolewara scam rows        (default 700)
 *   --bolewara-legit <n>  cap on bolewara English legitimate rows (default 600)
 *   --seed <n>            random seed, so results repeat   (default 42)
 *   --overwrite           allow replacing today's output files
 *
 * Hindi and Hinglish rows are never cut by the caps, because they are the scarce ones.
 */

/* ------------------------------------------------------------------ */
/* Types and settings                                                  */
/* ------------------------------------------------------------------ */

type Row = Record<string, string>;
export type Origin = 'sentinel' | 'bolewara';
export type RawRecord = { text: string; label: 0 | 1; category?: string };
export type ParseResult = { records: RawRecord[]; skipped: number; notes: string[] };

export type BuildOptions = {
  seed: number;
  perTemplate: number;
  minLength: number;
  maxLength: number;
  caps: Record<Origin, { scam: number; legit: number }>;
};

export const DEFAULT_OPTIONS: BuildOptions = {
  seed: 42,
  perTemplate: 3,
  minLength: 15,
  maxLength: 600,
  caps: {
    sentinel: { scam: 1500, legit: 1500 },
    bolewara: { scam: 700, legit: 600 },
  },
};

const SENTINEL_CATEGORY_BY_NUMBER = [
  'legit',
  'government_impersonation',
  'financial_fraud',
  'bank_phishing',
  'romance_parcel_sextortion',
];

/* ------------------------------------------------------------------ */
/* Reading the two source formats                                      */
/* ------------------------------------------------------------------ */

export function parseLabel(value: unknown): 0 | 1 | null {
  if (typeof value === 'boolean') return value ? 1 : 0;
  if (typeof value === 'number') return value === 1 ? 1 : value === 0 ? 0 : null;
  if (typeof value !== 'string') return null;
  const v = value.trim().toLowerCase();
  if (['1', 'scam', 'spam', 'fraud', 'phishing', 'smishing', 'true', 'yes'].includes(v)) return 1;
  if (['0', 'ham', 'legit', 'legitimate', 'benign', 'not_scam', 'false', 'no'].includes(v)) return 0;
  return null;
}

/** Shade63 CSV: needs text and label; uses category_name or category when present. */
export function parseSentinelCsv(csv: string): ParseResult {
  const table = parseCsv(csv);
  const notes: string[] = [];
  if (table.length === 0) return { records: [], skipped: 0, notes: ['The CSV file is empty.'] };
  const header = table[0].map((h) => h.trim().toLowerCase());
  const iText = header.indexOf('text');
  const iLabel = header.indexOf('label');
  const iName = header.indexOf('category_name');
  const iCat = header.indexOf('category');
  if (iText === -1) {
    return { records: [], skipped: 0, notes: [`No 'text' column. Columns found: ${header.join(', ')}`] };
  }
  if (iLabel === -1 && iName === -1 && iCat === -1) {
    return { records: [], skipped: 0, notes: [`No label or category column. Columns found: ${header.join(', ')}`] };
  }
  if (iName === -1 && iCat === -1) {
    notes.push('This file has no category column, so scam types will be guessed from keywords only.');
  }

  const records: RawRecord[] = [];
  let skipped = 0;
  for (let r = 1; r < table.length; r++) {
    const cells = table[r];
    const text = (cells[iText] ?? '').trim();
    let category: string | undefined;
    if (iName !== -1 && cells[iName]) category = cells[iName].trim().toLowerCase();
    else if (iCat !== -1 && cells[iCat] !== undefined && /^\d+$/.test(cells[iCat].trim())) {
      category = SENTINEL_CATEGORY_BY_NUMBER[Number(cells[iCat].trim())];
    }
    let label = iLabel !== -1 ? parseLabel(cells[iLabel]) : null;
    if (label === null && category) label = category === 'legit' ? 0 : 1;
    if (!text || label === null) {
      skipped++;
      continue;
    }
    records.push({ text, label, category });
  }
  return { records, skipped, notes };
}

function asRecords(value: unknown): Record<string, unknown>[] | null {
  if (Array.isArray(value)) {
    return value
      .map((item) => {
        if (item && typeof item === 'object') {
          const o = item as Record<string, unknown>;
          // Hugging Face "rows" style: { row: { text, label } }
          if (o['row'] && typeof o['row'] === 'object') return o['row'] as Record<string, unknown>;
          return o;
        }
        return null;
      })
      .filter((x): x is Record<string, unknown> => x !== null);
  }
  if (value && typeof value === 'object') {
    const o = value as Record<string, unknown>;
    for (const key of ['rows', 'data', 'train', 'examples', 'records', 'items']) {
      const found = asRecords(o[key]);
      if (found) return found;
    }
  }
  return null;
}

/** bolewara JSON: a list of { text, label } objects, or the same list under a key such as rows. */
export function parseBolewaraJson(json: string): ParseResult {
  const text = json.replace(/^\uFEFF/, '').trim();
  const notes: string[] = [];
  let items: Record<string, unknown>[] | null;
  try {
    items = asRecords(JSON.parse(text));
  } catch {
    // Maybe JSON Lines: one object per line.
    const lines = text.split(/\r?\n/).filter((l) => l.trim());
    try {
      items = lines.map((l) => JSON.parse(l) as Record<string, unknown>);
      notes.push('Read as JSON Lines (one object per line).');
    } catch {
      return { records: [], skipped: 0, notes: ['Could not read this file as JSON.'] };
    }
  }
  if (!items) return { records: [], skipped: 0, notes: ['The JSON has no list of rows I recognise.'] };

  const records: RawRecord[] = [];
  let skipped = 0;
  for (const item of items) {
    const t = ['text', 'message', 'sms', 'content', 'body'].map((k) => item[k]).find((v) => typeof v === 'string');
    const l = ['label', 'class', 'target', 'is_scam'].map((k) => item[k]).find((v) => v !== undefined);
    const label = parseLabel(l);
    if (typeof t !== 'string' || !t.trim() || label === null) {
      skipped++;
      continue;
    }
    records.push({ text: t.trim(), label });
  }
  if (records.length === 0) {
    notes.push(`No usable rows. First item looked like: ${JSON.stringify(items[0] ?? null).slice(0, 150)}`);
  }
  return { records, skipped, notes };
}

/* ------------------------------------------------------------------ */
/* Cleaning text                                                       */
/* ------------------------------------------------------------------ */

const BARE_DOMAIN =
  /\b[a-z0-9][a-z0-9-]*(?:\.[a-z0-9-]+)*\.(?:com|in|co\.in|org|net|xyz|top|info|biz|ly|link|me|club|site|online|cc|app|io|gov\.in|nic\.in|click|vip|shop|live|icu|cfd|sbs|store|tech|co)\b(?:\/\S*)?/gi;

export type ScrubCounts = { link: number; email: number; upiId: number; phone: number; number: number };

export function emptyScrubCounts(): ScrubCounts {
  return { link: 0, email: 0, upiId: 0, phone: 0, number: 0 };
}

/** Replaces personal and risky details with placeholders, as the labeling guide requires. */
export function scrub(input: string, counts: ScrubCounts = emptyScrubCounts()): string {
  let t = input.normalize('NFC').replace(/\p{Cc}/gu, ' ').replace(/[\u200B-\u200D\uFEFF]/g, '');
  const swap = (re: RegExp, token: string, key: keyof ScrubCounts) => {
    t = t.replace(re, () => {
      counts[key]++;
      return token;
    });
  };
  // Full web addresses first, so tricks like https://bank.com@evil.com are removed whole.
  swap(/(?:https?:\/\/|www\.)\S+/gi, '[LINK]', 'link');
  swap(/\b[\w.+-]+@[\w-]+(?:\.[\w-]+)+\b/g, '[EMAIL]', 'email');
  swap(/\b[\w.-]{2,}@[a-z][a-z0-9]+\b/gi, '[UPI_ID]', 'upiId');
  // Bare domains such as axis-reset.net. Without this, "has a bare domain" would become a
  // shortcut for "is a scam", because fake sites are written this way far more often.
  swap(BARE_DOMAIN, '[LINK]', 'link');
  // Phone numbers must not be glued to letters (so transaction codes like TXN7721476160 are left alone).
  swap(/\b1800[\s-]?\d{3}[\s-]?\d{4}\b/g, '[PHONE]', 'phone');
  swap(/(?<![A-Za-z0-9])(?:\+?91[\s-]?)?[6-9]\d{4}[\s-]?\d{5}\b/g, '[PHONE]', 'phone');
  swap(/(?<![A-Za-z0-9])0\d{9,10}\b/g, '[PHONE]', 'phone');
  swap(/\b\d{4}\s\d{4}\s\d{4}\b/g, '[NUMBER]', 'number');
  swap(/\d{10,}/g, '[NUMBER]', 'number');
  return t.replace(/\s+/g, ' ').trim();
}

/* ------------------------------------------------------------------ */
/* Labels we can work out from the text                                */
/* ------------------------------------------------------------------ */

const HINGLISH_WORDS = new Set([
  'aap', 'aapka', 'aapke', 'aapki', 'aapko', 'hai', 'hain', 'nahi', 'nahin', 'kripya',
  'karein', 'kijiye', 'kijiyega', 'bhejein', 'bhejiye', 'mein', 'abhi', 'turant', 'jaldi',
  'paise', 'paisa', 'jama', 'jayega', 'jaayega', 'jayenge', 'milega', 'milenge', 'jeeta',
  'jeete', 'inaam', 'badhai', 'mubarak', 'dhanyavaad', 'shukriya', 'sirf', 'aaj', 'raat',
  'subah', 'ghar', 'bhai', 'yaar', 'kya', 'kaise', 'kyun', 'warna', 'varna', 'wapas',
  'vapas', 'hamara', 'mera', 'meri', 'humne', 'karna', 'karo', 'batayein', 'bataye',
  'dijiye', 'liye', 'wala', 'wali', 'hoga', 'hogi', 'rahe', 'raha', 'rahi', 'chahiye',
]);

export function detectLanguage(text: string): 'en' | 'hi' | 'hinglish' {
  const letters = text.match(/\p{L}/gu) ?? [];
  const devanagari = text.match(/[\u0900-\u097F]/g) ?? [];
  if (devanagari.length >= 3 && devanagari.length / Math.max(1, letters.length) >= 0.3) return 'hi';
  const words = text.toLowerCase().match(/[a-z]+/g) ?? [];
  const hits = new Set(words.filter((w) => HINGLISH_WORDS.has(w)));
  if (hits.size >= 2) return 'hinglish';
  if (devanagari.length > 0) return 'hi';
  return 'en';
}

const RE = {
  kyc: /\bkyc\b|\bpan\b|aadhaar|aadhar|account (?:will be )?(?:blocked|suspended|deactivated|closed)/i,
  arrest: /\b(?:cbi|ncb|police|narcotics|customs|arrest(?:ed)?|enforcement directorate|supreme court|cyber ?crime|warrant|interpol|pmla|digital (?:arrest|custody))\b/i,
  lottery: /\b(?:lottery|lucky draw|winner|won|prize|jackpot|kbc)\b|jeeta/i,
  loan: /\bloan\b|\bemi\b/i,
  job: /work from home|part[- ]?time|job offer|salary|hiring|vacancy|registration fee|data entry/i,
  invest: /\binvest(?:ment|ments|ing|or|ors)?\b|crypto|bitcoin|\btrading\b|\breturns\b|profit|\bstocks?\b|forex/i,
  delivery: /parcel|courier|customs|delivery|shipment|package/i,
  romance: /\blove\b|dating|darling|sweetheart|lonely|relationship/i,
  refund: /refund|cashback|reversal|money back/i,
};

type ScamType =
  | 'refund' | 'kyc' | 'job_fee' | 'lottery' | 'loan' | 'digital_arrest'
  | 'delivery' | 'investment' | 'romance' | 'other';

export function guessScamType(text: string, category?: string): ScamType {
  const t = text;
  switch (category) {
    case 'government_impersonation':
      if (RE.refund.test(t)) return 'refund';
      return RE.arrest.test(t) ? 'digital_arrest' : 'other';
    case 'financial_fraud':
      // Some arrest-style scripts are filed under financial fraud in the source data.
      if (RE.arrest.test(t) && !RE.delivery.test(t)) return 'digital_arrest';
      if (RE.lottery.test(t)) return 'lottery';
      if (RE.loan.test(t)) return 'loan';
      if (RE.job.test(t)) return 'job_fee';
      if (RE.invest.test(t)) return 'investment';
      return 'other';
    case 'bank_phishing':
      return RE.kyc.test(t) ? 'kyc' : 'other';
    case 'romance_parcel_sextortion':
      if (RE.delivery.test(t)) return 'delivery';
      return RE.romance.test(t) ? 'romance' : 'other';
    default:
      if (RE.kyc.test(t)) return 'kyc';
      if (RE.arrest.test(t)) return 'digital_arrest';
      if (RE.lottery.test(t)) return 'lottery';
      if (RE.loan.test(t)) return 'loan';
      if (RE.job.test(t)) return 'job_fee';
      if (RE.invest.test(t)) return 'investment';
      if (RE.delivery.test(t)) return 'delivery';
      if (RE.romance.test(t)) return 'romance';
      if (RE.refund.test(t)) return 'refund';
      return 'other';
  }
}

const HARD_NEGATIVE =
  /\b(?:otp|a\/c|account|kyc|upi|debit(?:ed)?|credit(?:ed)?|refund|bank|loan|bill|due|delivery|delivered|order|recharge|card|transaction|balance|payment|paid|rs\.?|inr)\b|₹/i;

/* ------------------------------------------------------------------ */
/* Finding near-identical templates (MinHash)                          */
/* ------------------------------------------------------------------ */

function skeleton(text: string): string {
  return text
    .toLowerCase()
    .replace(/\[[a-z_]+\]/g, ' ')
    .replace(/\d+/g, '0')
    .replace(/[^\p{L}\p{N}\s]/gu, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function fnv1a(s: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return h >>> 0;
}

function mix(x: number, seed: number): number {
  let h = (x ^ seed) >>> 0;
  h = Math.imul(h ^ (h >>> 16), 0x85ebca6b) >>> 0;
  h = Math.imul(h ^ (h >>> 13), 0xc2b2ae35) >>> 0;
  return (h ^ (h >>> 16)) >>> 0;
}

const HASHES = 48;
const ROWS_PER_BAND = 4;
const SEEDS = Array.from({ length: HASHES }, (_, i) => Math.imul(i + 1, 0x9e3779b1) >>> 0);

function shingles(skel: string): Set<string> {
  const words = skel.split(' ').filter(Boolean);
  if (words.length < 2) return new Set(words);
  const set = new Set<string>();
  for (let i = 0; i < words.length - 1; i++) set.add(words[i] + ' ' + words[i + 1]);
  return set;
}

function jaccard(a: Set<string>, b: Set<string>): number {
  if (a.size === 0 && b.size === 0) return 1;
  let inter = 0;
  for (const x of a) if (b.has(x)) inter++;
  return inter / (a.size + b.size - inter);
}

/** Returns a cluster number for every text. Near-identical messages share a number. */
export function clusterTemplates(texts: string[], threshold = 0.7): number[] {
  const parent = texts.map((_, i) => i);
  const find = (i: number): number => {
    while (parent[i] !== i) {
      parent[i] = parent[parent[i]];
      i = parent[i];
    }
    return i;
  };
  const union = (a: number, b: number) => {
    const ra = find(a);
    const rb = find(b);
    if (ra !== rb) parent[Math.max(ra, rb)] = Math.min(ra, rb);
  };

  // Identical skeletons are the same template. Then look for near matches
  // among the distinct skeletons only.
  const skels = texts.map(skeleton);
  const firstWithSkeleton = new Map<string, number>();
  const unique: number[] = [];
  skels.forEach((s, i) => {
    const seen = firstWithSkeleton.get(s);
    if (seen === undefined) {
      firstWithSkeleton.set(s, i);
      unique.push(i);
    } else {
      union(seen, i);
    }
  });

  const sets = new Map<number, Set<string>>();
  const buckets = new Map<string, number[]>();
  for (const i of unique) {
    const set = shingles(skels[i]);
    sets.set(i, set);
    if (set.size === 0) continue;
    const base = [...set].map(fnv1a);
    const signature = SEEDS.map((seed) => base.reduce((min, h) => Math.min(min, mix(h, seed)), 0xffffffff));
    for (let b = 0; b < HASHES / ROWS_PER_BAND; b++) {
      const key = `${b}:${signature.slice(b * ROWS_PER_BAND, (b + 1) * ROWS_PER_BAND).join(',')}`;
      const list = buckets.get(key);
      if (list) list.push(i);
      else buckets.set(key, [i]);
    }
  }
  for (const members of buckets.values()) {
    for (let m = 1; m < members.length; m++) {
      const a = sets.get(members[m]);
      if (!a) continue;
      for (let k = 0; k < Math.min(m, 10); k++) {
        const b = sets.get(members[k]);
        if (b && find(members[m]) !== find(members[k]) && jaccard(a, b) >= threshold) {
          union(members[m], members[k]);
          break;
        }
      }
    }
  }
  return texts.map((_, i) => find(i));
}

/* ------------------------------------------------------------------ */
/* Random choice that repeats (seeded)                                 */
/* ------------------------------------------------------------------ */

function rng(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function shuffled<T>(items: T[], random: () => number): T[] {
  const a = items.slice();
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

/* ------------------------------------------------------------------ */
/* Converting one outside source                                       */
/* ------------------------------------------------------------------ */

type Candidate = {
  text: string;
  isScam: 0 | 1;
  category?: string;
  language: 'en' | 'hi' | 'hinglish';
  cluster: number;
};

export type OriginResult = {
  origin: Origin;
  rows: Row[];
  audit: Row[];
  report: string[];
};

const AUDIT_COLUMNS = ['text', 'is_scam', 'scam_type', 'language', 'group_id', 'my_verdict'];

export function processOrigin(origin: Origin, parsed: ParseResult, options: BuildOptions): OriginResult {
  const random = rng(options.seed);
  const report: string[] = [`=== ${origin} ===`];
  const line = (s: string) => report.push(s);
  parsed.notes.forEach((n) => line(`Note: ${n}`));
  line(`Rows read: ${parsed.records.length} (${parsed.skipped} skipped: empty text or unreadable label)`);

  // 1. Clean the text and drop rows that are too short or too long.
  const counts = emptyScrubCounts();
  let tooShort = 0;
  let tooLong = 0;
  const cleaned: { text: string; isScam: 0 | 1; category?: string }[] = [];
  for (const rec of parsed.records) {
    const text = scrub(rec.text, counts);
    if (text.length < options.minLength) tooShort++;
    else if (text.length > options.maxLength) tooLong++;
    else cleaned.push({ text, isScam: rec.label, category: rec.category });
  }
  line(`Cleaning replaced: ${counts.link} links, ${counts.email} emails, ${counts.upiId} UPI IDs, ${counts.phone} phone numbers, ${counts.number} long numbers`);
  line(`Dropped: ${tooShort} shorter than ${options.minLength} characters, ${tooLong} longer than ${options.maxLength}`);

  // 2. Remove exact duplicates, and messages that appear with both labels.
  const byKey = new Map<string, { index: number; label: 0 | 1; conflicted: boolean }>();
  const kept: typeof cleaned = [];
  let duplicates = 0;
  let conflicts = 0;
  for (const c of cleaned) {
    const key = c.text.toLowerCase().replace(/\s+/g, ' ');
    const seen = byKey.get(key);
    if (!seen) {
      byKey.set(key, { index: kept.length, label: c.isScam, conflicted: false });
      kept.push(c);
    } else if (seen.label !== c.isScam && !seen.conflicted) {
      seen.conflicted = true;
      conflicts++;
      duplicates++;
    } else {
      duplicates++;
    }
  }
  const dropIndexes = new Set([...byKey.values()].filter((v) => v.conflicted).map((v) => v.index));
  const unique = kept.filter((_, i) => !dropIndexes.has(i));
  line(`Exact duplicates removed: ${duplicates - conflicts}. Messages with conflicting labels removed: ${conflicts}`);

  // 3. Work out language and find near-identical templates.
  const clusters = clusterTemplates(unique.map((u) => u.text));
  const candidates: Candidate[] = unique.map((u, i) => ({
    text: u.text,
    isScam: u.isScam,
    category: u.category,
    language: detectLanguage(u.text),
    cluster: clusters[i],
  }));
  const clusterSizes = new Map<number, number>();
  candidates.forEach((c) => clusterSizes.set(c.cluster, (clusterSizes.get(c.cluster) ?? 0) + 1));
  line(`Distinct templates found: ${clusterSizes.size} (from ${candidates.length} messages)`);
  [...clusterSizes.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, 3)
    .forEach(([cluster, size]) => {
      const example = candidates.find((c) => c.cluster === cluster)?.text.slice(0, 70) ?? '';
      line(`  Biggest templates: ${size} messages like "${example}..."`);
    });

  // 4. Keep at most a few rows per template.
  const perCluster = new Map<number, Candidate[]>();
  candidates.forEach((c) => {
    const list = perCluster.get(c.cluster);
    if (list) list.push(c);
    else perCluster.set(c.cluster, [c]);
  });
  let afterTemplateCap: Candidate[] = [];
  for (const list of perCluster.values()) {
    afterTemplateCap = afterTemplateCap.concat(shuffled(list, random).slice(0, options.perTemplate));
  }
  line(`After keeping at most ${options.perTemplate} per template: ${afterTemplateCap.length}`);

  // 5. Apply the caps. Hindi and Hinglish are never cut.
  const protectedRows = afterTemplateCap.filter((c) => c.language !== 'en');
  const english = afterTemplateCap.filter((c) => c.language === 'en');

  const scamEnglish = english.filter((c) => c.isScam === 1);
  const legitEnglish = shuffled(english.filter((c) => c.isScam === 0), random);
  const cap = options.caps[origin];

  // Scam rows: take one from each category in turn, so rare categories are not squeezed out.
  const byCategory = new Map<string, Candidate[]>();
  scamEnglish.forEach((c) => {
    const key = c.category ?? 'none';
    const list = byCategory.get(key);
    if (list) list.push(c);
    else byCategory.set(key, [c]);
  });
  const queues = [...byCategory.values()].map((l) => shuffled(l, random));
  const pickedScam: Candidate[] = [];
  while (pickedScam.length < cap.scam && queues.some((q) => q.length > 0)) {
    for (const q of queues) {
      const next = q.shift();
      if (next && pickedScam.length < cap.scam) pickedScam.push(next);
    }
  }
  const pickedLegit = legitEnglish.slice(0, cap.legit);
  const selected = [...protectedRows, ...pickedScam, ...pickedLegit];
  line(`After caps (scam ${cap.scam}, English legitimate ${cap.legit}, Hindi/Hinglish never cut): ${selected.length}`);

  // 6. Build the final rows.
  const clusterNumber = new Map<number, number>();
  const rows: Row[] = selected.map((c) => {
    if (!clusterNumber.has(c.cluster)) clusterNumber.set(c.cluster, clusterNumber.size + 1);
    const groupId = `${origin}-t${String(clusterNumber.get(c.cluster)).padStart(4, '0')}`;
    return {
      text: c.text,
      is_scam: String(c.isScam),
      scam_type: c.isScam === 1 ? guessScamType(c.text, c.category) : 'none',
      tactics: '',
      language: c.language,
      source: 'public',
      group_id: groupId,
      reviewed: 'no',
      hard_negative: c.isScam === 0 && HARD_NEGATIVE.test(c.text) ? '1' : '0',
    };
  });

  const total = rows.length;
  const count = (f: (r: Row) => boolean) => rows.filter(f).length;
  line(`Final: ${total} rows. Scam ${count((r) => r['is_scam'] === '1')}, legitimate ${count((r) => r['is_scam'] === '0')}, hard negatives ${count((r) => r['hard_negative'] === '1')}`);
  line(`Languages: English ${count((r) => r['language'] === 'en')}, Hinglish ${count((r) => r['language'] === 'hinglish')}, Hindi ${count((r) => r['language'] === 'hi')}`);
  const types = new Map<string, number>();
  rows.filter((r) => r['is_scam'] === '1').forEach((r) => types.set(r['scam_type'], (types.get(r['scam_type']) ?? 0) + 1));
  line(`Scam types (guessed from keywords, so rough): ${[...types.entries()].map(([k, v]) => `${k} ${v}`).join(', ') || 'none'}`);
  if (total > 0 && count((r) => r['language'] !== 'en') === 0) {
    line('Warning: no Hindi or Hinglish rows found. This source adds English only.');
  }

  const audit: Row[] = shuffled(rows, random)
    .slice(0, 100)
    .map((r) => ({
      text: r['text'], is_scam: r['is_scam'], scam_type: r['scam_type'],
      language: r['language'], group_id: r['group_id'], my_verdict: '',
    }));

  return { origin, rows, audit, report };
}

/* ------------------------------------------------------------------ */
/* The whole job: import, merge with your own files                    */
/* ------------------------------------------------------------------ */

export type PipelineInput = {
  sentinel?: ParseResult;
  bolewara?: ParseResult;
  own: { name: string; csv: string }[];
  stamp: string;
  options?: BuildOptions;
};

export type PipelineResult = {
  results: OriginResult[];
  importedCsv: string;
  full: MergeResult;
  publishable: MergeResult;
};

export function runPipeline(input: PipelineInput): PipelineResult {
  const options = input.options ?? DEFAULT_OPTIONS;
  const results: OriginResult[] = [];
  if (input.sentinel) results.push(processOrigin('sentinel', input.sentinel, options));
  if (input.bolewara) results.push(processOrigin('bolewara', input.bolewara, options));

  const allRows = results.flatMap((r) => r.rows);
  const importedCsv = toCsv(allRows);
  const importedName = `imported_${input.stamp}.csv`;
  const publishableRows = allRows.filter((r) => !r['group_id'].startsWith('sentinel-'));

  const full = mergeDatasets(
    [...input.own, { name: importedName, csv: importedCsv }],
    { keepGroups: true },
  );
  const publishable = mergeDatasets(
    [...input.own, { name: importedName, csv: toCsv(publishableRows) }],
    { keepGroups: true },
  );
  return { results, importedCsv, full, publishable };
}

/* ------------------------------------------------------------------ */
/* Command line                                                        */
/* ------------------------------------------------------------------ */

function today(): string {
  const d = new Date();
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

function csvField(v: string): string {
  return /[",\r\n]/.test(v) ? '"' + v.replace(/"/g, '""') + '"' : v;
}

function auditCsv(rows: Row[]): string {
  const lines = [AUDIT_COLUMNS.join(',')];
  rows.forEach((r) => lines.push(AUDIT_COLUMNS.map((c) => csvField(r[c] ?? '')).join(',')));
  return lines.join('\n') + '\n';
}

function readText(path: string): string {
  return readFileSync(path, 'utf-8');
}

function findRawFiles(dir: string): { sentinel?: string; bolewara?: string; notes: string[] } {
  const notes: string[] = [];
  if (!existsSync(dir)) return { notes: [`The folder '${dir}' does not exist.`] };
  const files = readdirSync(dir);
  const csvs = files.filter((f) => /\.csv$/i.test(f));
  const jsons = files.filter((f) => /\.jsonl?$/i.test(f));

  let sentinel: string | undefined;
  const withCategory = csvs.filter((f) => {
    try {
      const head = parseCsv(readText(join(dir, f)).slice(0, 4000))[0] ?? [];
      return head.map((h) => h.trim().toLowerCase()).some((h) => h === 'category' || h === 'category_name');
    } catch {
      return false;
    }
  });
  if (withCategory.length > 0) sentinel = join(dir, withCategory[0]);
  else if (csvs.length > 0) {
    sentinel = join(dir, csvs[0]);
    notes.push(`Using '${csvs[0]}' (it has no category column).`);
  }
  if (csvs.length > 1) notes.push(`Several CSV files found (${csvs.join(', ')}). Using '${basename(sentinel ?? '')}'.`);

  const bolewara = jsons.length > 0 ? join(dir, jsons[0]) : undefined;
  if (jsons.length > 1) notes.push(`Several JSON files found (${jsons.join(', ')}). Using '${jsons[0]}'.`);
  return { sentinel, bolewara, notes };
}

function runCli(args: string[]): void {
  const opts: BuildOptions = JSON.parse(JSON.stringify(DEFAULT_OPTIONS)) as BuildOptions;
  let rawDir = 'data/private/raw';
  let outDir = 'data/private';
  let overwrite = false;
  const ownFiles: string[] = [];
  const num = (v: string | undefined, fallback: number) => (v !== undefined && /^\d+$/.test(v) ? Number(v) : fallback);

  for (let i = 0; i < args.length; i++) {
    const a = args[i];
    const v = args[i + 1];
    if (a === '--raw') rawDir = args[++i] ?? rawDir;
    else if (a === '--out-dir') outDir = args[++i] ?? outDir;
    else if (a === '--own') ownFiles.push(args[++i]);
    else if (a === '--overwrite') overwrite = true;
    else if (a === '--seed') opts.seed = num(args[++i], opts.seed);
    else if (a === '--per-template') opts.perTemplate = num(args[++i], opts.perTemplate);
    else if (a === '--sentinel-scam') opts.caps.sentinel.scam = num(args[++i], opts.caps.sentinel.scam);
    else if (a === '--sentinel-legit') opts.caps.sentinel.legit = num(args[++i], opts.caps.sentinel.legit);
    else if (a === '--bolewara-scam') opts.caps.bolewara.scam = num(args[++i], opts.caps.bolewara.scam);
    else if (a === '--bolewara-legit') opts.caps.bolewara.legit = num(args[++i], opts.caps.bolewara.legit);
    else {
      console.log(`Unknown option '${a}'${v ? '' : ''}. See the comments at the top of scripts/import-public.ts.`);
      process.exit(1);
    }
  }

  // Your own files.
  let own = ownFiles;
  if (own.length === 0 && existsSync('data')) {
    own = readdirSync('data')
      .filter((f) => /^dataset_.*\.csv$/i.test(f))
      .map((f) => join('data', f));
  }
  if (own.length === 0) {
    console.log("No files of your own found. Put your CSV in the data folder (its name must start with 'dataset_'), or pass --own <file>.");
    process.exit(1);
  }

  // The outside files.
  const found = findRawFiles(rawDir);
  console.log('\nLooking in', rawDir);
  found.notes.forEach((n) => console.log('  - ' + n));
  if (!found.sentinel && !found.bolewara) {
    console.log(`No outside files found in '${rawDir}'. Put the Shade63 CSV and the bolewara JSON there.`);
    process.exit(1);
  }

  let sentinel: ParseResult | undefined;
  let bolewara: ParseResult | undefined;
  if (found.sentinel) {
    console.log(`  Shade63 file:   ${found.sentinel}`);
    sentinel = parseSentinelCsv(readText(found.sentinel));
  } else console.log('  Shade63 file:   not found, skipping');
  if (found.bolewara) {
    console.log(`  bolewara file:  ${found.bolewara}`);
    bolewara = parseBolewaraJson(readText(found.bolewara));
  } else console.log('  bolewara file:  not found, skipping');

  const stamp = today();
  const result = runPipeline({
    sentinel,
    bolewara,
    own: own.map((f) => ({ name: basename(f), csv: readText(f) })),
    stamp,
    options: opts,
  });

  // Report.
  const reportLines: string[] = [`ScamSaathi import report, ${stamp}`, '', `Your own files: ${own.map((f) => basename(f)).join(', ')}`, ''];
  result.results.forEach((r) => {
    reportLines.push(...r.report, '');
  });
  for (const [label, merged] of [['FULL', result.full], ['PUBLISHABLE', result.publishable]] as const) {
    reportLines.push(`=== Merge: ${label} ===`);
    if (merged.errors.length) reportLines.push(...merged.errors.map((e) => 'ERROR: ' + e));
    else {
      reportLines.push(`Rows: ${merged.rowCount}. Duplicates dropped: ${merged.duplicatesDropped}. Conflicts: ${merged.conflicts.length}`);
      merged.conflicts.forEach((c) => reportLines.push('Conflict: ' + c));
      reportLines.push(...merged.summary);
    }
    reportLines.push('');
  }

  console.log('');
  result.results.forEach((r) => {
    r.report.forEach((l) => console.log(l));
    console.log('');
  });

  if (result.full.errors.length) {
    console.log('Cannot write the merged files. Fix these first:');
    printLimited(result.full.errors);
    process.exit(1);
  }

  if (!existsSync(outDir)) mkdirSync(outDir, { recursive: true });
  const targets = {
    imported: join(outDir, `imported_${stamp}.csv`),
    full: join(outDir, `dataset_full_${stamp}.csv`),
    publishable: join(outDir, `dataset_publishable_${stamp}.csv`),
    report: join(outDir, `import-report_${stamp}.txt`),
  };
  const all = Object.values(targets);
  if (!overwrite && all.some((t) => existsSync(t))) {
    console.log(`Today's output files already exist in '${outDir}'. Add --overwrite to replace them.`);
    process.exit(1);
  }

  writeFileSync(targets.imported, '\uFEFF' + result.importedCsv, 'utf-8');
  writeFileSync(targets.full, '\uFEFF' + result.full.csv, 'utf-8');
  if (!result.publishable.errors.length) writeFileSync(targets.publishable, '\uFEFF' + result.publishable.csv, 'utf-8');
  writeFileSync(targets.report, reportLines.join('\n') + '\n', 'utf-8');
  for (const r of result.results) {
    writeFileSync(join(outDir, `audit_${r.origin}_${stamp}.csv`), '\uFEFF' + auditCsv(r.audit), 'utf-8');
  }

  console.log('MERGE RESULT');
  console.log(`  Full dataset:        ${result.full.rowCount} rows -> ${targets.full}`);
  if (!result.publishable.errors.length) {
    console.log(`  Publishable subset:  ${result.publishable.rowCount} rows -> ${targets.publishable}`);
  }
  console.log(`  Duplicates dropped:  ${result.full.duplicatesDropped}`);
  if (result.full.conflicts.length) {
    console.log(`  Label conflicts (both copies removed): ${result.full.conflicts.length}`);
    printLimited(result.full.conflicts, 10);
  }
  console.log('\nPROGRESS');
  result.full.summary.forEach((s) => console.log('  ' + s));
  console.log(`\nAudit samples for you to check (fill in the my_verdict column):`);
  result.results.forEach((r) => console.log(`  ${join(outDir, `audit_${r.origin}_${stamp}.csv`)}`));
  console.log(`\nFull report: ${targets.report}`);
  console.log('\nRESULT: import finished.');
}

if (process.argv[1] && basename(process.argv[1]) === 'import-public.ts') {
  runCli(process.argv.slice(2));
}