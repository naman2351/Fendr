import { describe, it, expect } from 'vitest';
import { analyzeLink, registrableDomain, MAX_URL_LENGTH } from '../src/engine/link';

const reasons = (url: string) => analyzeLink(url).signal.reasons;
const risk = (url: string) => analyzeLink(url).signal.risk;

describe('registrableDomain', () => {
  it('handles ordinary and two-part endings', () => {
    expect(registrableDomain('www.example.com')).toBe('example.com');
    expect(registrableDomain('www.sbi.co.in')).toBe('sbi.co.in');
    expect(registrableDomain('myaadhaar.uidai.gov.in')).toBe('uidai.gov.in');
    expect(registrableDomain('example.com')).toBe('example.com');
  });
});

describe('links that should stay low risk', () => {
  const lowRisk = [
    'https://www.sbi.co.in/',
    'https://onlinesbi.sbi/login',
    'https://www.amazon.in/gp/help/customer',
    'https://incometax.gov.in/',
    'https://myaadhaar.uidai.gov.in/',
    'https://irctc.co.in/nget/train-search',
    'https://www.paytmmall.com/',
    'https://www.amazonpay.in/',
    'https://www.wikipedia.org/wiki/Unified_Payments_Interface',
    'https://github.com/naman2351/Fendr',
    'https://example.com/',
    'www.example.org',
    'HTTPS://WWW.SBI.CO.IN/',
    'https://sbi.co.in./',
  ];
  for (const url of lowRisk) {
    it(`stays low: ${url}`, () => {
      expect(risk(url)).toBeLessThan(0.25);
    });
  }

  it('recognises official domains, even with login in the path', () => {
    const a = analyzeLink('https://onlinesbi.sbi/login');
    expect(a.officialBrand).toBe('State Bank of India');
    expect(a.signal.reasons).toContain('official_domain');
    expect(a.signal.reasons).not.toContain('risky_path_words');
  });

  it('says no red flags with low confidence for an unknown site', () => {
    const a = analyzeLink('https://example.com/');
    expect(a.signal.reasons).toEqual([]);
    expect(a.signal.confidence).toBeLessThan(0.7);
  });

  it('does not penalise a missing https when no scheme was typed', () => {
    expect(reasons('www.example.org')).not.toContain('no_https');
  });
});

describe('links that should be flagged', () => {
  it('brand name plus scam words on a cheap ending', () => {
    const a = analyzeLink('http://sbi-kyc-update.xyz/login');
    expect(a.signal.reasons).toContain('brand_in_domain');
    expect(a.signal.reasons).toContain('no_https');
    expect(a.signal.reasons).toContain('risky_path_words');
    expect(a.imitatedBrand).toBe('State Bank of India');
    expect(a.signal.risk).toBeGreaterThanOrEqual(0.8);
  });

  it("the brand's real domain used as a subdomain of another site", () => {
    const a = analyzeLink('https://sbi.co.in.secure-login.xyz/');
    expect(a.signal.reasons).toContain('brand_in_subdomain');
    expect(a.signal.risk).toBeGreaterThanOrEqual(0.7);
    expect(a.officialBrand).toBeUndefined();
  });

  it('rn instead of m', () => {
    expect(reasons('https://paytrn.com/')).toContain('lookalike_domain');
  });

  it('a zero instead of o', () => {
    expect(reasons('https://amaz0n-offers.in/')).toContain('lookalike_domain');
  });

  it('a one instead of i in a short brand name', () => {
    expect(reasons('https://sb1.com/')).toContain('lookalike_domain');
  });

  it('a missing letter', () => {
    expect(reasons('https://flipkrt.com/')).toContain('lookalike_domain');
  });

  it('brand name plus bank-style words', () => {
    expect(reasons('https://hdfcbank-login.top/verify')).toContain('brand_in_domain');
  });

  it('brand name as the whole domain on another ending', () => {
    expect(reasons('https://sbi.xyz/')).toContain('brand_in_domain');
  });

  it('text before the @ sign that looks like a domain', () => {
    const a = analyzeLink('https://secure.paytm.com@evil.example.xyz/pay');
    expect(a.signal.reasons).toContain('userinfo_trick');
    expect(a.host).toBe('evil.example.xyz');
    expect(a.officialBrand).toBeUndefined();
  });

  it('the official domain after a backslash trick still reads as the real host', () => {
    const a = analyzeLink('https://evil.example.com\\@sbi.co.in/');
    expect(a.host).toBe('evil.example.com');
    expect(a.officialBrand).toBeUndefined();
  });

  it('a raw IP address', () => {
    expect(reasons('http://192.168.1.10/kyc')).toContain('ip_host');
  });

  it('a disguised IP address', () => {
    const r = reasons('http://2130706433/');
    expect(r).toContain('ip_host');
    expect(r).toContain('obfuscated_ip');
  });

  it('a shortened link lowers confidence', () => {
    const a = analyzeLink('https://bit.ly/3abcXYZ');
    expect(a.shortened).toBe(true);
    expect(a.signal.reasons).toContain('shortener');
    expect(a.signal.confidence).toBeLessThanOrEqual(0.5);
  });

  it('mixed Latin and Cyrillic letters', () => {
    // The third letter is Cyrillic i (U+0456), not Latin i.
    const r = reasons('https://sb\u0456.co.in/');
    expect(r).toContain('mixed_script');
  });

  it('a punycode domain', () => {
    expect(reasons('https://xn--80ak6aa92e.com/')).toContain('punycode');
  });

  it('many subdomains', () => {
    expect(reasons('https://a.b.c.d.e.example.com/')).toContain('many_subdomains');
  });

  it('an unusual port', () => {
    expect(reasons('https://example.com:8443/')).toContain('unusual_port');
  });

  it('dangerous schemes', () => {
    expect(reasons('javascript:alert(1)')).toEqual(['dangerous_scheme']);
    expect(reasons('data:text/html,<script>alert(1)</script>')).toEqual(['dangerous_scheme']);
  });
});

describe('inputs that are not web links', () => {
  it('plain text', () => {
    expect(reasons('not a link')).toEqual(['not_a_link']);
    expect(reasons('hello')).toEqual(['not_a_link']);
    expect(reasons('')).toEqual(['not_a_link']);
  });

  it('UPI and other non-web schemes', () => {
    expect(reasons('upi://pay?pa=a@b')).toEqual(['not_a_web_link']);
    expect(reasons('mailto:someone@example.com')).toEqual(['not_a_web_link']);
  });

  it('oversized input', () => {
    expect(reasons('https://example.com/' + 'a'.repeat(MAX_URL_LENGTH))).toEqual(['too_long']);
  });

  it('never throws on odd input', () => {
    for (const s of ['http://', 'https://[', 'http://%zz', '://x', '////', 'http://a b']) {
      expect(() => analyzeLink(s)).not.toThrow();
    }
  });
});

describe('scoring', () => {
  it('keeps risk between 0 and 1 and reports a detector name', () => {
    const a = analyzeLink('http://sbi.co.in.kyc-update-login-verify.xyz:8443/verify/otp/login?claim=1');
    expect(a.signal.detector).toBe('link');
    expect(a.signal.risk).toBeGreaterThan(0.9);
    expect(a.signal.risk).toBeLessThanOrEqual(1);
  });
});