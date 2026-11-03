import type { Signal } from './types';
    import type { Brand } from '../data/brands.ts';
    import { BRANDS } from '../data/brands.ts';
    import { levenshtein } from './strings.ts';

/* ------------------------------------------------------------------ */
/* Settings and lists you can tune                                     */
/* ------------------------------------------------------------------ */

export const MAX_URL_LENGTH = 2048;

const SHORTENERS = new Set([
  'bit.ly', 'tinyurl.com', 't.co', 'goo.gl', 'ow.ly', 'is.gd', 'cutt.ly',
  'rb.gy', 'shorturl.at', 'tiny.cc', 'rebrand.ly', 'bitly.com', 't.ly',
  's.id', 'v.gd',
]);

// Endings that are cheap to register and common in scam links. Weak signal.
const RISKY_TLDS = new Set([
  'xyz', 'top', 'icu', 'vip', 'click', 'cfd', 'sbs', 'cyou', 'buzz', 'rest',
  'monster', 'zip', 'mov', 'loan', 'quest', 'lol',
]);

// Two-part endings, so 'sbi.co.in' is read as domain 'sbi' under 'co.in'.
const MULTI_SUFFIXES = new Set([
  'co.in', 'org.in', 'gov.in', 'nic.in', 'ac.in', 'net.in', 'res.in',
  'edu.in', 'firm.in', 'gen.in', 'ind.in', 'co.uk', 'org.uk', 'com.au',
  'co.nz', 'co.za', 'com.br',
]);

// Words that, next to a brand name in a domain, suggest an imitation.
const SUSPICIOUS_WORDS = [
  'kyc', 'update', 'verify', 'login', 'signin', 'secure', 'refund', 'reward',
  'offer', 'claim', 'bonus', 'support', 'care', 'helpdesk', 'customer',
  'official', 'pay', 'payment', 'account', 'alert', 'unlock', 'suspend',
  'blocked', 'gift', 'lucky', 'winner', 'free', 'bank', 'online', 'india',
  'card',
];

// Words in the path or query that scams like to use.
const PATH_KEYWORDS = new Set([
  'kyc', 'verify', 'update', 'refund', 'claim', 'reward', 'login', 'signin',
  'otp', 'pan', 'aadhaar', 'aadhar', 'suspend', 'blocked', 'expire',
  'expired', 'unlock', 'bonus', 'gift',
]);

const DANGEROUS_SCHEMES = new Set(['javascript', 'data', 'vbscript', 'file']);
const KNOWN_NON_WEB_SCHEMES = new Set(['mailto', 'tel', 'sms', 'upi', 'ftp']);

/* ------------------------------------------------------------------ */
/* Types                                                               */
/* ------------------------------------------------------------------ */

export type LinkAnalysis = {
  input: string;
  host?: string;
  registrableDomain?: string;
  officialBrand?: string; // set when the domain is a known official domain
  imitatedBrand?: string; // set when the domain seems to imitate a brand
  shortened: boolean; // the real destination is hidden
  signal: Signal;
};

type Component = { reason: string; risk: number };

/* ------------------------------------------------------------------ */
/* Helpers                                                             */
/* ------------------------------------------------------------------ */

const IPV4 = /^\d{1,3}(\.\d{1,3}){3}$/;

/** Turns look-alike characters into one standard form, to compare names. */
function canon(s: string): string {
  return s
    .toLowerCase()
    .replace(/rn/g, 'm')
    .replace(/vv/g, 'w')
    .replace(/[01l]/g, (c) => (c === '0' ? 'o' : 'i'))
    .replace(/5/g, 's')
    .replace(/3/g, 'e');
}

/** The part of a host you can actually register, e.g. sbi.co.in. */
export function registrableDomain(host: string): string {
  const labels = host.split('.');
  if (labels.length <= 2) return host;
  const lastTwo = labels.slice(-2).join('.');
  return MULTI_SUFFIXES.has(lastTwo) ? labels.slice(-3).join('.') : lastTwo;
}

function hasScript(text: string, script: 'Latin' | 'Cyrillic' | 'Greek'): boolean {
  switch (script) {
    case 'Latin':
      return /\p{Script=Latin}/u.test(text);
    case 'Cyrillic':
      return /\p{Script=Cyrillic}/u.test(text);
    case 'Greek':
      return /\p{Script=Greek}/u.test(text);
  }
}

/** The host exactly as typed (before the browser converts it). */
function typedHost(candidate: string): string {
  const m = /^[a-z][a-z0-9+.-]*:\/\/([^/\\?#]*)/i.exec(candidate);
  if (!m) return '';
  const authority = m[1];
  const hostPort = authority.slice(authority.lastIndexOf('@') + 1);
  return hostPort.startsWith('[') ? hostPort : hostPort.replace(/:\d*$/, '');
}

type Imitation = { brand: Brand; reason: string; risk: number };

function checkBrandImitation(
  host: string,
  registrable: string,
  mainLabel: string,
): Imitation | undefined {
  const subHost = host.slice(0, Math.max(0, host.length - registrable.length)).replace(/\.$/, '');
  const labelTokens = mainLabel.split(/[^a-z0-9]+/).filter(Boolean);
  const compact = mainLabel.replace(/[^a-z0-9]/g, '');
  const subTokens = subHost.split(/[^a-z0-9]+/).filter(Boolean);
  const hasSuspiciousWord = SUSPICIOUS_WORDS.some((w) => compact.includes(w));

  let best: Imitation | undefined;
  const consider = (brand: Brand, reason: string, risk: number) => {
    if (!best || risk > best.risk) best = { brand, reason, risk };
  };

  for (const brand of BRANDS) {
    // The brand's real domain used as a subdomain of someone else's.
    if (subHost && brand.officialDomains.some((d) => subHost.includes(d))) {
      consider(brand, 'brand_in_subdomain', 0.75);
    }
    for (const t of brand.tokens) {
      if (subTokens.includes(t)) consider(brand, 'brand_in_subdomain', 0.6);

      if (labelTokens.includes(t)) {
        consider(brand, 'brand_in_domain', 0.7);
        continue;
      }
      const canonT = canon(t);
      if (labelTokens.some((lt) => canon(lt) === canonT) || canon(compact) === canonT) {
        consider(brand, 'lookalike_domain', 0.8);
        continue;
      }
      if (t.length >= 5 && compact.includes(t)) {
        consider(brand, 'brand_in_domain', hasSuspiciousWord ? 0.75 : 0.45);
        continue;
      }
      if (t.length <= 4 && compact.startsWith(t) && hasSuspiciousWord) {
        consider(brand, 'brand_in_domain', 0.65);
        continue;
      }
      if (t.length >= 5) {
        const allowed = t.length >= 8 ? 2 : 1;
        if (labelTokens.some((lt) => lt.length >= 4 && levenshtein(canon(lt), canonT) <= allowed)) {
          consider(brand, 'lookalike_domain', 0.65);
        }
      }
    }
  }
  return best;
}

function combine(components: Component[]): number {
  const risk = 1 - components.reduce((acc, c) => acc * (1 - c.risk), 1);
  return Math.round(Math.min(1, Math.max(0, risk)) * 100) / 100;
}

/* ------------------------------------------------------------------ */
/* The detector                                                        */
/* ------------------------------------------------------------------ */

export function analyzeLink(input: string): LinkAnalysis {
  const text = input.trim();

  const quick = (reasons: string[], risk: number, confidence: number): LinkAnalysis => ({
    input: text,
    shortened: false,
    signal: { detector: 'link', risk, confidence, reasons, evidence: [] },
  });

  if (text.length > MAX_URL_LENGTH) return quick(['too_long'], 0.2, 0.4);
  if (/\s/.test(text)) return quick(['not_a_link'], 0.1, 0.3);

  // Work out the scheme (https, javascript, upi ...), if there is one.
  const schemeMatch = /^([a-z][a-z0-9+.-]*):(\/\/)?/i.exec(text);
  let scheme = '';
  if (schemeMatch) {
    const name = schemeMatch[1].toLowerCase();
    if (schemeMatch[2] || DANGEROUS_SCHEMES.has(name) || KNOWN_NON_WEB_SCHEMES.has(name)) {
      scheme = name;
    }
  }
  if (DANGEROUS_SCHEMES.has(scheme)) return quick(['dangerous_scheme'], 0.9, 0.9);
  if (scheme && scheme !== 'http' && scheme !== 'https') return quick(['not_a_web_link'], 0.1, 0.3);

  const hadScheme = scheme === 'http' || scheme === 'https';
  let candidate = text;
  if (!hadScheme) {
    if (!/^[^/?#\s]+\.[^/?#\s]+/.test(text)) return quick(['not_a_link'], 0.1, 0.3);
    candidate = 'https://' + text;
  }

  let url: URL;
  try {
    url = new URL(candidate);
  } catch {
    return quick(['not_a_link'], 0.1, 0.3);
  }

  const host = url.hostname.replace(/\.$/, '').toLowerCase();
  const typed = typedHost(candidate).toLowerCase();
  const components: Component[] = [];
  const evidence: string[] = [`Domain: ${host}`];

  // --- Checks that apply to every link ---------------------------------

  if (hadScheme && url.protocol === 'http:') {
    components.push({ reason: 'no_https', risk: 0.2 });
  }
  if (url.username) {
    const looksLikeDomain = url.username.includes('.');
    components.push({ reason: 'userinfo_trick', risk: looksLikeDomain ? 0.75 : 0.5 });
    evidence.push(`Text before the @ sign: ${url.username}`);
  }
  if (url.port) {
    components.push({ reason: 'unusual_port', risk: 0.3 });
  }

  const isIpv4 = IPV4.test(host);
  const isIpv6 = host.startsWith('[');
  if (isIpv4 || isIpv6) {
    components.push({ reason: 'ip_host', risk: 0.6 });
    if (isIpv4 && typed !== host) {
      components.push({ reason: 'obfuscated_ip', risk: 0.8 });
      evidence.push(`Written as: ${typed}`);
    }
  }

  if (/[^ -~]/.test(typed)) {
    const mixed =
      (hasScript(typed, 'Latin') && (hasScript(typed, 'Cyrillic') || hasScript(typed, 'Greek'))) ||
      (hasScript(typed, 'Cyrillic') && hasScript(typed, 'Greek'));
    components.push({ reason: mixed ? 'mixed_script' : 'punycode', risk: mixed ? 0.8 : 0.35 });
    if (mixed) components.push({ reason: 'punycode', risk: 0.35 });
  } else if (host.split('.').some((l) => l.startsWith('xn--'))) {
    components.push({ reason: 'punycode', risk: 0.45 });
  }

  // --- Checks about names and brands (skipped for raw IP addresses) ----

  const registrable = isIpv4 || isIpv6 ? host : registrableDomain(host);
  const mainLabel = registrable.split('.')[0];
  const result: LinkAnalysis = {
    input: text,
    host,
    registrableDomain: registrable,
    shortened: SHORTENERS.has(registrable),
    signal: { detector: 'link', risk: 0, confidence: 0, reasons: [], evidence },
  };

  const official = BRANDS.find((b) => b.officialDomains.includes(registrable));
  const governmentIndia = /\.(gov|nic)\.in$/.test(registrable);

  if (official) {
    result.officialBrand = official.name;
    evidence.push(`Official domain of ${official.name}`);
    components.push({ reason: 'official_domain', risk: 0 });
  } else if (governmentIndia) {
    evidence.push('Indian government domain');
    components.push({ reason: 'gov_domain', risk: 0 });
  } else if (!isIpv4 && !isIpv6) {
    if (result.shortened) {
      components.push({ reason: 'shortener', risk: 0.25 });
      evidence.push('Shortened link: the real destination is hidden');
    }

    const imitation = checkBrandImitation(host, registrable, mainLabel);
    if (imitation) {
      components.push({ reason: imitation.reason, risk: imitation.risk });
      result.imitatedBrand = imitation.brand.name;
      evidence.push(`Looks like ${imitation.brand.name}`);
      evidence.push(`Official: ${imitation.brand.officialDomains.join(', ')}`);
    }

    const labels = host.split('.');
    const registrableLabels = registrable.split('.').length;
    if (labels.length - registrableLabels >= 3) {
      components.push({ reason: 'many_subdomains', risk: 0.3 });
    }
    if ((mainLabel.match(/-/g) ?? []).length >= 3) {
      components.push({ reason: 'many_hyphens', risk: 0.3 });
    }
    if (host.length > 40) {
      components.push({ reason: 'long_domain', risk: 0.2 });
    }
    const tld = labels[labels.length - 1];
    if (RISKY_TLDS.has(tld)) {
      components.push({ reason: 'risky_ending', risk: 0.15 });
    }

    const pathWords = (url.pathname + ' ' + url.search)
      .toLowerCase()
      .split(/[^a-z0-9]+/)
      .filter((w) => PATH_KEYWORDS.has(w));
    if (pathWords.length > 0) {
      components.push({ reason: 'risky_path_words', risk: Math.min(0.35, 0.15 * pathWords.length) });
      evidence.push(`Words in the link: ${[...new Set(pathWords)].join(', ')}`);
    }
  }

  if (candidate.length > 200) {
    components.push({ reason: 'long_url', risk: 0.1 });
  }

  // --- Put it together --------------------------------------------------

  const flagged = components.filter((c) => c.risk > 0);
  let risk = combine(components);
  let confidence: number;

  if (flagged.length > 0) {
    confidence = 0.85;
  } else if (official) {
    risk = 0.05;
    confidence = 0.8;
  } else if (governmentIndia) {
    risk = 0.05;
    confidence = 0.6;
  } else {
    risk = 0.1; // nothing found: "no red flags found", never "safe"
    confidence = 0.5;
  }
  if (result.shortened) confidence = Math.min(confidence, 0.5);

  result.signal = {
    detector: 'link',
    risk,
    confidence,
    reasons: components.map((c) => c.reason),
    evidence,
  };
  return result;
}