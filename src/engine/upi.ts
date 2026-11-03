import type { Signal } from './types';

/* ------------------------------------------------------------------ */
/* Settings you can tune                                               */
/* ------------------------------------------------------------------ */

/** Inputs longer than this are rejected (protects the app from huge pastes). */
export const MAX_INPUT_LENGTH = 2048;

/** Amounts above this get an "unusual amount" warning (rupees). */
export const UNUSUAL_AMOUNT = 100000;

/* ------------------------------------------------------------------ */
/* Types                                                               */
/* ------------------------------------------------------------------ */

export type ParsedUpi = {
  valid: boolean;
  errors: string[]; // reasons the link is unusable
  warnings: string[]; // things worth noting, link still usable
  action?: string; // normally 'pay'
  payeeAddress?: string; // pa: the UPI ID that receives the money
  payeeName?: string; // pn
  amount?: number; // am
  currency?: string; // cu
  note?: string; // tn
  merchantCode?: string; // mc
  hasMerchantCode: boolean;
};

export type ReceiveIntent = {
  matched: boolean;
  phrases: string[]; // the phrases that triggered the match
};

export type PaymentContext = {
  message?: string; // the text that came with the QR or link
  shopName?: string; // the shop name the user can see in person
};

export type PaymentAnalysis = {
  parsed: ParsedUpi;
  signal: Signal;
  explanation: string; // plain English sentence (Hinglish comes via templates later)
  receiveIntent: ReceiveIntent;
};

/* ------------------------------------------------------------------ */
/* Parsing                                                             */
/* ------------------------------------------------------------------ */

const SCHEME = /^upi:\/\/([a-z]+)\?(.*)$/i;
const VPA = /^[a-z0-9][a-z0-9._-]{1,255}@[a-z][a-z0-9]{1,63}$/i;

function decode(value: string): { text: string; ok: boolean } {
  try {
    return { text: decodeURIComponent(value), ok: true };
  } catch {
    return { text: value, ok: false };
  }
}

export function parseUpi(input: string): ParsedUpi {
  const result: ParsedUpi = {
    valid: false,
    errors: [],
    warnings: [],
    hasMerchantCode: false,
  };

  if (input.length > MAX_INPUT_LENGTH) {
    result.errors.push('too_long');
    return result;
  }

  const match = SCHEME.exec(input.trim());
  if (!match) {
    result.errors.push('not_upi');
    return result;
  }

  const action = match[1].toLowerCase();
  result.action = action;
  if (action !== 'pay') {
    result.errors.push('unsupported_action');
    return result;
  }

  const params = new Map<string, string>();
  for (const part of match[2].split('&')) {
    if (!part) continue;
    const eq = part.indexOf('=');
    const rawKey = eq === -1 ? part : part.slice(0, eq);
    const rawValue = eq === -1 ? '' : part.slice(eq + 1);
    const key = decode(rawKey).text.toLowerCase();
    const value = decode(rawValue);
    if (!value.ok && !result.warnings.includes('malformed_encoding')) {
      result.warnings.push('malformed_encoding');
    }
    if (!params.has(key)) params.set(key, value.text.trim());
  }

  // Payee address (required)
  const pa = params.get('pa');
  if (!pa) {
    result.errors.push('missing_payee');
  } else if (!VPA.test(pa)) {
    result.errors.push('bad_payee_format');
  } else {
    result.payeeAddress = pa.toLowerCase();
  }

  // Payee name, note, merchant code
  const pn = params.get('pn');
  if (pn) result.payeeName = pn.slice(0, 100);
  const tn = params.get('tn');
  if (tn) result.note = tn.slice(0, 200);
  const mc = params.get('mc');
  if (mc) {
    result.merchantCode = mc.slice(0, 10);
    result.hasMerchantCode = true;
  }

  // Amount (optional, but must be sensible if present)
  const am = params.get('am');
  if (am) {
    if (/^\d+(\.\d{1,2})?$/.test(am) && Number(am) > 0) {
      result.amount = Number(am);
      if (result.amount > UNUSUAL_AMOUNT) result.warnings.push('unusual_amount');
    } else {
      result.errors.push('bad_amount');
    }
  }

  // Currency
  const cu = params.get('cu');
  if (cu) {
    result.currency = cu.toUpperCase();
    if (result.currency !== 'INR') result.warnings.push('non_inr_currency');
  }

  result.valid = result.errors.length === 0;
  return result;
}

/* ------------------------------------------------------------------ */
/* Story keyword lists (REVIEW AND EXTEND THESE YOURSELF)              */
/* ------------------------------------------------------------------ */

// Phrases that promise you will RECEIVE money. Lowercase.
const RECEIVE_TERMS = [
  'refund',
  'cashback',
  'cash back',
  'prize',
  'reward',
  'lottery',
  'winner',
  'claim',
  'will be credited',
  'credited to your account',
  'receive money',
  'receive payment',
  'scan to receive',
  'scan to get',
  'money back',
  'paise milenge',
  'paise aa jayenge',
  'paise aayenge',
  'paisa milega',
  'account me aa jayenge',
  'account mein aa jayenge',
  'wapas milenge',
  'vapas milenge',
  'refund milega',
  'inaam',
  'रिफंड',
  'कैशबैक',
  'इनाम',
  'पैसे मिलेंगे',
  'पैसे आ जाएंगे',
  'वापस मिलेंगे',
  'पैसा मिलेगा',
];

// Words suggesting the sender claims to be an organisation or authority.
const ORGANISATION_TERMS = [
  'bank',
  'sbi',
  'hdfc',
  'icici',
  'axis',
  'paytm',
  'phonepe',
  'gpay',
  'amazon',
  'flipkart',
  'irctc',
  'npci',
  'rbi',
  'uidai',
  'epfo',
  'customs',
  'police',
  'courier',
  'delivery',
  'electricity',
  'bijli',
  'government',
  'income tax',
  'rto',
  'challan',
  'kyc',
  'insurance',
  'airtel',
  'jio',
  'officer',
  'department',
];

// Words that suggest a payee NAME belongs to a business, not a person.
const BUSINESS_NAME_WORDS = new Set([
  'store', 'stores', 'mart', 'traders', 'trading', 'enterprises', 'enterprise',
  'services', 'service', 'pvt', 'ltd', 'limited', 'shop', 'bakery', 'sweets',
  'restaurant', 'hotel', 'medical', 'pharmacy', 'cafe', 'tea', 'stall',
  'general', 'agency', 'solutions', 'tech', 'technologies', 'electronics',
  'garments', 'mobile', 'mobiles', 'foods', 'kirana', 'dairy', 'fuel',
  'petrol', 'travels', 'tours', 'clinic', 'hospital', 'school', 'college',
  'institute', 'center', 'centre', 'bank', 'payments', 'pay', 'wallet',
  'online',
]);

// UPI ID words that look like fake support or reward desks.
const HANDLE_WORDS = new Set([
  'refund', 'support', 'care', 'helpdesk', 'help', 'kyc', 'customer',
  'official', 'claim', 'reward', 'cashback', 'prize', 'lottery', 'verify',
  'update',
]);
const HANDLE_WORD_SUBSTRINGS = ['refund', 'support', 'helpdesk', 'customercare', 'cashback'];

// Brands scammers imitate. Short brands must match a whole word.
const BRAND_EXACT = new Set(['sbi', 'rbi', 'pnb', 'bob', 'npci']);
const BRAND_SUBSTRINGS = [
  'hdfc', 'icici', 'paytm', 'phonepe', 'googlepay', 'amazon', 'flipkart',
  'irctc', 'uidai', 'epfo', 'kotak', 'axisbank',
];

/* ------------------------------------------------------------------ */
/* Helpers                                                             */
/* ------------------------------------------------------------------ */

function escapeRegex(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/**
 * Finds which terms appear in the text. ASCII terms must start at a word
 * boundary (so 'claim' does not match 'proclaim'). Non-ASCII terms are plain
 * substring matches, because \b does not work for Devanagari.
 */
function findTerms(text: string, terms: string[]): string[] {
  const lower = text.toLowerCase().replace(/\s+/g, ' ');
  const found: string[] = [];
  for (const term of terms) {
    const isAscii = /^[ -~]+$/.test(term); // printable ASCII only
    if (isAscii) {
      const pattern = new RegExp(
        '(?:^|[^a-z])' + escapeRegex(term).replace(/ /g, '\\s+'),
      );
      if (pattern.test(lower)) found.push(term);
    } else if (lower.includes(term)) {
      found.push(term);
    }
  }
  return found;
}

export function detectReceiveIntent(text: string): ReceiveIntent {
  const phrases = findTerms(text.slice(0, MAX_INPUT_LENGTH), RECEIVE_TERMS);
  return { matched: phrases.length > 0, phrases };
}

function mentionsOrganisation(text: string): boolean {
  return findTerms(text.slice(0, MAX_INPUT_LENGTH), ORGANISATION_TERMS).length > 0;
}

function looksLikePerson(name: string): boolean {
  const tokens = name.trim().split(/\s+/);
  if (tokens.length < 2 || tokens.length > 3) return false;
  return tokens.every(
    (t) => /^\p{L}+$/u.test(t) && !BUSINESS_NAME_WORDS.has(t.toLowerCase()),
  );
}

function handleRisk(address: string): { risk: number; wordHit: boolean; brandHit: boolean } {
  const local = address.split('@')[0].toLowerCase();
  const tokens = local.split(/[._\-\d]+/).filter(Boolean);
  const wordHit =
    tokens.some((t) => HANDLE_WORDS.has(t)) ||
    HANDLE_WORD_SUBSTRINGS.some((w) => local.includes(w));
  const brandHit =
    tokens.some((t) => BRAND_EXACT.has(t)) ||
    BRAND_SUBSTRINGS.some((b) => local.includes(b));
  let risk = 0;
  if (wordHit && brandHit) risk = 0.6;
  else if (brandHit) risk = 0.45;
  else if (wordHit) risk = 0.35;
  return { risk, wordHit, brandHit };
}

function levenshtein(a: string, b: string): number {
  if (a === b) return 0;
  if (!a.length) return b.length;
  if (!b.length) return a.length;
  let prev = Array.from({ length: b.length + 1 }, (_, i) => i);
  for (let i = 1; i <= a.length; i++) {
    const row = [i];
    for (let j = 1; j <= b.length; j++) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      row[j] = Math.min(prev[j] + 1, row[j - 1] + 1, prev[j - 1] + cost);
    }
    prev = row;
  }
  return prev[b.length];
}

function similarity(a: string, b: string): number {
  const longest = Math.max(a.length, b.length);
  return longest === 0 ? 1 : 1 - levenshtein(a, b) / longest;
}

function normalizeName(s: string): string {
  return s
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\s]/gu, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

/**
 * Do two shop or payee names refer to roughly the same thing?
 * Lenient on purpose: a small typo or one shared word counts as a match.
 */
export function namesMatch(a: string, b: string): boolean {
  const na = normalizeName(a);
  const nb = normalizeName(b);
  if (!na || !nb) return true; // cannot judge, so do not raise a flag
  if (similarity(na, nb) >= 0.8) return true;
  const ta = na.split(' ');
  const tb = nb.split(' ');
  const hits = ta.filter((t) => tb.some((u) => similarity(t, u) >= 0.8)).length;
  return hits / Math.min(ta.length, tb.length) >= 0.5;
}

/* ------------------------------------------------------------------ */
/* Plain-language explanation                                          */
/* ------------------------------------------------------------------ */

export function explainPayment(parsed: ParsedUpi): string {
  if (!parsed.valid || !parsed.payeeAddress) {
    return 'This does not look like a valid UPI payment link.';
  }
  const who = parsed.payeeName
    ? `${parsed.payeeName} (${parsed.payeeAddress})`
    : parsed.payeeAddress;
  if (parsed.amount !== undefined) {
    const amount = `₹${parsed.amount.toLocaleString('en-IN')}`;
    return `This will take ${amount} from you and send it to ${who}. It will not send you money.`;
  }
  return `This asks you to send money to ${who}. You will enter the amount yourself. It will not send you money.`;
}

/* ------------------------------------------------------------------ */
/* The detector                                                        */
/* ------------------------------------------------------------------ */

type Component = { reason: string; risk: number };

export function analyzePayment(input: string, context: PaymentContext = {}): PaymentAnalysis {
  const parsed = parseUpi(input);
  const message = context.message ?? '';
  const receiveIntent = detectReceiveIntent(message);

  if (!parsed.valid || !parsed.payeeAddress) {
    return {
      parsed,
      receiveIntent,
      explanation: explainPayment(parsed),
      signal: {
        detector: 'payment',
        risk: 0.2,
        confidence: 0.5,
        reasons: ['invalid_link'],
        evidence: [],
      },
    };
  }

  const components: Component[] = [];
  const evidence: string[] = [`UPI ID: ${parsed.payeeAddress}`];

  // Rule 1: the story says you will receive money, but this is a pay link.
  if (receiveIntent.matched) {
    components.push({
      reason: 'receive_but_pays',
      risk: parsed.amount !== undefined ? 0.98 : 0.95,
    });
    if (parsed.amount !== undefined) {
      components.push({ reason: 'prefilled_amount', risk: 0 });
    }
    evidence.push(...receiveIntent.phrases.map((p) => `Message says: ${p}`));
  }

  // Rule 2: a personal account posing as a business or authority.
  if (
    message &&
    mentionsOrganisation(message) &&
    parsed.payeeName &&
    !parsed.hasMerchantCode &&
    looksLikePerson(parsed.payeeName)
  ) {
    components.push({ reason: 'personal_for_business', risk: 0.55 });
    evidence.push(`Payee name looks like a person: ${parsed.payeeName}`);
  }

  // Rule 3: UPI ID looks like a fake support desk or imitates a brand.
  const handle = handleRisk(parsed.payeeAddress);
  if (handle.risk > 0) {
    components.push({ reason: 'lookalike_handle', risk: handle.risk });
  }

  // Rule 4: the name the user sees in person differs from the payee name.
  if (
    context.shopName &&
    parsed.payeeName &&
    !namesMatch(context.shopName, parsed.payeeName)
  ) {
    components.push({ reason: 'name_mismatch', risk: 0.7 });
    evidence.push(`Shop says: ${context.shopName}; QR says: ${parsed.payeeName}`);
  }

  // Unusually large amount.
  if (parsed.warnings.includes('unusual_amount')) {
    components.push({ reason: 'unusual_amount', risk: 0.25 });
  }

  let risk = 1 - components.reduce((acc, c) => acc * (1 - c.risk), 1);
  if (components.some((c) => c.reason === 'receive_but_pays')) {
    risk = Math.max(risk, 0.95);
  }
  if (components.length === 0) risk = 0.1;
  risk = Math.round(Math.min(1, Math.max(0, risk)) * 100) / 100;

  return {
    parsed,
    receiveIntent,
    explanation: explainPayment(parsed),
    signal: {
      detector: 'payment',
      risk,
      confidence: components.length > 0 ? 0.9 : 0.5,
      reasons: components.map((c) => c.reason),
      evidence,
    },
  };
}